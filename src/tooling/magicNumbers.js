// Magic-number scoreboard: every numeric literal in src/ production code
// that is NOT obviously fine — a candidate "magic number", i.e. a value
// whose meaning is clear only from surrounding code, not from a name.
//
// What it flags: numeric literals (int, float, hex/binary/octal,
// scientific, unary-minus forms) in logic positions — function arguments,
// comparisons, return values, array indices, object property values,
// arithmetic, loop bounds, switch cases, template `${}` interpolations,
// default parameter values.
//
// What it deliberately ignores (all documented here):
// - `0`, `1`, `-1` (incl. `1.0`, `0x0`, `-0`): array starts, increments,
//   the `-1` "not found" sentinel — obvious everywhere.
// - Named-constant initializers: `const TIMEOUT_MS = 3000;` (const/let/var,
//   any identifier case) — the number has a name. Only the DIRECT
//   initializer is exempt: `const CFG = { port: 3000 };` still flags 3000,
//   because the number itself is unnamed. Destructuring defaults
//   (`const { a = 5 } = opts`) are NOT exempt — the default has no name of
//   its own and reads as a magic default at the call site.
// - Numbers inside strings, comments, and template-literal text: not code.
//   (Template `${...}` interpolations ARE scanned — they are code.)
// - Test files, fixture trees, src/tooling/, src/testSupport/,
//   *.worker.mjs: same scope as the untested-source scoreboard.
//
// Conservative by design: it cannot tell a self-evident constant from a
// magic one (`zIndex: 1000` vs `retry after 1000ms`), so every finding is a
// candidate for a human to judge — hence report-only, ranked by file so
// the worst offenders get reviewed first. The per-literal snippet shows
// enough context to decide without opening the file.
//
// Live repo state at landing: 961 scanned file(s), 584 with magic
// numbers, 10733 unnamed literal(s) (2149 distinct values). The top of the
// ranking is dominated by data-table files — coordinate arrays such as
// src/data/bhoteKoshiFloodPath.js (978 literals, lat/lon pairs in frozen
// arrays) and src/locations.js (393) are literal-by-design, not logic
// magic; the triage value is in the long tail of logic files (pixel
// offsets, z-indices, timing constants, opacity stops in src/ui,
// src/app/layers and per-layer renderers, conversion factors in src/sdr,
// thresholds in src/sim). Report-only; the number is a starting line for
// triage, not a gate target.

const SOURCE_SUFFIXES = Object.freeze(['.js', '.mjs']);

const TEST_SUFFIXES = Object.freeze(['.test.mjs', '.spec.mjs']);

/** Directories whose files are test infrastructure, not production code. */
const TEST_INFRASTRUCTURE_DIRS = Object.freeze([
  'src/tooling/',
  'src/testSupport/',
]);

const FIXTURE_SEGMENTS = Object.freeze(['fixtures', '__fixtures__']);

/** True for a repo-relative, posix-style src/ production module. */
export function isScannedFile(file) {
  if (!file.startsWith('src/')) return false;
  if (TEST_SUFFIXES.some((suffix) => file.endsWith(suffix))) return false;
  if (file.endsWith('.worker.mjs')) return false;
  if (
    TEST_INFRASTRUCTURE_DIRS.some((directory) => file.startsWith(directory))
  ) {
    return false;
  }
  if (file.split('/').some((segment) => FIXTURE_SEGMENTS.includes(segment))) {
    return false;
  }
  return SOURCE_SUFFIXES.some((suffix) => file.endsWith(suffix));
}

/**
 * Replace every non-code region (line/block comments, string literal
 * text, template-literal text) with spaces, preserving newlines so line
 * and column numbers stay exact. Template `${...}` interpolations are
 * real code and are kept. Unterminated strings/comments blank to EOF.
 */
export function blankNonCode(source) {
  const out = Array.from(source);
  const n = source.length;
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };
  // Interpolation frames while inside a template: unmatched `{` depth.
  const frames = [];
  let inTemplate = false;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1] ?? '';
    if (!inTemplate) {
      if (c === '/' && next === '/') {
        const start = i;
        i += 2;
        while (i < n && source[i] !== '\n') i++;
        blank(start, i);
      } else if (c === '/' && next === '*') {
        const start = i;
        i += 2;
        while (i < n && !(source[i] === '*' && (source[i + 1] ?? '') === '/')) {
          i++;
        }
        i = Math.min(n, i + 2);
        blank(start, i);
      } else if (c === "'" || c === '"') {
        const quote = c;
        const start = i;
        i++;
        while (i < n) {
          const d = source[i];
          if (d === '\\') i += 2;
          else if (d === quote) {
            i++;
            break;
          } else if (d === '\n') break;
          else i++;
        }
        blank(start, i);
      } else if (c === '`') {
        blank(i, i + 1);
        i++;
        inTemplate = true;
      } else if (c === '{' && frames.length > 0) {
        frames[frames.length - 1].depth++;
        i++;
      } else if (c === '}' && frames.length > 0) {
        const frame = frames[frames.length - 1];
        if (frame.depth === 0) {
          frames.pop();
          i++;
          inTemplate = true;
        } else {
          frame.depth--;
          i++;
        }
      } else {
        i++;
      }
    } else if (c === '\\') {
      blank(i, i + 2);
      i += 2;
    } else if (c === '`') {
      blank(i, i + 1);
      i++;
      // Closing a nested template returns to the interpolation's code.
      inTemplate = frames.length > 0;
    } else if (c === '$' && next === '{') {
      i += 2;
      frames.push({ depth: 0 });
      inTemplate = false;
    } else {
      if (c !== '\n') out[i] = ' ';
      i++;
    }
  }
  return out.join('');
}

const NUMBER_RE =
  /(?<![\w$.])(?:0[xX][\da-fA-F][\da-fA-F_]*|0[bB][01][01_]*|0[oO][0-7][0-7_]*|(?:\d[\d_]*(?:\.[\d_]*)?|\.[\d_]+)(?:[eE][+-]?[\d_]+)?)(?![\w$])/g;

// A `-` directly before a literal is unary (part of the literal) unless
// the character before it ends an operand — `a-5` and `(a)-5` are binary
// minus, `[-5]`, `(-5)`, `=> -5` and `return -5` are unary.
const OPERAND_ENDER_RE = /[\w$)}\]]/;

function lineStarts(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineColAt(starts, index) {
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1] <= index) line++;
  return { line: line + 1, column: index - starts[line] + 1 };
}

/**
 * Every numeric literal token in blanked code.
 * @returns {Array<{raw, value, line, column, index}>} in source order.
 */
export function findNumericLiterals(code) {
  const starts = lineStarts(code);
  const literals = [];
  for (const match of code.matchAll(NUMBER_RE)) {
    let raw = match[0];
    let index = match.index;
    const dashAt = index - 1;
    const beforeDash = dashAt - 1 >= 0 ? code[dashAt - 1] : '';
    if (
      code[dashAt] === '-' &&
      (dashAt === 0 || !OPERAND_ENDER_RE.test(beforeDash))
    ) {
      raw = `-${raw}`;
      index = dashAt;
    }
    const { line, column } = lineColAt(starts, index);
    literals.push({
      raw,
      value: Number(raw.replace(/_/g, '')),
      line,
      column,
      index,
    });
  }
  return literals;
}

/** True for the obvious literals: 0, 1, -1 (any spelling). */
export function isObviousLiteral(literal) {
  return literal.value === 0 || literal.value === 1 || literal.value === -1;
}

// `const`/`let`/`var` NAME = <number> — the literal's start indices.
const NAMED_CONST_RE =
  /(^|[;{}()\s,])(?:const|let|var)\s+[$A-Z_a-z][$\w]*\s*=\s*(-?(?:0[xX][\da-fA-F][\da-fA-F_]*|0[bB][01][01_]*|0[oO][0-7][0-7_]*|(?:\d[\d_]*(?:\.[\d_]*)?|\.[\d_]+)(?:[eE][+-]?[\d_]+)?))(?![\w$.])/gm;

/** Start indices of numeric literals that directly initialize a binding. */
export function findNamedConstantStarts(code) {
  const starts = new Set();
  for (const match of code.matchAll(NAMED_CONST_RE)) {
    // Anchor after the `=` so identifier digits (e.g. `x2`) can't match.
    const eqAt = match[0].indexOf('=');
    const numberAt = match[0].indexOf(match[2], eqAt);
    if (numberAt !== -1) starts.add(match.index + numberAt);
  }
  return starts;
}

const SNIPPET_MAX = 90;

function snippetFor(sourceLines, line) {
  const text = (sourceLines[line - 1] ?? '').trim();
  return text.length > SNIPPET_MAX
    ? `${text.slice(0, SNIPPET_MAX - 1)}…`
    : text;
}

/**
 * Scan files for magic-number candidates.
 * @param {Array<{file, source}>} fileEntries - repo-relative posix paths.
 * @returns per-file findings sorted by file.
 */
export function scanMagicNumbers(fileEntries) {
  return [...fileEntries]
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map(({ file, source }) => {
      const code = blankNonCode(source);
      const named = findNamedConstantStarts(code);
      const sourceLines = source.split('\n');
      const literals = [];
      for (const literal of findNumericLiterals(code)) {
        if (isObviousLiteral(literal)) continue;
        if (named.has(literal.index)) continue;
        literals.push({
          raw: literal.raw,
          value: literal.value,
          line: literal.line,
          column: literal.column,
          snippet: snippetFor(sourceLines, literal.line),
        });
      }
      const distinct = new Set(literals.map((literal) => literal.value));
      const loc = sourceLines.length;
      return {
        file,
        magicCount: literals.length,
        distinctValues: distinct.size,
        loc,
        densityPerKloc:
          loc === 0 ? 0 : Math.round((literals.length / loc) * 1000 * 10) / 10,
        literals,
      };
    });
}

/** Aggregate per-file findings into totals and the ranked list. */
export function summarizeMagicNumbers(findings) {
  const ranked = findings
    .filter((finding) => finding.magicCount > 0)
    .sort(
      (a, b) =>
        b.magicCount - a.magicCount ||
        b.distinctValues - a.distinctValues ||
        (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
    );
  const distinctRepo = new Set();
  for (const finding of findings) {
    for (const literal of finding.literals) distinctRepo.add(literal.value);
  }
  return {
    filesScanned: findings.length,
    filesWithMagic: ranked.length,
    totalLiterals: findings.reduce(
      (sum, finding) => sum + finding.magicCount,
      0,
    ),
    distinctValues: distinctRepo.size,
    ranked,
  };
}

/** Human-readable report: summary, then the top files with examples. */
export function formatMagicNumbersReport(
  findings,
  summary,
  { limit = 20 } = {},
) {
  const lines = ['Magic-number scoreboard'];
  if (summary.totalLiterals === 0) {
    lines.push(
      `OK: no unnamed numeric literals in ${summary.filesScanned} scanned file(s).`,
    );
  } else {
    lines.push(
      `MAGIC: ${summary.totalLiterals} unnamed numeric literal(s) ` +
        `(${summary.distinctValues} distinct) across ${summary.filesWithMagic} ` +
        `of ${summary.filesScanned} file(s):`,
    );
    for (const finding of summary.ranked.slice(0, limit)) {
      lines.push(
        `  ${finding.file}: ${finding.magicCount} ` +
          `(${finding.distinctValues} distinct, ${finding.densityPerKloc}/kloc)`,
      );
      for (const literal of finding.literals.slice(0, 3)) {
        lines.push(`    L${literal.line}: ${literal.raw} — ${literal.snippet}`);
      }
    }
    if (summary.ranked.length > limit) {
      lines.push(
        `  ... and ${summary.ranked.length - limit} more file(s) (--limit N to see more)`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
