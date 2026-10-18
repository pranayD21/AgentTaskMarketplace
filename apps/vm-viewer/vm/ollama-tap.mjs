#!/usr/bin/env node
// Runs inside a seller VM. A pass-through proxy in front of Ollama that records
// each /api/chat request and its tokens to a JSONL file the VM viewer tails.
// Non-streaming chat calls are streamed upstream and re-assembled, so callers
// (the Wasm runner) receive the same single JSON reply they asked for.
// DEMO ONLY: this deliberately exposes prompts and answers to the VM owner.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.TAP_PORT ?? 11435);
const UPSTREAM = new URL(process.env.OLLAMA_UPSTREAM ?? 'http://127.0.0.1:11434');
// TAP_THINK=1 turns on the model's reasoning so the viewer can show it. The
// runner still receives only the final answer. Reasoning tokens count toward
// num_predict, so the tap adds TAP_THINK_BUDGET tokens on top of the task's limit.
const THINK = process.env.TAP_THINK === '1';
const THINK_BUDGET = Number(process.env.TAP_THINK_BUDGET ?? 1536);
const OUT = process.env.TAP_FILE ?? path.join(os.homedir(), 'atm/.atm-state/vm-viewer/ollama-tap.jsonl');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const out = fs.createWriteStream(OUT, { flags: 'a' });
const emit = (event) => out.write(`${JSON.stringify({ t: Date.now(), ...event })}\n`);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function passThrough(req, res, body) {
  const up = http.request({ host: UPSTREAM.hostname, port: UPSTREAM.port, path: req.url, method: req.method, headers: { ...req.headers, host: UPSTREAM.host } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => { res.writeHead(502); res.end(); });
  up.end(body);
}

async function chat(req, res, body) {
  let request;
  try { request = JSON.parse(body.toString('utf8')); } catch { return passThrough(req, res, body); }
  const id = randomUUID().slice(0, 8);
  const wantsStream = request.stream !== false;
  const upstream = THINK && request.think !== true
    ? { ...request, think: true, options: { ...request.options, ...(request.options?.num_predict ? { num_predict: request.options.num_predict + THINK_BUDGET } : {}) } }
    : request;
  emit({ type: 'request', id, model: request.model, messages: request.messages, options: upstream.options ?? {}, think: upstream.think, reasoning_forced: upstream !== request });
  const up = http.request({ host: UPSTREAM.hostname, port: UPSTREAM.port, path: '/api/chat', method: 'POST', headers: { 'content-type': 'application/json' } }, (r) => {
    if (r.statusCode !== 200) {
      emit({ type: 'error', id, status: r.statusCode });
      res.writeHead(r.statusCode ?? 502, r.headers);
      return r.pipe(res);
    }
    if (wantsStream) res.writeHead(200, r.headers);
    let buffer = '', content = '', thinking = '', last = null;
    r.setEncoding('utf8');
    r.on('data', (chunk) => {
      if (wantsStream) res.write(chunk);
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        const text = msg.message?.content ?? '', think = msg.message?.thinking ?? '';
        if (think) { thinking += think; emit({ type: 'token', id, text: think, thinking: true }); }
        if (text) { content += text; emit({ type: 'token', id, text }); }
        if (msg.done) last = msg;
      }
    });
    r.on('end', () => {
      const { eval_count, eval_duration, prompt_eval_count, prompt_eval_duration, total_duration, load_duration, done_reason } = last ?? {};
      emit({ type: 'done', id, eval_count, eval_duration, prompt_eval_count, prompt_eval_duration, total_duration, load_duration, done_reason, chars: content.length });
      if (wantsStream) return res.end();
      // Return what the caller asked for: no reasoning text unless it requested thinking.
      const reply = { ...(last ?? {}), message: { role: 'assistant', content, ...(thinking && request.think ? { thinking } : {}) }, done: true };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  up.on('error', (err) => { emit({ type: 'error', id, message: err.message }); if (!res.headersSent) res.writeHead(502); res.end(); });
  up.end(JSON.stringify({ ...upstream, stream: true }));
}

http.createServer(async (req, res) => {
  const body = await readBody(req);
  if (req.method === 'POST' && req.url === '/api/chat') return chat(req, res, body);
  passThrough(req, res, body);
}).listen(PORT, '127.0.0.1', () => console.log(`ollama-tap :${PORT} -> ${UPSTREAM.origin}, events -> ${OUT}`));
