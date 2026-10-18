import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeFiles,
  analyzeSource,
  classifyCondition,
  filterByFiles,
  formatUnreachableCodeReport,
  groupByFile,
  limitFindings,
  maskSource,
  parseCliArgs,
  summarizeResults,
  tokenize,
} from './unreachableCodeScoreboard.js';

const kinds = (findings) => findings.map((finding) => finding.kind);
const lines = (findings) => findings.map((finding) => finding.line);

describe('maskSource', () => {
  it('blanks strings, comments, and regexes but keeps newlines', () => {
    const source = 'const a = "return 1;"; // return 2;\nfoo();';
    const masked = maskSource(source);
    assert.equal(masked.split('\n').length, source.split('\n').length);
    assert.ok(!masked.includes('return 1'));
    assert.ok(!masked.includes('return 2'));
    assert.ok(masked.includes('foo'));
  });

  it('keeps template ${...} code visible', () => {
    const masked = maskSource('const s = `x ${foo()} y`;');
    assert.ok(masked.includes('foo'));
    assert.ok(!masked.includes('x '));
  });

  it('treats / as division after an operand and regex after return', () => {
    const division = maskSource('const x = a / b; foo();');
    assert.ok(division.includes('foo'));
    const regex = maskSource('return /re/.test(x);');
    assert.ok(regex.includes('return'));
    assert.ok(!regex.includes('/re/'));
  });

  it('keeps division slashes after operands, including i++ / 2', () => {
    assert.ok(maskSource('const x = a / b;').includes('/'));
    assert.ok(maskSource('const x = i++ / 2;').includes('/'));
    assert.ok(maskSource('const x = a / b / c;').includes('/'));
  });

  it('treats / after => as a regex start', () => {
    const masked = maskSource('const f = () => /re/.test(x);');
    assert.ok(!masked.includes('re'));
  });
  it('blanks regex braces so they cannot shift block matching', () => {
    const masked = maskSource('const r = /}/; foo();');
    assert.ok(!masked.includes('/}/'));
    assert.ok(masked.includes('foo'));
  });
});

describe('classifyCondition', () => {
  const classify = (code) => classifyCondition(tokenize(maskSource(code)));
  it('classifies literals, negations, and one paren layer', () => {
    assert.equal(classify('true'), 'true');
    assert.equal(classify('false'), 'false');
    assert.equal(classify('!true'), 'false');
    assert.equal(classify('!false'), 'true');
    assert.equal(classify('!!true'), 'true');
    assert.equal(classify('(false)'), 'false');
  });

  it('rejects non-constant conditions', () => {
    assert.equal(classify('x'), null);
    assert.equal(classify('0'), null);
    assert.equal(classify('x && false'), null);
    assert.equal(classify('true && false'), null);
    assert.equal(classify(''), null);
  });
});

describe('analyzeSource after-terminator', () => {
  it('flags code after return / throw / break / continue', () => {
    assert.deepEqual(
      kinds(analyzeSource('function f() { return 1; foo(); }', 'f.js')),
      ['after-terminator'],
    );
    assert.deepEqual(
      kinds(analyzeSource('function f() { throw e; foo(); }', 'f.js')),
      ['after-terminator'],
    );
    assert.deepEqual(
      kinds(analyzeSource('while (x) { if (y) break; foo(); }', 'f.js')),
      [],
    );
    assert.deepEqual(
      kinds(analyzeSource('while (x) { continue; foo(); }', 'f.js')),
      ['after-terminator'],
    );
  });

  it('flags every statement after the terminator, not just the first', () => {
    const findings = analyzeSource(
      'function f() {\n  return 1;\n  foo();\n  bar();\n}',
      'f.js',
    );
    assert.deepEqual(lines(findings), [3, 4]);
  });

  it('does not flag code after a return nested in an if block', () => {
    assert.deepEqual(
      analyzeSource('function f() { if (x) { return 1; } foo(); }', 'f.js'),
      [],
    );
  });

  it('does not flag code after an if/else whose branches both return', () => {
    assert.deepEqual(
      analyzeSource(
        'function f() { if (x) { return 1; } else { return 2; } foo(); }',
        'f.js',
      ),
      [],
    );
  });

  it('does not flag code after try/catch that returns', () => {
    assert.deepEqual(
      analyzeSource(
        'function f() { try { return 1; } catch (e) { return 2; } foo(); }',
        'f.js',
      ),
      [],
    );
  });

  it('resets at case / default labels', () => {
    assert.deepEqual(
      analyzeSource(
        'switch (x) { case 1: return 1; case 2: foo(); break; }',
        'f.js',
      ),
      [],
    );
    assert.deepEqual(
      kinds(analyzeSource('switch (x) { case 1: return 1; foo(); }', 'f.js')),
      ['after-terminator'],
    );
  });

  it('ignores return spelled inside strings and comments', () => {
    const source =
      'function f() { const s = "return 1;"; // return 2;\n foo(); return 3; }';
    assert.deepEqual(analyzeSource(source, 'f.js'), []);
  });

  it('ignores empty statements after a terminator', () => {
    assert.deepEqual(analyzeSource('function f() { return 1;; }', 'f.js'), []);
  });

  it('reports dead code inside nested functions and methods', () => {
    const arrow =
      'function f() { const h = () => { return 1; dead(); }; return 2; }';
    assert.equal(analyzeSource(arrow, 'f.js').length, 1);
    const method = 'const o = { m() { return 1; dead(); } };';
    assert.equal(analyzeSource(method, 'f.js').length, 1);
    const klass = 'class A { m() { return 1; dead(); } }';
    assert.equal(analyzeSource(klass, 'f.js').length, 1);
  });

  it('keeps template ${...} braces balanced', () => {
    const masked = maskSource('const s = `x ${foo()} y`;');
    const opens = (masked.match(/{/g) ?? []).length;
    const closes = (masked.match(/}/g) ?? []).length;
    assert.equal(opens, closes);
    assert.equal(opens, 1);
  });

  it('does not flag code after a template with ${...} groups', () => {
    const source =
      'function f() { const key = `${bias}\\n${text.toLowerCase()}`; const cached = cache.get(key); }';
    assert.deepEqual(analyzeSource(source, 'f.js'), []);
  });

  it('does not flag code in a returned object method after a template', () => {
    const source =
      'function f() { const cache = new Map(); return { async m() { const key = `${a}${b}`; const cached = cache.get(key); return cached; } }; }';
    assert.deepEqual(analyzeSource(source, 'f.js'), []);
  });

  it('still flags dead code after a template with ${...}', () => {
    const findings = analyzeSource(
      'function f() { const s = `x ${a}`; return 1; dead(); }',
      'f.js',
    );
    assert.deepEqual(kinds(findings), ['after-terminator']);
  });
  it('does not mistake division for a regex in real code', () => {
    assert.deepEqual(
      analyzeSource(
        'function f(a, b) { const x = a / b; const y = i++ / 2; return x + y; }',
        'f.js',
      ),
      [],
    );
    assert.deepEqual(
      analyzeSource('const q = total / count; foo();', 'f.js'),
      [],
    );
  });

  it('keeps a labeled block reachable', () => {
    assert.deepEqual(
      analyzeSource('function f() { foo: { return 1; } bar(); }', 'f.js'),
      [],
    );
  });
});

describe('analyzeSource constant-condition', () => {
  it('flags if (false) then-branch and if (true) else-branch', () => {
    assert.deepEqual(kinds(analyzeSource('if (false) { a(); }', 'f.js')), [
      'constant-condition',
    ]);
    assert.deepEqual(
      kinds(analyzeSource('if (true) { a(); } else { b(); }', 'f.js')),
      ['constant-condition'],
    );
    assert.deepEqual(
      kinds(analyzeSource('if (false) a(); else b();', 'f.js')),
      ['constant-condition'],
    );
  });

  it('does not flag if (true) with no else, or live conditions', () => {
    assert.deepEqual(analyzeSource('if (true) { a(); }', 'f.js'), []);
    assert.deepEqual(
      analyzeSource('if (x) { a(); } else { b(); }', 'f.js'),
      [],
    );
    assert.deepEqual(analyzeSource('if (0) { a(); }', 'f.js'), []);
  });

  it('flags while (false) and for (; false ;) bodies', () => {
    assert.deepEqual(kinds(analyzeSource('while (false) { a(); }', 'f.js')), [
      'constant-condition',
    ]);
    assert.deepEqual(kinds(analyzeSource('for (; false ;) { a(); }', 'f.js')), [
      'constant-condition',
    ]);
    assert.deepEqual(
      analyzeSource('for (let i = 0; i < 3; i++) { a(); }', 'f.js'),
      [],
    );
  });

  it('does not flag do ... while (false) — the body runs once', () => {
    assert.deepEqual(analyzeSource('do { a(); } while (false);', 'f.js'), []);
  });

  it('handles negated and parenthesised conditions', () => {
    assert.deepEqual(kinds(analyzeSource('if (!true) { a(); }', 'f.js')), [
      'constant-condition',
    ]);
    assert.deepEqual(kinds(analyzeSource('if ((false)) { a(); }', 'f.js')), [
      'constant-condition',
    ]);
  });
});

describe('helpers and CLI args', () => {
  it('filters, groups, limits, and summarizes deterministically', async () => {
    const analyzed = await analyzeFiles(['b.js', 'a.js'], {
      readFile: (file) =>
        Promise.resolve(
          file === 'a.js'
            ? 'function f() { return 1; x(); }'
            : 'function g() { return 1; y(); z(); }',
        ),
    });
    assert.equal(analyzed.filesScanned, 2);
    assert.deepEqual(
      analyzed.findings.map((finding) => finding.file),
      ['a.js', 'b.js', 'b.js'],
    );
    assert.deepEqual(filterByFiles(analyzed.findings, ['a.js']).length, 1);
    const summary = summarizeResults(analyzed, {
      findings: analyzed.findings,
    });
    assert.equal(summary.findings, 3);
    assert.equal(summary.byKind['after-terminator'], 3);
    const groups = groupByFile(analyzed.findings);
    assert.equal(groups[0].file, 'b.js');
    assert.equal(limitFindings(groups, 1).length, 1);
    assert.equal(limitFindings(groups, 0).length, 2);
    const report = formatUnreachableCodeReport(
      { summary, ranked: limitFindings(groups, 10) },
      10,
    );
    assert.ok(report.includes('3 unreachable statement(s)'));
    assert.ok(report.includes('b.js — 2'));
  });

  it('parses CLI args and rejects bad options', () => {
    assert.deepEqual(parseCliArgs(['--json', '--limit', '2', 'a.js']), {
      json: true,
      limit: 2,
      files: ['a.js'],
      help: false,
      error: null,
    });
    assert.equal(parseCliArgs(['--limit=0']).limit, 0);
    assert.ok(parseCliArgs(['--nope']).error);
    assert.ok(parseCliArgs(['--limit']).error);
    assert.ok(parseCliArgs(['--limit', '-1']).error);
    assert.ok(parseCliArgs(['--help']).help);
  });
});
