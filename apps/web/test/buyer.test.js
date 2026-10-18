import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient, parseCommand, parseRpcResponse, privateResult, readIdentity, normalizeEndpoint } from '../../../scripts/buyer.mjs';

describe('buyer client', () => {
  it('validates before connecting and does not guess a grading rubric', () => {
    expect(parseCommand(['--help']).command).toBe('help');
    for (const args of [['post','test'], ['post','test','--expect','ok','--max','NaN'], ['post','test','--expect','ok','--criteria','ok'], ['result'], ['post','test','--expect'], ['whoami','extra']]) expect(() => parseCommand(args)).toThrow();
    const { args } = parseCommand(['post','test','--expect','ok','--models','qwen3:8b,qwen3:4b','--max','100']);
    expect(args.allowed_models).toEqual(['qwen3:8b','qwen3:4b']);
    expect(args.rubric).toEqual({ kind: 'contains_text', expected_text: 'ok' });
  });
  it('reads private prompt/context from files and binds stored identity to endpoint', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-buyer-test-'));
    try {
      const file = path.join(directory, 'input'); fs.writeFileSync(file, 'synthetic fixture');
      expect(parseCommand(['post','--prompt-file',file,'--context-file',file,'--criteria','correct']).args.context).toBe('synthetic fixture');
      const state = path.join(directory, 'identity.json');
      fs.writeFileSync(state, JSON.stringify({ marketplace_url: 'https://one.test/mcp', api_key: 'atm_sk_fixture' }));
      expect(() => readIdentity(state, 'https://two.test/mcp')).toThrow(/different/);
      expect(readIdentity(state, 'https://one.test/mcp').api_key).toBe('atm_sk_fixture');
      expect(() => normalizeEndpoint('https://secret@one.test/mcp')).toThrow();
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
  it('handles SSE progress before the matching response and rejects mismatched IDs', () => {
    const body = ': keepalive\r\n\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\nevent: message\r\ndata: {"id":3,"result":{"ok":true}}\r\n\r\n';
    expect(parseRpcResponse(body, 'text/event-stream', 3)).toEqual({ ok: true });
    expect(() => parseRpcResponse(body, 'text/event-stream', 9)).toThrow();
    expect(parseRpcResponse('{"id":2,"result":{}}', 'application/json', 2)).toEqual({});
  });
  it('initializes the session, sends auth, and preserves structured recovery guidance', async () => {
    const requests = [];
    const client = createClient('http://fixture/mcp', 'atm_sk_fixture', async (_, init) => {
      const body = JSON.parse(init.body); requests.push({ ...init, body });
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = body.method === 'initialize' ? { protocolVersion: '2025-06-18' } : { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'SPEND_CAP_EXCEEDED', message: 'Cap exceeded', next_action: 'Reduce budget', retryable: false } }) }] };
      return new Response(JSON.stringify({ id: body.id, result }), { headers: { 'content-type':'application/json', 'mcp-session-id':'session-fixture' } });
    });
    await client.initialize();
    await expect(client.tool('post_task', {})).rejects.toMatchObject({ code:'SPEND_CAP_EXCEEDED', nextAction:'Reduce budget', retryable:false });
    expect(requests[1].body.method).toBe('notifications/initialized');
    expect(requests[2].headers['mcp-session-id']).toBe('session-fixture');
    expect(requests[2].headers.authorization).toBe('Bearer atm_sk_fixture');
    expect(requests[2].redirect).toBe('error');
    expect(requests).toHaveLength(3);
  });
  it('does not expose unverified answers or ciphertext', () => {
    expect(() => privateResult({ result: { answer:'untrusted', commitment_verified:false } })).toThrow(/commitment/);
    const data = privateResult({ result: { answer:'verified', commitment_verified:true, result_enc_buyer:'ciphertext' } });
    expect(data.result.answer).toBe('verified'); expect(data.result).not.toHaveProperty('result_enc_buyer');
    const replacement = privateResult({result:{answer:'untrusted',commitment_verified:false},replacement_answer:'judge replacement'});
    expect(replacement.result).not.toHaveProperty('answer');
    expect(replacement.replacement_answer).toBe('judge replacement');
    expect(replacement.seller_answer_withheld).toBe(true);
  });
  it.each(['interrupted body', 'truncated JSON', 'unmatched response'])(
    'preserves uncertain-post recovery without replaying after %s', async (failure) => {
      const requests = [];
      const client = createClient('http://fixture/mcp', 'atm_sk_fixture', async (_, init) => {
        const request = JSON.parse(init.body);
        requests.push(request);
        if (request.method === 'initialize') return new Response(JSON.stringify({ id: request.id, result: {} }));
        if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
        if (failure === 'interrupted body') return {
          ok: true,
          headers: new Headers(),
          text: async () => { throw new Error('synthetic interrupted response'); },
        };
        return new Response(failure === 'truncated JSON' ? '{"id":' : '{"id":999,"result":{}}', {
          headers: { 'content-type': 'application/json' },
        });
      });
      await client.initialize();
      await expect(client.tool('post_task', {})).rejects.toMatchObject({
        code: failure === 'interrupted body' ? 'CONNECTION_FAILED' : 'PROTOCOL_ERROR',
        nextAction: expect.stringContaining('use tasks to check whether it succeeded'),
        retryable: false,
      });
      expect(requests.filter(request => request.method === 'tools/call')).toHaveLength(1);
    },
  );
});
