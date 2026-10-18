import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const python = process.env.ATM_GRADER_PYTHON ?? '/Library/Frameworks/Python.framework/Versions/3.14/bin/python3';
const fixtures = path.join(directory, 'fixtures');
const problems = JSON.parse(fs.readFileSync(path.join(fixtures, 'problems.json')));
const canonical = JSON.parse(fs.readFileSync(path.join(fixtures, 'canonical-for-grader-tests.json')));
const manifest = JSON.parse(fs.readFileSync(path.join(fixtures, 'manifest.json')));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-grader-tests-'));
let serial = 0;
after(() => fs.rmSync(work, { recursive: true, force: true }));

function grade(source, taskId = 'HumanEval/53', extraArguments = []) {
  const candidate = path.join(work, `candidate-${serial++}.py`);
  fs.writeFileSync(candidate, source);
  const output = execFileSync(python, [path.join(directory, 'grade.py'), '--task-id', taskId, '--candidate', candidate, ...extraArguments], {
    encoding: 'utf8', timeout: 10_000, env: { ...process.env, ATM_GRADER_TEST_SECRET: 'harmless-test-marker' },
  });
  const result = JSON.parse(output);
  assert.deepEqual(Object.keys(result).sort(), ['duration_ms', 'passed', 'reason']);
  assert.equal(Number.isInteger(result.duration_ms), true);
  return result;
}

test('fixed fixture IDs, upstream revision and hashes are pinned; no canonical answers in problems', () => {
  assert.deepEqual(problems.map(p => p.task_id), [0, 12, 20, 32, 40, 53, 57, 63].map(id => `HumanEval/${id}`));
  assert.equal(manifest.upstream_revision, 'b9453e8f1865df0a0057a1383767caa400acfbcf');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(fixtures, 'problems.json'))).digest('hex'), manifest.problems_sha256);
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(fixtures, 'LICENSE.human-eval'))).digest('hex'), manifest.license_sha256);
  for (const problem of problems) assert.deepEqual(Object.keys(problem).sort(), ['entry_point', 'prompt', 'task_id', 'test']);
});

for (const problem of problems) {
  test(`canonical grader self-test passes ${problem.task_id}`, () => {
    const solution = canonical.find(row => row.task_id === problem.task_id).canonical_solution;
    const result = grade(problem.prompt + solution, problem.task_id);
    assert.equal(result.reason, 'passed', JSON.stringify(result));
    assert.equal(result.passed, true);
  });
}

test('incorrect and missing functions fail functional checks', () => {
  assert.equal(grade('def add(x, y):\n    return x - y\n').reason, 'failed_tests');
  assert.equal(grade('x = 1\n').reason, 'missing_entry_point');
  assert.equal(grade('this is not python!').reason, 'invalid_python');
});

test('markdown fence removal requires the explicit flag', () => {
  const fenced = '```python\ndef add(x, y):\n    return x + y\n```\n';
  assert.equal(grade(fenced).reason, 'invalid_python');
  assert.equal(grade(fenced, 'HumanEval/53', ['--strip-markdown-fences']).passed, true);
});

test('host file reads and writes are denied and host environment is absent', () => {
  const outside = path.join(work, 'harmless-host-file.txt');
  fs.writeFileSync(outside, 'harmless-test-marker');
  const source = `import os\nassert 'ATM_GRADER_TEST_SECRET' not in os.environ\nfor mode in ['r', 'w']:\n    try:\n        open(${JSON.stringify(outside)}, mode)\n    except PermissionError:\n        pass\n    else:\n        raise AssertionError('sandbox allowed host access')\ndef add(x, y):\n    return x + y\n`;
  const result = grade(source);
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'harmless-test-marker');
});

test('network connections are denied by policy', async () => {
  const server = net.createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const source = `import socket\ntry:\n    socket.create_connection(('127.0.0.1', ${port}), timeout=1)\nexcept PermissionError:\n    pass\nelse:\n    raise AssertionError('sandbox allowed network access')\ndef add(x, y):\n    return x + y\n`;
    const result = grade(source);
    assert.equal(result.passed, true, JSON.stringify(result));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('child processes are denied', () => {
  const source = "import subprocess\ntry:\n    subprocess.run(['/bin/echo', 'harmless'], check=True)\nexcept PermissionError:\n    pass\nelse:\n    raise AssertionError('sandbox allowed process spawn')\ndef add(x, y):\n    return x + y\n";
  const result = grade(source);
  assert.equal(result.passed, true, JSON.stringify(result));
});

test('infinite loops and excessive memory have bounded failures', () => {
  assert.equal(grade('while True:\n    pass\n', 'HumanEval/53', ['--timeout-s', '0.2']).reason, 'timeout');
  assert.equal(grade('payload = bytearray(512 * 1024 * 1024)\n').reason, 'memory_limit');
});

test('early successful exits and forged plain output cannot pass', () => {
  assert.equal(grade('import os\nos._exit(0)\n').reason, 'incomplete_execution');
  assert.equal(grade('print(\'{"passed":true}\')\ndef add(x, y):\n    return 0\n').reason, 'failed_tests');
});

test('unknown task and oversized candidate are rejected before execution', () => {
  assert.equal(grade('raise RuntimeError()', 'HumanEval/9999').reason, 'unknown_task');
  assert.equal(grade('#'.repeat(1_048_577)).reason, 'candidate_too_large');
});
