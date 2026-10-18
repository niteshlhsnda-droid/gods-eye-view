// Error-swallowing scoreboard: report-only static audit of `src/`
// error-swallowing patterns — places where thrown errors are silently
// discarded instead of logged, rethrown, or handled.
//
// Finding classes (severity `error`):
// - empty-catch: `catch {}` / `catch (e) {}` — the catch block has no
//   statements (comments are not statements).
// - unused-catch-param: `catch (err) { ... }` whose body never
//   references `err` — the error is caught and ignored. A catch that
//   rethrows (`catch (e) { throw e; }`) or logs the error is fine.
// - noop-promise-catch: `.catch(() => {})`, `.catch(() => undefined)`,
//   `.catch(() => null)`, `.then(ok, () => {})`, or `.catch()` with no
//   handler — a no-op rejection handler. Named handlers
//   (`.catch(onError)`) are NOT flagged: the scanner cannot tell
//   whether they log.
//
// Severity `risky` (never a strict failure):
// - try-finally-no-catch: `try { ... } finally { ... }` with no catch.
//   Cleanup still runs on throw, but the error propagates with no local
//   handling or logging — flagged only when the try body looks
//   throwable (contains `await` / `throw` / `new` / a call `(`).
//   Over-approximation: a body with a call that provably cannot throw
//   is still flagged; read the finding, don't just count it.
//
// Heuristic, not a parser: comments and string/template text are
// blanked (offsets preserved) so `catch` inside strings is ignored,
// but `catch` inside a regex literal is still scanned as code.
// Destructured catch params (`catch ({ message })`) only get the
// empty-body check — unused-binding analysis is skipped for them.
// Report-only: no file writes. Exit 0 even when findings exist;
// `--strict` exits 1 on any `error`-severity finding.

import {
  blankCommentsAndStrings,
  discoverSourceFiles as discoverHouseSourceFiles,
} from './complexityHotspots.mjs';

export const DEFAULT_LIMIT = 10;

export const FINDING_CLASSES = [
  'empty-catch',
  'unused-catch-param',
  'noop-promise-catch',
  'try-finally-no-catch',
];

// Classes that fail `--strict`. `try-finally-no-catch` is severity
// `risky` and stays report-only.
export const STRICT_CLASSES = new Set([
  'empty-catch',
  'unused-catch-param',
  'noop-promise-catch',
]);

function isWordChar(char) {
  return char === '_' || char === '$' || /[A-Za-z0-9]/.test(char);
}

function isWordAt(code, index, word) {
  if (!code.startsWith(word, index)) return false;
  const before = index === 0 ? '' : code[index - 1];
  const after = code[index + word.length] ?? '';
  return !isWordChar(before) && !isWordChar(after);
}

function skipWhitespace(code, index) {
  let i = index;
  while (i < code.length && /\s/.test(code[i])) i += 1;
  return i;
}

function skipWhitespaceBack(code, index) {
  let i = index;
  while (i >= 0 && /\s/.test(code[i])) i -= 1;
  return i;
}

// Index of the `}` matching the `{` at `openIndex` in already-blanked
// code (every remaining brace is structural). -1 when unbalanced.
export function matchBraces(code, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Index of the `)` matching the `(` at `openIndex` in already-blanked
// code. -1 when unbalanced.
export function matchParens(code, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// 1-based line number of `index` (blanking keeps newlines, so the
// blanked code's lines match the source's).
export function lineAt(code, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (code[i] === '\n') line += 1;
  }
  return line;
}

// Split a blanked argument list at top-level commas (depth tracked
// over parens/braces/brackets).
export function splitTopLevelArgs(args) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ',' && depth === 0) {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(args.slice(start));
  return parts;
}

const SIMPLE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// A promise rejection-handler expression is a no-op when it is an
// arrow or function with an empty body, or an arrow whose single
// expression is `undefined` / `null` / `void 0`. Named handlers
// (identifiers, member access, calls) are left alone.
export function isNoopHandler(expression) {
  const expr = expression.trim();
  if (expr === '') return true; // `.catch()` with no handler at all.
  const arrow = expr.match(
    /^(?:async\s+)?(?:\([^()]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>\s*([\s\S]*)$/,
  );
  if (arrow) {
    const body = arrow[1].trim();
    if (body.startsWith('{')) {
      // Block body: empty when the braces hold no statements. The
      // expression is blanked, so braces are structural.
      const close = matchBraces(body, 0);
      return close !== -1 && body.slice(1, close).trim() === '';
    }
    return (
      body === '' ||
      body === 'undefined' ||
      body === 'null' ||
      /^void\s+0$/.test(body)
    );
  }
  const func = expr.match(
    /^function\s*(?:[A-Za-z_$][A-Za-z0-9_$]*)?\s*\([^()]*\)\s*\{([\s\S]*)$/,
  );
  if (func) {
    // Balance from the body's opening brace to find its end; the
    // expression is blanked, so braces are structural.
    const open = expr.indexOf('{');
    const close = matchBraces(expr, open);
    if (close !== -1 && expr.slice(open + 1, close).trim() === '') {
      return true;
    }
    return false;
  }
  return false;
}

// A try body "can throw" when it awaits, throws, allocates, or calls
// anything. Deliberately an over-approximation — see the header.
function tryBodyCanThrow(body) {
  return /\b(await|throw|new)\b/.test(body) || body.includes('(');
}

// Analyze a `catch` clause starting at `catchIndex` (the `c` of a
// bare `catch`, not `.catch(`). Returns findings.
function analyzeCatchClause(code, catchIndex, file) {
  const line = lineAt(code, catchIndex);
  let i = skipWhitespace(code, catchIndex + 5);
  let param = null;
  if (code[i] === '(') {
    const close = matchParens(code, i);
    if (close === -1) return [];
    const raw = code.slice(i + 1, close).trim();
    param = raw === '' ? null : raw;
    i = skipWhitespace(code, close + 1);
  }
  if (code[i] !== '{') return [];
  const close = matchBraces(code, i);
  if (close === -1) return [];
  const body = code.slice(i + 1, close);
  if (body.trim() === '') {
    return [
      {
        file,
        line,
        class: 'empty-catch',
        severity: 'error',
        detail: 'catch block has no statements',
      },
    ];
  }
  if (param !== null && SIMPLE_IDENTIFIER.test(param)) {
    const used = new RegExp(`\\b${param}\\b`).test(body);
    if (!used) {
      return [
        {
          file,
          line,
          class: 'unused-catch-param',
          severity: 'error',
          detail: `error param '${param}' is never referenced in the catch body`,
        },
      ];
    }
  }
  return [];
}

// Analyze a `.catch(...)` / `p?.catch(...)` call whose `catch` starts
// at `catchIndex`. Returns findings.
function analyzePromiseCatch(code, catchIndex, file) {
  const line = lineAt(code, catchIndex);
  let i = skipWhitespace(code, catchIndex + 5);
  if (code[i] !== '(') return [];
  const close = matchParens(code, i);
  if (close === -1) return [];
  const args = code.slice(i + 1, close);
  if (isNoopHandler(args)) {
    return [
      {
        file,
        line,
        class: 'noop-promise-catch',
        severity: 'error',
        detail: 'no-op rejection handler discards the error',
      },
    ];
  }
  return [];
}

// Analyze a `.then(a, b)` call whose `then` starts at `thenIndex`.
// Only the rejection handler (second argument) is checked.
function analyzeThenRejection(code, thenIndex, file) {
  const line = lineAt(code, thenIndex);
  let i = skipWhitespace(code, thenIndex + 4);
  if (code[i] !== '(') return [];
  const close = matchParens(code, i);
  if (close === -1) return [];
  const args = splitTopLevelArgs(code.slice(i + 1, close));
  if (args.length < 2) return [];
  if (isNoopHandler(args[1])) {
    return [
      {
        file,
        line,
        class: 'noop-promise-catch',
        severity: 'error',
        detail: 'no-op .then() rejection handler discards the error',
      },
    ];
  }
  return [];
}

// Analyze a `try` block starting at `tryIndex`. Only flags
// `try {} finally {}` (no catch) with a throwable-looking body.
function analyzeTryFinally(code, tryIndex, file) {
  const line = lineAt(code, tryIndex);
  let i = skipWhitespace(code, tryIndex + 3);
  if (code[i] !== '{') return [];
  const close = matchBraces(code, i);
  if (close === -1) return [];
  const body = code.slice(i + 1, close);
  i = skipWhitespace(code, close + 1);
  if (isWordAt(code, i, 'catch')) return []; // has a catch — not ours
  if (!isWordAt(code, i, 'finally')) return [];
  if (body.trim() === '' || !tryBodyCanThrow(body)) return [];
  return [
    {
      file,
      line,
      class: 'try-finally-no-catch',
      severity: 'risky',
      detail:
        'try body may throw but there is no catch — nothing logs the error locally',
    },
  ];
}

// All error-swallowing findings for one source text. `file` is
// carried through for reporting only.
export function analyzeSource(source, file) {
  const { code } = blankCommentsAndStrings(source);
  const findings = [];
  let i = 0;
  while (i < code.length) {
    if (isWordAt(code, i, 'catch')) {
      // `.catch(` / `?.catch(` — the char before (past whitespace)
      // is `.` either way.
      const before = skipWhitespaceBack(code, i - 1);
      if (before >= 0 && code[before] === '.') {
        findings.push(...analyzePromiseCatch(code, i, file));
      } else {
        findings.push(...analyzeCatchClause(code, i, file));
      }
      i += 5;
      continue;
    }
    if (isWordAt(code, i, 'then')) {
      const before = skipWhitespaceBack(code, i - 1);
      if (before >= 0 && code[before] === '.') {
        findings.push(...analyzeThenRejection(code, i, file));
      }
      i += 4;
      continue;
    }
    if (isWordAt(code, i, 'try')) {
      findings.push(...analyzeTryFinally(code, i, file));
      i += 3;
      continue;
    }
    i += 1;
  }
  return findings;
}

// Same file scope as the other scoreboards: `src/**/*.js|mjs`
// except `*.test.mjs`, root-relative, sorted. Reuses the house
// discovery so every scoreboard scans the same set.
export async function discoverSourceFiles(root) {
  return discoverHouseSourceFiles(root);
}

// Scan every file in `files`. `readFile` is injected so tests can
// use in-memory fakes; the CLI wires the real filesystem.
export async function analyzeFiles(files, { readFile }) {
  const findings = [];
  const byClass = {};
  for (const name of FINDING_CLASSES) byClass[name] = 0;
  const filesWithFindings = new Set();
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const fileFindings = analyzeSource(source, file);
    for (const finding of fileFindings) {
      findings.push(finding);
      byClass[finding.class] += 1;
      filesWithFindings.add(file);
    }
  }
  return {
    findings,
    stats: {
      files: files.length,
      totalFindings: findings.length,
      filesWithFindings: filesWithFindings.size,
      byClass,
    },
  };
}

// Per-file finding counts, ranked: count desc, file asc.
// Deterministic — no wall-clock or hash order.
export function rankOffenders(findings) {
  const counts = new Map();
  for (const finding of findings) {
    counts.set(finding.file, (counts.get(finding.file) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.file < b.file) return -1;
      if (a.file > b.file) return 1;
      return 0;
    });
}

// Keep only findings for `files`. Empty `files` keeps everything.
export function filterFindingsByFiles(findings, files) {
  if (!files.length) return findings;
  const wanted = new Set(files);
  return findings.filter((finding) => wanted.has(finding.file));
}

export function limitFindings(findings, limit) {
  return limit === 0 ? findings : findings.slice(0, limit);
}

export function summarizeResults(stats, findings) {
  const ranked = rankOffenders(findings);
  return {
    ...stats,
    topFile: ranked[0]?.file ?? null,
    topFileCount: ranked[0]?.count ?? 0,
  };
}

function formatByClass(byClass) {
  return FINDING_CLASSES.map((name) => `${byClass[name] ?? 0} ${name}`).join(
    ', ',
  );
}

export function formatErrorSwallowingReport(
  { stats, findings },
  limit = DEFAULT_LIMIT,
) {
  const summary = summarizeResults(stats, findings);
  const lines = [
    `Error-swallowing scoreboard: ${summary.files} files scanned, ` +
      `${summary.totalFindings} findings ` +
      `(${formatByClass(summary.byClass)})`,
    `Files with findings: ${summary.filesWithFindings}` +
      (summary.topFile
        ? ` | top offender: ${summary.topFile} (${summary.topFileCount})`
        : ''),
    '',
  ];
  const limited = limitFindings(
    [...findings].sort((a, b) => {
      if (a.file < b.file) return -1;
      if (a.file > b.file) return 1;
      return a.line - b.line;
    }),
    limit,
  );
  if (!limited.length) {
    lines.push('No swallowed errors found.');
  } else {
    lines.push('class               sev    line  file: detail');
    for (const finding of limited) {
      lines.push(
        `${finding.class.padEnd(19)} ${finding.severity.padEnd(6)} ` +
          `${String(finding.line).padStart(4)}  ${finding.file}: ${finding.detail}`,
      );
    }
    if (limited.length < findings.length) {
      lines.push(
        `... and ${findings.length - limited.length} more finding(s) (use --limit 0 to show all).`,
      );
    }
  }
  return lines.join('\n');
}

export function parseCliArgs(argv) {
  const args = {
    json: false,
    limit: DEFAULT_LIMIT,
    strict: false,
    help: false,
    positional: [],
    error: null,
  };
  const parseLimit = (raw) => {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      args.error = `--limit must be a non-negative integer (got ${raw})`;
      return null;
    }
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--strict') {
      args.strict = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--limit') {
      const raw = argv[i + 1];
      if (raw === undefined) {
        args.error = '--limit requires a value';
        break;
      }
      i += 1;
      const value = parseLimit(raw);
      if (value === null) break;
      args.limit = value;
    } else if (arg.startsWith('--limit=')) {
      const value = parseLimit(arg.slice('--limit='.length));
      if (value === null) break;
      args.limit = value;
    } else if (arg.startsWith('--')) {
      args.error = `unknown option ${arg}`;
      break;
    } else {
      args.positional.push(arg);
    }
  }
  return args;
}
