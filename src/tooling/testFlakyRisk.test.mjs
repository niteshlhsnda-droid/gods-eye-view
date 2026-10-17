import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  analyzeTestFile,
  FLAKY_KINDS,
  FLAKY_WEIGHTS,
  formatFlakyRiskReport,
  maskNonCode,
  parseCliArgs,
  rankFlakyFiles,
  scoreFindings,
  findFlakyRisks,
  summarizeResults,
} from './testFlakyRisk.js';
import { runFlakyRiskScoreboard } from '../../scripts/scoreboard-test-flaky-risk.mjs';

function kindsOf(source) {
  return findFlakyRisks(source, 'sample.test.mjs').map(
    (finding) => finding.kind,
  );
}

function countKind(source, kind) {
  return kindsOf(source).filter((found) => found === kind).length;
}

test('real-timer: setTimeout / setInterval / setImmediate count', () => {
  assert.equal(
    countKind('await new Promise((r) => setTimeout(r, 50));', 'real-timer'),
    1,
  );
  assert.equal(
    countKind('const id = setInterval(poll, 100);', 'real-timer'),
    1,
  );
  assert.equal(countKind('setImmediate(done);', 'real-timer'), 1);
  assert.equal(countKind('clearTimeout(id);', 'real-timer'), 0);
});

test('real-clock: Date.now / new Date / performance.now count', () => {
  assert.equal(countKind('assert.equal(Date.now(), 0);', 'real-clock'), 1);
  assert.equal(countKind('const d = new Date();', 'real-clock'), 1);
  assert.equal(countKind('const t = performance.now();', 'real-clock'), 1);
  assert.equal(countKind('const s = new Date("2026-01-01");', 'real-clock'), 1);
  assert.equal(
    countKind('assert.equal(Date.UTC(2026, 0, 1), 0);', 'real-clock'),
    1,
  );
});

test('random: Math.random and crypto randomness count once each', () => {
  assert.equal(countKind('const x = Math.random();', 'random'), 1);
  assert.equal(countKind('const id = crypto.randomUUID();', 'random'), 1);
  assert.equal(countKind('const b = crypto.randomBytes(8);', 'random'), 1);
  assert.equal(countKind('const n = randomInt(10);', 'random'), 1);
  assert.equal(countKind('const x = Math.floor(1.5);', 'random'), 0);
});

test('network: fetch / WebSocket / EventSource / XHR count', () => {
  assert.equal(countKind('await fetch("https://example.test");', 'network'), 1);
  assert.equal(
    countKind('const ws = new WebSocket("ws://localhost");', 'network'),
    1,
  );
  assert.equal(
    countKind('const es = new EventSource("/events");', 'network'),
    1,
  );
  assert.equal(countKind('const xhr = new XMLHttpRequest();', 'network'), 1);
});

test('filesystem: fs.* calls count; bare calls only with a node:fs import', () => {
  assert.equal(countKind('await fs.readFile(file, "utf8");', 'filesystem'), 1);
  assert.equal(
    countKind('await fs.writeFileSync(out, data);', 'filesystem'),
    1,
  );
  assert.equal(
    countKind(
      "import { readFile } from 'node:fs/promises';\nawait readFile(f);",
      'filesystem',
    ),
    1,
  );
  assert.equal(countKind('await readFile(f);', 'filesystem'), 0);
  assert.equal(countKind('const data = "readFile(";', 'filesystem'), 0);
});

test('env-mutation: writes and deletes count, reads and comparisons do not', () => {
  assert.equal(countKind("process.env.FOO = '1';", 'env-mutation'), 1);
  assert.equal(countKind('delete process.env.FOO;', 'env-mutation'), 1);
  assert.equal(countKind('process.chdir(dir);', 'env-mutation'), 1);
  assert.equal(countKind("if (process.env.FOO === '1') {}", 'env-mutation'), 0);
  assert.equal(countKind('const v = process.env.FOO;', 'env-mutation'), 0);
});

test('global-mutation: globalThis assignment counts, reads do not', () => {
  assert.equal(countKind('globalThis.fetch = stub;', 'global-mutation'), 1);
  assert.equal(
    countKind(
      'Object.defineProperty(globalThis, "x", { value: 1 });',
      'global-mutation',
    ),
    1,
  );
  assert.equal(countKind('const f = globalThis.fetch;', 'global-mutation'), 0);
  assert.equal(
    countKind('assert.equal(globalThis.setTimeout, fn);', 'global-mutation'),
    0,
  );
});

test('port: only nonzero listen ports count', () => {
  assert.equal(countKind('server.listen(8080);', 'port'), 1);
  assert.equal(countKind('server.listen(0, "127.0.0.1");', 'port'), 0);
  assert.equal(countKind('await server.listen();', 'port'), 0);
  assert.equal(
    countKind("this.listen(this._radioFilter, 'change');", 'port'),
    0,
  );
});

test('shared-state: only top-level let/var declarations count', () => {
  assert.equal(countKind('let counter = 0;', 'shared-state'), 1);
  assert.equal(countKind('var cache = {};', 'shared-state'), 1);
  assert.equal(countKind('const counter = 0;', 'shared-state'), 0);
  assert.equal(
    countKind('test("x", () => { let local = 0; });', 'shared-state'),
    0,
  );
  assert.equal(countKind('for (let i = 0; i < 3; i++) {}', 'shared-state'), 0);
  assert.equal(countKind('if (cond) { let scoped = 1; }', 'shared-state'), 0);
  assert.equal(countKind('const obj = { let: 1 };', 'shared-state'), 0);
});

test('fake-timer / fake-fetch method definitions are not calls', () => {
  assert.deepEqual(
    kindsOf(
      'const fake = { setTimeout(handler, delay) { timers.push(handler); } };',
    ),
    [],
  );
  assert.deepEqual(
    kindsOf('class Fake { setInterval(fn, ms) { return 1; } }'),
    [],
  );
  assert.deepEqual(kindsOf('const stub = { fetch(url) { return ok; } };'), []);
  assert.equal(
    countKind('await new Promise((r) => setTimeout(r, 10));', 'real-timer'),
    1,
  );
  assert.equal(
    countKind('setTimeout(function () { done(); }, 10);', 'real-timer'),
    1,
  );
});

test('comments, strings, and regex literals are not findings', () => {
  assert.deepEqual(kindsOf('// setTimeout(() => {}, 1);'), []);
  assert.deepEqual(kindsOf('/* fetch(url); Date.now(); */'), []);
  assert.deepEqual(kindsOf("const s = 'setTimeout(1); fetch(url);';"), []);
  assert.deepEqual(kindsOf('const s = "Math.random()";'), []);
  assert.deepEqual(kindsOf('const re = /setTimeout|fetch/.test(x);'), []);
  assert.deepEqual(kindsOf('const re = /[/]/.test(s);'), []);
  assert.deepEqual(kindsOf('const q = a / b;'), []);
});

test('template literal text is masked but ${} interpolations are code', () => {
  const source = 'const t = `text setTimeout( ${fetch(url)} end`;';
  assert.deepEqual(kindsOf(source), ['network']);
});

test('nested template interpolations are scanned as code', () => {
  const source = 'const t = `outer ${`inner ${setTimeout(1)}`} end`;';
  assert.deepEqual(kindsOf(source), ['real-timer']);
});

test('findings carry the right line numbers', () => {
  const source =
    'import test from "node:test";\n\ntest("x", async () => {\n  await fetch(url);\n});\n';
  const findings = findFlakyRisks(source, 'sample.test.mjs');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'network');
  assert.equal(findings[0].line, 4);
  assert.equal(findings[0].file, 'sample.test.mjs');
});

test('maskNonCode keeps offsets stable and blanks only non-code', () => {
  const source = "const a = 1; // setTimeout(\nconst b = 'x';\n";
  const masked = maskNonCode(source);
  assert.equal(masked.length, source.length);
  assert.ok(masked.includes('const a = 1;'));
  assert.ok(!masked.includes('setTimeout'));
  assert.ok(masked.includes('const b'));
});

test('scoreFindings applies weights and zero-fills every kind', () => {
  const { counts, score } = scoreFindings([
    { kind: 'port', file: 'f', line: 1, text: '' },
    { kind: 'real-timer', file: 'f', line: 2, text: '' },
    { kind: 'real-timer', file: 'f', line: 3, text: '' },
  ]);
  assert.equal(score, FLAKY_WEIGHTS.port + 2 * FLAKY_WEIGHTS['real-timer']);
  assert.equal(counts.port, 1);
  assert.equal(counts['real-timer'], 2);
  assert.equal(counts.network, 0);
  for (const kind of FLAKY_KINDS) assert.ok(kind in counts);
});

test('analyzeTestFile / rankFlakyFiles order by score, findings, path', () => {
  const a = analyzeTestFile('b.test.mjs', 'server.listen(8080);');
  const b = analyzeTestFile('a.test.mjs', 'setTimeout(() => {}, 1);');
  const c = analyzeTestFile('c.test.mjs', 'const x = 1;');
  assert.equal(a.score, FLAKY_WEIGHTS.port);
  assert.equal(
    rankFlakyFiles([b, a, c], 0)
      .map((r) => r.file)
      .join(','),
    'b.test.mjs,a.test.mjs',
  );
  assert.equal(rankFlakyFiles([b, a, c], 1).length, 1);
  assert.equal(rankFlakyFiles([b, a, c], 1)[0].file, 'b.test.mjs');
});

test('summarizeResults totals across files', () => {
  const results = [
    analyzeTestFile('a.test.mjs', 'setTimeout(() => {}, 1);'),
    analyzeTestFile('b.test.mjs', 'const x = 1;'),
  ];
  const summary = summarizeResults(results);
  assert.equal(summary.files, 2);
  assert.equal(summary.filesWithFindings, 1);
  assert.equal(summary.totalFindings, 1);
  assert.equal(summary.totals['real-timer'], 1);
});

test('formatFlakyRiskReport lists ranked files, kinds, and finding lines', () => {
  const results = [
    analyzeTestFile(
      'a.test.mjs',
      'server.listen(8080);\nsetTimeout(() => {}, 1);',
    ),
  ];
  const report = formatFlakyRiskReport(results, 10);
  assert.ok(report.includes('Flaky-risk scoreboard'));
  assert.ok(report.includes('a.test.mjs'));
  assert.ok(report.includes('port=1'));
  assert.ok(report.includes('L1 port:'));
  assert.ok(report.includes('L2 real-timer:'));
});

test('parseCliArgs defaults and flags', () => {
  assert.deepEqual(parseCliArgs([]), {
    json: false,
    strict: false,
    help: false,
    limit: 10,
    positional: [],
    error: null,
  });
  const parsed = parseCliArgs([
    '--json',
    '--strict',
    '--limit',
    '3',
    'a.test.mjs',
  ]);
  assert.equal(parsed.json, true);
  assert.equal(parsed.strict, true);
  assert.equal(parsed.limit, 3);
  assert.deepEqual(parsed.positional, ['a.test.mjs']);
  assert.equal(parseCliArgs(['--limit=0']).limit, 0);
  assert.equal(parseCliArgs(['--help']).help, true);
  assert.match(parseCliArgs(['--limit', '-1']).error, /--limit/);
  assert.match(parseCliArgs(['--limit', 'x']).error, /--limit/);
  assert.match(parseCliArgs(['--nope']).error, /unknown flag/);
});

test('CLI: --strict fails on a port finding, accepts absolute paths', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'flaky-risk-'));
  const originalLog = console.log;
  const originalError = console.error;
  const logged = [];
  console.log = (...args) => {
    logged.push(args.join(' '));
  };
  console.error = () => {};
  try {
    const relative = 'porty.test.mjs';
    const absolute = path.join(dir, relative);
    await writeFile(absolute, 'server.listen(8080);\n');
    const strictCode = await runFlakyRiskScoreboard(dir, [
      'node',
      'scoreboard-test-flaky-risk.mjs',
      '--strict',
      relative,
    ]);
    assert.equal(strictCode, 1);
    logged.length = 0;
    const absoluteCode = await runFlakyRiskScoreboard(dir, [
      'node',
      'scoreboard-test-flaky-risk.mjs',
      '--json',
      absolute,
    ]);
    assert.equal(absoluteCode, 0);
    const output = JSON.parse(logged.join('\n'));
    assert.equal(output.summary.totals.port, 1);
    const missingCode = await runFlakyRiskScoreboard(dir, [
      'node',
      'scoreboard-test-flaky-risk.mjs',
      'nope.test.mjs',
    ]);
    assert.equal(missingCode, 2);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    await rm(dir, { recursive: true, force: true });
  }
});
