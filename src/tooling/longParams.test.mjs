import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_THRESHOLD,
  describeParam,
  formatLongParamsReport,
  isScannedFile,
  nameOf,
  scanLongParams,
  summarizeLongParams,
} from './longParams.js';

const scan = (file, source, options) =>
  scanLongParams([{ file, source }], options);

describe('isScannedFile', () => {
  it('scans src/ production .js/.mjs files', () => {
    assert.equal(isScannedFile('src/foo/bar.js'), true);
    assert.equal(isScannedFile('src/foo/bar.mjs'), true);
  });

  it('excludes tests, workers, tooling, fixtures, and non-src files', () => {
    assert.equal(isScannedFile('src/foo/bar.test.mjs'), false);
    assert.equal(isScannedFile('src/foo/bar.spec.mjs'), false);
    assert.equal(isScannedFile('src/foo/bar.worker.mjs'), false);
    assert.equal(isScannedFile('src/tooling/longParams.js'), false);
    assert.equal(isScannedFile('src/testSupport/helpers.js'), false);
    assert.equal(isScannedFile('src/foo/fixtures/bar.js'), false);
    assert.equal(isScannedFile('server/providers/x.js'), false);
    assert.equal(isScannedFile('src/foo/bar.ts'), false);
  });
});

describe('describeParam', () => {
  it('labels plain identifiers as plain', () => {
    assert.deepEqual(describeParam({ type: 'Identifier', name: 'a' }), {
      label: 'a',
      kind: 'plain',
    });
  });

  it('labels defaulted params as default but keeps the name', () => {
    assert.deepEqual(
      describeParam({
        type: 'AssignmentPattern',
        left: { type: 'Identifier', name: 'timeout' },
      }),
      { label: 'timeout', kind: 'default' },
    );
  });

  it('labels rest params with a ... prefix', () => {
    assert.deepEqual(
      describeParam({
        type: 'RestElement',
        argument: { type: 'Identifier', name: 'rest' },
      }),
      { label: '...rest', kind: 'rest' },
    );
  });

  it('labels destructured params as destructured', () => {
    assert.deepEqual(describeParam({ type: 'ObjectPattern' }), {
      label: '<destructured>',
      kind: 'destructured',
    });
    assert.deepEqual(
      describeParam({
        type: 'AssignmentPattern',
        left: { type: 'ArrayPattern' },
      }),
      { label: '<destructured>', kind: 'default' },
    );
  });
});

describe('scanLongParams', () => {
  it('flags a plain 6-param function, not a 5-param one', () => {
    const { findings } = scan(
      'src/a.js',
      'function six(a, b, c, d, e, f) {}\nfunction five(a, b, c, d, e) {}\n',
    );
    assert.deepEqual(findings, [
      {
        file: 'src/a.js',
        line: 1,
        name: 'six',
        kind: 'function',
        paramCount: 6,
        params: ['a', 'b', 'c', 'd', 'e', 'f'],
      },
    ]);
  });

  it('counts default params as one parameter each', () => {
    const { findings } = scan(
      'src/a.js',
      'function mixed(a, b = 1, c = "x", d, e, f) {}\n',
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].paramCount, 6);
    assert.deepEqual(findings[0].params, ['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('counts a rest param as one parameter', () => {
    const { findings } = scan(
      'src/a.js',
      'function withRest(a, b, c, d, e, ...rest) {}\n',
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].paramCount, 6);
    assert.deepEqual(findings[0].params, ['a', 'b', 'c', 'd', 'e', '...rest']);
  });

  it('counts each destructured param as one parameter', () => {
    const { findings } = scan(
      'src/a.js',
      'function shaped({ a, b }, [c], d, e, f, g) {}\n',
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].paramCount, 6);
    assert.deepEqual(findings[0].params, [
      '<destructured>',
      '<destructured>',
      'd',
      'e',
      'f',
      'g',
    ]);
  });

  it('flags class methods and constructors with class-qualified names', () => {
    const { findings } = scan(
      'src/a.js',
      'class Widget {\n  build(a, b, c, d, e, f) {}\n  constructor(a, b, c, d, e, f) {}\n}\n',
    );
    assert.deepEqual(
      findings.map((finding) => [finding.name, finding.kind, finding.line]),
      [
        ['Widget.build', 'method', 2],
        ['Widget.constructor', 'constructor', 3],
      ],
    );
  });

  it('flags long arrow functions with their assigned names', () => {
    const { findings } = scan(
      'src/a.js',
      'const handler = (a, b, c, d, e, f) => a;\n',
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].name, 'handler');
    assert.equal(findings[0].kind, 'arrow');
  });

  it('flags long object methods', () => {
    const { findings } = scan(
      'src/a.js',
      'const api = {\n  fetch(a, b, c, d, e, f) {},\n};\n',
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].name, 'fetch');
    assert.equal(findings[0].kind, 'method');
  });

  it('counts nested functions individually with correct lines', () => {
    const { findings } = scan(
      'src/a.js',
      'function outer(a) {\n  function inner(x, y, z, w, v, u) {}\n}\n',
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].name, 'inner');
    assert.equal(findings[0].line, 2);
  });

  it('sorts worst-first by param count', () => {
    const { findings } = scan(
      'src/a.js',
      'function mid(a, b, c, d, e, f) {}\nfunction worst(a, b, c, d, e, f, g, h) {}\n',
    );
    assert.deepEqual(
      findings.map((finding) => finding.paramCount),
      [8, 6],
    );
  });

  it('respects a custom threshold', () => {
    const { findings } = scan('src/a.js', 'function five(a, b, c, d, e) {}\n', {
      threshold: 4,
    });
    assert.equal(findings.length, 1);
    const { findings: none } = scan(
      'src/a.js',
      'function five(a, b, c, d, e) {}\n',
      { threshold: 5 },
    );
    assert.equal(none.length, 0);
  });

  it('counts files that fail to parse without failing the scan', () => {
    const { findings, stats } = scanLongParams([
      { file: 'src/a.js', source: 'function broken( {\n' },
      { file: 'src/b.js', source: 'function fine(a, b, c, d, e, f) {}\n' },
    ]);
    assert.equal(stats.parseErrors, 1);
    assert.equal(stats.filesScanned, 2);
    assert.equal(stats.functionsScanned, 1);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, 'src/b.js');
  });

  it('ignores getter/setter-shaped methods as non-offenders', () => {
    const { findings } = scan(
      'src/a.js',
      'class Widget {\n  get size() { return 1; }\n  set size(v) {}\n}\n',
    );
    assert.equal(findings.length, 0);
  });
});

describe('nameOf', () => {
  it('names anonymous default-exported functions as anonymous', () => {
    const { findings } = scan(
      'src/a.js',
      'export default function(a, b, c, d, e, f) {}\n',
    );
    assert.equal(findings[0].name, '<anonymous>');
  });
});

describe('summarizeLongParams', () => {
  it('rolls findings and stats up to a summary', () => {
    const { findings, stats } = scan(
      'src/a.js',
      'function six(a, b, c, d, e, f) {}\nfunction eight(a, b, c, d, e, f, g, h) {}\nfunction ok(a) {}\n',
    );
    const summary = summarizeLongParams(findings, stats, {
      threshold: DEFAULT_THRESHOLD,
    });
    assert.deepEqual(summary, {
      threshold: 5,
      filesScanned: 1,
      functionsScanned: 3,
      offenders: 2,
      parseErrors: 0,
      maxParamCount: 8,
    });
  });
});

describe('formatLongParamsReport', () => {
  it('lists offenders with file:line, name, count, and params', () => {
    const { findings, stats } = scan(
      'src/a.js',
      'function six(a, b, c, d, e, f) {}\n',
    );
    const summary = summarizeLongParams(findings, stats, { threshold: 5 });
    const report = formatLongParamsReport(findings, summary, { limit: 20 });
    assert.match(
      report,
      /src\/a\.js:1 — six \(function\) — 6 params \(a, b, c, d, e, f\)/,
    );
  });

  it('says so when nothing is over threshold', () => {
    const { findings, stats } = scan('src/a.js', 'function ok(a) {}\n');
    const summary = summarizeLongParams(findings, stats, { threshold: 5 });
    assert.match(
      formatLongParamsReport(findings, summary, {}),
      /No functions over the threshold/,
    );
  });

  it('caps the human list at the limit and notes the remainder', () => {
    const { findings, stats } = scanLongParams([
      { file: 'src/a.js', source: 'function six(a, b, c, d, e, f) {}\n' },
      { file: 'src/b.js', source: 'function six(a, b, c, d, e, f) {}\n' },
    ]);
    const summary = summarizeLongParams(findings, stats, { threshold: 5 });
    const report = formatLongParamsReport(findings, summary, { limit: 1 });
    assert.match(report, /… and 1 more/);
  });
});
