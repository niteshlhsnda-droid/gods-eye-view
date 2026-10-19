// No-op-promise scoreboard: strict-policy static audit of promise
// handlers across src/ that silently swallow errors or discard results.
//
// Where the error-swallowing scoreboard is lenient (named handlers are
// left alone because the scanner cannot tell whether they log), this
// scoreboard is the `--strict` policy start: it flags every no-op
// promise handler shape, including named ones, when the name is an
// explicit swallow-marker.
//
// Finding classes (all severity `error`; all fail `--strict`):
// - noop-catch-anonymous: `.catch(() => {})`, `.catch((e) => {})`,
//   `.catch(() => undefined|null|void 0)`, `.catch(function () {})`,
//   `.catch()` with no handler at all, and the same shapes as the
//   rejection argument of `.then(onFulfilled, <no-op>)`.
// - noop-catch-named: `.catch(noop)`, `.catch(NOOP)`,
//   `.then(onFulfilled, ignoreErrors)`, `.catch(util.noop)` — a bare
//   identifier or member chain whose final name matches a deliberate
//   swallow-marker (`noop`, `ignore`, `ignoreError(s)`, `swallow`,
//   `discard`, ...). `.catch(console.error)` is NOT flagged.
// - noop-then-fulfillment: `.then(() => {})`,
//   `.then(() => undefined)`, `.then(noop)`, `.then()` — a no-op
//   fulfillment handler discards the promise result.
//
// Heuristic, not a parser: comments and string/template text are
// blanked (offsets preserved) so handlers inside strings are ignored,
// but handlers inside a regex literal are still scanned as code.
// `?.catch(` / `?.then(` are handled like their plain forms.
// Report-only: no file writes. Exit 0 even when findings exist;
// `--strict` exits 1 on any finding.

import {
  blankCommentsAndStrings,
  discoverSourceFiles as discoverHouseSourceFiles,
} from './complexityHotspots.mjs';
import {
  isNoopHandler,
  lineAt,
  matchParens,
  splitTopLevelArgs,
} from './errorSwallowing.mjs';

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

export const DEFAULT_LIMIT = 10;

export const FINDING_CLASSES = [
  'noop-catch-anonymous',
  'noop-catch-named',
  'noop-then-fulfillment',
];

// Every class is error-severity: --strict fails on any finding. This
// is deliberate — the scoreboard is the strict-policy start.
export const STRICT_CLASSES = new Set(FINDING_CLASSES);

// A bare identifier (or member chain whose final name) counts as a
// deliberate swallow-marker when it matches. The set is conservative:
// only names whose whole job is "do nothing with this value".
const NOOP_NAME =
  /^(?:_?noop\d*(?:fn)?|ignore(?:errors?|err)?|swallow(?:errors?)?|discard(?:ed)?)$/i;

const MEMBER_CHAIN =
  /^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)*[A-Za-z_$][A-Za-z0-9_$]*$/;

function isWordChar(char) {
  return char === '_' || char === '$' || /[A-Za-z0-9]/.test(char);
}

function isWordAt(code, index, word) {
  if (!code.startsWith(word, index)) return false;
  const before = index === 0 ? '' : code[index - 1];
  const after = code[index + word.length] ?? '';
  return !isWordChar(before) && !isWordChar(after);
}

// True when `expression` is a named swallow-marker handler: a bare
// identifier like `noop` or a member chain like `util.noop` whose
// final name matches NOOP_NAME. Calls (`noop()`), arrows, and member
// calls are left alone — the scanner cannot see inside them.
export function isNamedNoopHandler(expression) {
  const expr = expression.trim();
  if (!MEMBER_CHAIN.test(expr)) return false;
  const lastDot = expr.lastIndexOf('.');
  const name = lastDot === -1 ? expr : expr.slice(lastDot + 1);
  return NOOP_NAME.test(name);
}

// The display name used in finding details: the full chain
// (`util.noop`) rather than just the final name.
export function namedNoopLabel(expression) {
  return expression.trim();
}

// Analyze a `.catch(...)` / `?.catch(...)` call whose `catch` starts
// at `catchIndex`. Returns findings.
function analyzePromiseCatch(code, catchIndex, file) {
  const line = lineAt(code, catchIndex);
  let i = skipWhitespace(code, catchIndex + 5);
  if (code[i] !== '(') return [];
  const close = matchParens(code, i);
  if (close === -1) return [];
  const handler = code.slice(i + 1, close).trim();
  if (isNoopHandler(handler)) {
    return [
      {
        file,
        line,
        class: 'noop-catch-anonymous',
        severity: 'error',
        detail:
          handler === ''
            ? 'empty .catch() — no rejection handler at all'
            : 'no-op rejection handler discards the error',
      },
    ];
  }
  if (isNamedNoopHandler(handler)) {
    return [
      {
        file,
        line,
        class: 'noop-catch-named',
        severity: 'error',
        detail: `named no-op rejection handler '${namedNoopLabel(handler)}' discards the error`,
      },
    ];
  }
  return [];
}

// Analyze a `.then(...)` / `?.then(...)` call whose `then` starts at
// `thenIndex`. The fulfillment argument (first) and the rejection
// argument (second) are each checked.
function analyzePromiseThen(code, thenIndex, file) {
  const findings = [];
  const line = lineAt(code, thenIndex);
  let i = skipWhitespace(code, thenIndex + 4);
  if (code[i] !== '(') return [];
  const close = matchParens(code, i);
  if (close === -1) return [];
  const args = splitTopLevelArgs(code.slice(i + 1, close));
  if (args.length === 1 && args[0].trim() === '') {
    findings.push({
      file,
      line,
      class: 'noop-then-fulfillment',
      severity: 'error',
      detail: 'empty .then() — no handlers at all',
    });
    return findings;
  }
  const fulfillment = (args[0] ?? '').trim();
  if (fulfillment !== '' && fulfillment !== undefined) {
    if (isNoopHandler(fulfillment)) {
      findings.push({
        file,
        line,
        class: 'noop-then-fulfillment',
        severity: 'error',
        detail: 'no-op fulfillment handler discards the promise result',
      });
    } else if (isNamedNoopHandler(fulfillment)) {
      findings.push({
        file,
        line,
        class: 'noop-then-fulfillment',
        severity: 'error',
        detail: `named no-op fulfillment handler '${namedNoopLabel(fulfillment)}' discards the promise result`,
      });
    }
  }
  if (args.length >= 2) {
    const rejection = args[1].trim();
    // `.then(f,)` — trailing comma with no rejection handler — is the
    // same as `.then(f)`; not a no-op handler, skip it.
    if (rejection !== '') {
      if (isNoopHandler(rejection)) {
        findings.push({
          file,
          line,
          class: 'noop-catch-anonymous',
          severity: 'error',
          detail: 'no-op .then() rejection handler discards the error',
        });
      } else if (isNamedNoopHandler(rejection)) {
        findings.push({
          file,
          line,
          class: 'noop-catch-named',
          severity: 'error',
          detail: `named no-op .then() rejection handler '${namedNoopLabel(rejection)}' discards the error`,
        });
      }
    }
  }
  return findings;
}

// All no-op-promise findings for one source text. `file` is carried
// through for reporting only.
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
      }
      i += 5;
      continue;
    }
    if (isWordAt(code, i, 'then')) {
      const before = skipWhitespaceBack(code, i - 1);
      if (before >= 0 && code[before] === '.') {
        findings.push(...analyzePromiseThen(code, i, file));
      }
      i += 4;
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

export function formatNoOpPromiseReport(
  { stats, findings },
  limit = DEFAULT_LIMIT,
) {
  const summary = summarizeResults(stats, findings);
  const lines = [
    `No-op-promise scoreboard: ${summary.files} files scanned, ` +
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
    lines.push('No no-op promise handlers found.');
  } else {
    lines.push('class                 sev    line  file: detail');
    for (const finding of limited) {
      lines.push(
        `${finding.class.padEnd(21)} ${finding.severity.padEnd(6)} ` +
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
    policy: null,
    noPolicy: false,
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
    } else if (arg === '--no-policy') {
      args.noPolicy = true;
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
    } else if (arg === '--policy') {
      const raw = argv[i + 1];
      if (raw === undefined) {
        args.error = '--policy requires a value';
        break;
      }
      i += 1;
      args.policy = raw;
    } else if (arg.startsWith('--policy=')) {
      args.policy = arg.slice('--policy='.length);
      if (args.policy.length === 0) {
        args.error = '--policy requires a value';
        break;
      }
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
