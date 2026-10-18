import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  blankNonCode,
  findNamedConstantStarts,
  findNumericLiterals,
  formatMagicNumbersReport,
  isObviousLiteral,
  isScannedFile,
  scanMagicNumbers,
  summarizeMagicNumbers,
} from './magicNumbers.js';

const scan = (file, source) => scanMagicNumbers([{ file, source }])[0];

describe('blankNonCode', () => {
  it('blanks line comments but keeps code on other lines', () => {
    const blanked = blankNonCode(
      'const a = 2;\n// retry 3 times\nconst b = 4;',
    );
    const lits = findNumericLiterals(blanked);
    assert.deepEqual(
      lits.map((l) => l.raw),
      ['2', '4'],
    );
    assert.equal(lits[1].line, 3);
  });

  it('blanks block comments without shifting later line numbers', () => {
    const blanked = blankNonCode('/* budget 500 */\nconst x = 7;');
    const lits = findNumericLiterals(blanked);
    assert.equal(lits.length, 1);
    assert.equal(lits[0].raw, '7');
    assert.equal(lits[0].line, 2);
  });

  it('blanks string contents but scans template interpolations', () => {
    const blanked = blankNonCode(
      "const msg = 'error 404';\nconst t = `try ${3} of ${n}`;",
    );
    const lits = findNumericLiterals(blanked);
    assert.deepEqual(
      lits.map((l) => l.raw),
      ['3'],
    );
  });

  it('handles nested templates inside interpolations', () => {
    const blanked = blankNonCode('const t = `a ${`b ${5}`} c`;');
    const lits = findNumericLiterals(blanked);
    assert.deepEqual(
      lits.map((l) => l.raw),
      ['5'],
    );
  });
});

describe('literal detection', () => {
  it('finds hex, float and scientific literals with line and column', () => {
    const lits = findNumericLiterals(
      blankNonCode(
        'const color = 0xFF0000;\nconst half = 0.5;\nconst big = 1e6;',
      ),
    );
    assert.deepEqual(
      lits.map((l) => l.raw),
      ['0xFF0000', '0.5', '1e6'],
    );
    assert.equal(lits[0].value, 0xff0000);
    assert.equal(lits[2].value, 1000000);
    assert.deepEqual([lits[1].line, lits[1].column], [2, 14]);
  });

  it('attaches a directly preceding unary minus to the literal', () => {
    const lits = findNumericLiterals(
      blankNonCode('return -42;\nconst d = a-5;'),
    );
    assert.equal(lits[0].raw, '-42');
    assert.equal(lits[0].value, -42);
    // `a-5` is binary minus: the 5 stays a positive literal.
    assert.equal(lits[1].raw, '5');
  });

  it('treats 0, 1 and -1 as obvious in any spelling', () => {
    for (const lit of findNumericLiterals(
      blankNonCode('arr[0]; i + 1; idx === -1; x(1.0); y(0x0);'),
    )) {
      assert.ok(isObviousLiteral(lit), `expected obvious: ${lit.raw}`);
    }
    assert.ok(!isObviousLiteral({ value: 2 }));
    assert.ok(!isObviousLiteral({ value: -2 }));
  });

  it('does not match digits inside identifiers', () => {
    const lits = findNumericLiterals(blankNonCode('foo(bar2, 7);'));
    assert.deepEqual(
      lits.map((l) => l.raw),
      ['7'],
    );
  });
});

describe('named-constant exemption', () => {
  it('exempts direct const/let/var initializers', () => {
    const code = blankNonCode(
      'const TIMEOUT_MS = 3000;\nlet retries = 3;\nvar backoff = 250;',
    );
    const named = findNamedConstantStarts(code);
    const lits = findNumericLiterals(code);
    assert.equal(lits.length, 3);
    for (const lit of lits) assert.ok(named.has(lit.index), lit.raw);
    assert.equal(scan('src/a.js', 'const TIMEOUT_MS = 3000;').magicCount, 0);
  });

  it('does not exempt numbers nested inside a named object', () => {
    const finding = scan('src/a.js', 'const CFG = { port: 3000 };');
    assert.equal(finding.magicCount, 1);
    assert.equal(finding.literals[0].raw, '3000');
  });

  it('does not exempt destructuring defaults', () => {
    const finding = scan('src/a.js', 'const { a = 5 } = opts;');
    assert.equal(finding.magicCount, 1);
  });
});

describe('scanMagicNumbers', () => {
  it('flags literals in logic positions: calls, comparisons, returns', () => {
    const finding = scan(
      'src/a.js',
      'setTimeout(save, 3000);\nif (score > 90) return score * 1.5;',
    );
    assert.equal(finding.magicCount, 3);
    assert.deepEqual(
      finding.literals.map((l) => l.raw),
      ['3000', '90', '1.5'],
    );
    assert.ok(finding.literals[0].snippet.includes('setTimeout'));
  });

  it('counts repeats and distinct values', () => {
    const finding = scan('src/a.js', 'a(7);\nb(7);\nc(8);');
    assert.equal(finding.magicCount, 3);
    assert.equal(finding.distinctValues, 2);
    assert.ok(finding.densityPerKloc > 0);
  });

  it('reports a clean file with zero magic', () => {
    const finding = scan('src/a.js', 'const N = 2;\narr[0];\n// nothing\n');
    assert.equal(finding.magicCount, 0);
    assert.equal(finding.distinctValues, 0);
    assert.equal(finding.literals.length, 0);
  });
});

describe('isScannedFile', () => {
  it('accepts src/ production modules and rejects the rest', () => {
    assert.ok(isScannedFile('src/foo.js'));
    assert.ok(isScannedFile('src/deep/foo.mjs'));
    assert.ok(!isScannedFile('src/foo.test.mjs'));
    assert.ok(!isScannedFile('src/tooling/foo.js'));
    assert.ok(!isScannedFile('src/testSupport/foo.js'));
    assert.ok(!isScannedFile('src/a/fixtures/b.js'));
    assert.ok(!isScannedFile('src/a/__fixtures__/b.js'));
    assert.ok(!isScannedFile('src/worker.worker.mjs'));
    assert.ok(!isScannedFile('server/foo.js'));
  });
});

describe('summarizeMagicNumbers', () => {
  it('ranks files by magic count, then distinct, then name', () => {
    const findings = scanMagicNumbers([
      { file: 'src/b.js', source: 'a(2);' },
      { file: 'src/a.js', source: 'a(2);\nb(3);\nc(3);' },
      { file: 'src/c.js', source: 'const N = 2;' },
    ]);
    const summary = summarizeMagicNumbers(findings);
    assert.equal(summary.filesScanned, 3);
    assert.equal(summary.filesWithMagic, 2);
    assert.equal(summary.totalLiterals, 4);
    assert.equal(summary.distinctValues, 2);
    assert.deepEqual(
      summary.ranked.map((f) => f.file),
      ['src/a.js', 'src/b.js'],
    );
  });
});

describe('formatMagicNumbersReport', () => {
  it('prints the OK line when there is no magic', () => {
    const findings = scanMagicNumbers([
      { file: 'src/a.js', source: 'const N = 2;' },
    ]);
    const report = formatMagicNumbersReport(
      findings,
      summarizeMagicNumbers(findings),
    );
    assert.ok(report.startsWith('Magic-number scoreboard\n'));
    assert.ok(report.includes('OK: no unnamed numeric literals'));
  });

  it('prints ranked files with examples and honours the limit', () => {
    const findings = scanMagicNumbers([
      { file: 'src/a.js', source: 'setTimeout(f, 3000);' },
      { file: 'src/b.js', source: 'if (x > 42) y(7);' },
    ]);
    const summary = summarizeMagicNumbers(findings);
    const report = formatMagicNumbersReport(findings, summary, { limit: 1 });
    assert.ok(report.includes('src/b.js: 2'));
    assert.ok(report.includes('L1: 42'));
    assert.ok(report.includes('... and 1 more file(s)'));
    assert.ok(!report.includes('src/a.js: 1'));
  });
});
