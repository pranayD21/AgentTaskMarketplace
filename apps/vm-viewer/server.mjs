#!/usr/bin/env node
// Live viewer for seller VMs (Lima). Discovers VMs, streams their metrics, the
// seller daemon log and the Ollama tap (prompts + tokens), and the marketplace
// task pipeline to the browser over Server-Sent Events. DEMO ONLY: it shows
// task contents that the marketplace otherwise keeps private.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const PORT = Number(process.env.VM_VIEWER_PORT ?? 5180);
const MARKETPLACE = (process.env.MARKETPLACE_BASE_URL ?? 'http://localhost:3000').replace(/\/mcp\/?$/, '').replace(/\/$/, '');
const AUTO_OPEN = process.env.VM_VIEWER_AUTO_OPEN !== '0';
const VM_DIR = '$HOME/atm/.atm-state/vm-viewer';
const ORIGIN = `http://localhost:${PORT}`;
const INDEX = path.join(import.meta.dirname, 'public/index.html');

const vms = new Map();         // name -> { info, metrics, history, logs, tap, watchers, prevCpu }
const clients = new Set();
let market = null, marketError = null, firstListDone = false;

function broadcast(type, data) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(frame);
}
const push = (arr, item, max) => { arr.push(item); if (arr.length > max) arr.splice(0, arr.length - max); };
const openWindow = (url) => spawn('open', [url], { stdio: 'ignore', detached: true }).unref();

// ---- VM discovery ---------------------------------------------------------
async function listVms() {
  try {
    const { stdout } = await run('limactl', ['list', '--json'], { timeout: 10_000 });
    return stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

async function refreshVms() {
  const list = await listVms();
  const seen = new Set();
  for (const info of list) {
    seen.add(info.name);
    let vm = vms.get(info.name);
    const summary = { name: info.name, status: info.status, arch: info.arch, cpus: info.cpus, memory: info.memory, disk: info.disk, vmType: info.vmType };
    if (!vm) {
      vm = { info: summary, metrics: null, history: [], logs: [], tap: [], watchers: null, prevCpu: null, createdAt: Date.now() };
      vms.set(info.name, vm);
      broadcast('vm-added', { name: info.name, isNew: firstListDone });
      if (firstListDone && AUTO_OPEN) openWindow(`${ORIGIN}/#vm=${encodeURIComponent(info.name)}`);
    }
    vm.info = summary;
    if (info.status === 'Running' && !vm.watchers) startWatchers(info.name, vm);
    if (info.status !== 'Running' && vm.watchers) stopWatchers(vm);
  }
  for (const [name, vm] of vms) if (!seen.has(name)) { stopWatchers(vm); vms.delete(name); broadcast('vm-removed', { name }); }
  firstListDone = true;
  broadcast('vms', [...vms.values()].map((v) => ({ ...v.info, metrics: v.metrics })));
}

// ---- Per-VM watchers ------------------------------------------------------
function tail(name, file, lines, onLine) {
  let child, stopped = false;
  const start = () => {
    if (stopped) return;
    child = spawn('limactl', ['shell', '--workdir', '/', name, 'sh', '-c',
      `mkdir -p "${VM_DIR}" && cd "${VM_DIR}" && touch ${file} && exec tail -n ${lines} -F ${file}`], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (line.trim()) onLine(line); }
    });
    child.on('exit', () => { if (!stopped) setTimeout(start, 3000); });
  };
  start();
  return () => { stopped = true; child?.kill(); };
}

const METRICS_SCRIPT = `
echo @@stat; head -1 /proc/stat
echo @@mem; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo
echo @@load; cat /proc/loadavg
echo @@uptime; cat /proc/uptime
echo @@ps; ps -eo pid,pcpu,pmem,rss,etime,comm --sort=-pcpu | head -9
echo @@ollama; curl -s -m1 http://127.0.0.1:11434/api/ps; echo
echo @@seller; cat "$HOME"/atm/.atm-state/seller*.json 2>/dev/null | grep -o '"agent_id": *"[^"]*"' | head -1
echo @@os; . /etc/os-release; echo "$PRETTY_NAME"; uname -r
`;

function parseMetrics(text, vm) {
  const sec = {};
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('@@')) { cur = line.slice(2).trim(); sec[cur] = []; } else if (cur) sec[cur].push(line);
  }
  const cpuFields = (sec.stat?.[0] ?? '').trim().split(/\s+/).slice(1).map(Number);
  const idle = (cpuFields[3] ?? 0) + (cpuFields[4] ?? 0), total = cpuFields.reduce((a, b) => a + b, 0);
  let cpu = null;
  if (vm.prevCpu && total > vm.prevCpu.total) cpu = Math.max(0, Math.min(100, 100 * (1 - (idle - vm.prevCpu.idle) / (total - vm.prevCpu.total))));
  vm.prevCpu = { idle, total };
  const mem = Object.fromEntries((sec.mem ?? []).map((l) => { const [k, v] = l.split(':'); return [k, Number.parseInt(v, 10) * 1024]; }));
  const procs = (sec.ps ?? []).slice(1).filter((l) => l.trim()).map((l) => {
    const [pid, pcpu, pmem, rss, etime, ...comm] = l.trim().split(/\s+/);
    return { pid: Number(pid), cpu: Number(pcpu), mem: Number(pmem), rss: Number(rss) * 1024, etime, comm: comm.join(' ') };
  });
  let models = [];
  try { models = (JSON.parse((sec.ollama ?? []).join('').trim() || '{}').models ?? []).map((m) => ({ name: m.name, size: m.size, size_vram: m.size_vram, expires_at: m.expires_at, context: m.context_length })); } catch {}
  const seller = /"agent_id": *"([^"]+)"/.exec((sec.seller ?? []).join(''))?.[1] ?? null;
  return {
    at: Date.now(), cpu, memTotal: mem.MemTotal ?? null, memUsed: mem.MemTotal && mem.MemAvailable ? mem.MemTotal - mem.MemAvailable : null,
    load: (sec.load?.[0] ?? '').split(' ').slice(0, 3).map(Number), uptime: Number.parseFloat(sec.uptime?.[0] ?? '0'),
    procs, models, seller, os: (sec.os ?? []).filter(Boolean).join(' · '),
  };
}

function startWatchers(name, vm) {
  let stopped = false, busy = false;
  const timer = setInterval(async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const { stdout } = await run('limactl', ['shell', '--workdir', '/', name, 'sh', '-c', METRICS_SCRIPT], { timeout: 8000, maxBuffer: 1 << 20 });
      vm.metrics = parseMetrics(stdout, vm);
      push(vm.history, { at: vm.metrics.at, cpu: vm.metrics.cpu, memUsed: vm.metrics.memUsed }, 150);
      broadcast('metrics', { name, metrics: vm.metrics });
    } catch {} finally { busy = false; }
  }, 2000);
  const stopLog = tail(name, 'seller.log', 300, (line) => {
    const entry = { at: Date.now(), line };
    push(vm.logs, entry, 600);
    broadcast('log', { name, ...entry });
  });
  const stopTap = tail(name, 'ollama-tap.jsonl', 3000, (line) => {
    let event; try { event = JSON.parse(line); } catch { return; }
    push(vm.tap, event, 6000);
    broadcast('tap', { name, event });
  });
  vm.watchers = () => { stopped = true; clearInterval(timer); stopLog(); stopTap(); };
}
function stopWatchers(vm) { vm.watchers?.(); vm.watchers = null; vm.prevCpu = null; }

// ---- Marketplace ----------------------------------------------------------
async function refreshMarket() {
  try {
    const res = await fetch(`${MARKETPLACE}/api/dashboard`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    market = { at: Date.now(), payments: d.payments, db: d.db, counts: d.counts, tasks: (d.tasks ?? []).slice(0, 25), events: (d.events ?? []).slice(0, 120), sellers: d.sellers ?? [] };
    marketError = null;
  } catch (err) { marketError = String(err.message ?? err); }
  broadcast('market', { market, error: marketError, url: MARKETPLACE });
}

// ---- HTTP -----------------------------------------------------------------
function snapshot() {
  return {
    marketplace: MARKETPLACE,
    vms: [...vms.values()].map((v) => ({ ...v.info, metrics: v.metrics, history: v.history, logs: v.logs, tap: v.tap })),
    market, marketError,
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, ORIGIN);
  if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  if (url.pathname === '/api/state') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(snapshot())); }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return fs.createReadStream(INDEX).pipe(res);
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`VM viewer on ${ORIGIN} (marketplace ${MARKETPLACE}; new VMs ${AUTO_OPEN ? 'open a window automatically' : 'do not auto-open'})`);
  await refreshVms();
  setInterval(refreshVms, 3000);
  refreshMarket();
  setInterval(refreshMarket, 2000);
  if (process.argv.includes('--open')) openWindow(ORIGIN);
});
