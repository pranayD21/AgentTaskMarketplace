import fs from 'node:fs';
import path from 'node:path';

export function writeAtomic(file, data) {
  writeTextAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
}
export function writeTextAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
export function lock(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, 'wx', 0o600);
  fs.writeFileSync(fd, String(process.pid));
  return () => { fs.closeSync(fd); fs.unlinkSync(file); };
}
export function reserve(file, attemptId, worstMicrousd, limitMicrousd = 5_000_000) {
  if (!Number.isSafeInteger(limitMicrousd) || limitMicrousd < 0 || limitMicrousd > 5_000_000) throw new Error('External API cap cannot exceed the authorized $5 total');
  if (!Number.isSafeInteger(worstMicrousd) || worstMicrousd <= 0) throw new Error('Invalid API reservation');
  const release = lock(`${file}.lock`);
  try {
    const ledger = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { schema: 'atm-api-budget/v1', cap_microusd: limitMicrousd, entries: {} };
    if (ledger.cap_microusd !== limitMicrousd) throw new Error('Existing API ledger cap differs; do not silently change authorization');
    if (ledger.entries[attemptId]) throw new Error('API attempt already reserved; reconcile before any retry');
    const booked = Object.values(ledger.entries).reduce((sum, entry) => sum + entry.booked_microusd, 0);
    if (booked + worstMicrousd > ledger.cap_microusd) throw new Error('External API budget would be exceeded');
    ledger.entries[attemptId] = { state: 'reserved', booked_microusd: worstMicrousd, reserved_at: new Date().toISOString() };
    writeAtomic(file, ledger);
  } finally { release(); }
}
export function settle(file, attemptId, actualMicrousd) {
  if (!Number.isSafeInteger(actualMicrousd) || actualMicrousd < 0) throw new Error('Unknown usage cannot be charged as zero');
  const release = lock(`${file}.lock`);
  try {
    const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entry = ledger.entries[attemptId];
    if (!entry || entry.state !== 'reserved') throw new Error('API reservation is missing or already settled');
    if (actualMicrousd > entry.booked_microusd) throw new Error('Reported API cost exceeds conservative reservation; stop and reconcile');
    ledger.entries[attemptId] = { ...entry, state: 'settled', booked_microusd: actualMicrousd, settled_at: new Date().toISOString() };
    writeAtomic(file, ledger);
  } finally { release(); }
}
