#!/usr/bin/env node
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';

// The deploy CLI parses KEY=VALUE literally. Supply only server configuration,
// with no quotes, comments, local URLs, buyer/seller keys or judge private keys.
const source = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
const allowed = [
  'INSFORGE_BASE_URL', 'INSFORGE_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_PROFILE_ID',
  'PAYMENT_MODE', 'MPP_SECRET_KEY', 'INKBOX_API_KEY', 'SERVER_KEK_B64',
  'JUDGE_PUBLIC_KEY_B64', 'JUDGE_KEY_ID', 'JUDGE_REGISTRATION_SECRET',
  'SUSPEND_AFTER_STRIKES', 'DEFAULT_SPEND_CAP_CENTS',
];
const values = Object.fromEntries(allowed.filter((key) => source[key]).map((key) => [key, source[key]]));
values.ATM_BUILD_REVISION = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
Object.assign(values, { DB_MODE: 'insforge', PAYMENT_MODE: values.PAYMENT_MODE ?? 'card', HOST: '0.0.0.0', PORT: '3000' });
for (const key of ['INSFORGE_BASE_URL', 'INSFORGE_API_KEY', 'SERVER_KEK_B64', 'JUDGE_PUBLIC_KEY_B64', 'JUDGE_KEY_ID', 'JUDGE_REGISTRATION_SECRET']) {
  if (!values[key]) throw new Error(`Missing server setting: ${key}`);
}
if (values.PAYMENT_MODE !== 'mock' && !values.STRIPE_SECRET_KEY?.startsWith('sk_test_')) throw new Error('A Stripe test key is required.');
for (const [key, value] of Object.entries(values)) {
  if (/[\r\n]/.test(value)) throw new Error(`Multiline configuration is unsupported: ${key}`);
}
const target = '.env.manufact';
writeFileSync(target, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
chmodSync(target, 0o600);
console.log(`Prepared ${target} with ${Object.keys(values).length} server settings. BASE_URL comes from Manufact; daemon credentials are excluded.`);
