// Test async-gap scoreboard: async work a test never waits for.
//
// A test can be green while the behaviour it meant to verify never
// finished. This scanner reports the four static signals for that, per
// test file, without executing anything:
//
// - `no-await` — an `async` test callback whose block body contains no
//   `await` and returns no promise. The runner resolves the test as soon
//   as the synchronous prefix runs; anything scheduled later (timers,
//   network, queued microtasks) can fail silently or surface as an
//   unhandled rejection attributed to a different test.
// - `fire-and-forget` — a promise-returning call used as a bare
//   expression statement: not awaited, not returned, not `.catch` /
//   `.finally`-handled, not `void`-marked. Rejections become unhandled
//   rejections. Recognised callees: `fetch(...)`,
//   `Promise.all|race|allSettled|any(...)`, a bare `new Promise(...)`,
//   and any `*Async(...)` callee.
// - `unhandled-then` — a bare (unassigned) `.then(` chain whose
//   statement has no `.catch(` or `.finally(` and is neither awaited
//   nor returned: the rejection path is unverified. A two-argument
//   `.then(onFulfilled, onRejected)` counts as handled, and an assigned
//   chain (`const p = foo.then(...)`) is not a finding — it may be
//   awaited later in the test.
// - `async-executor` — `new Promise(async (resolve, reject) => ...)`:
//   an exception thrown inside the executor rejects nothing and becomes
//   an unhandled rejection instead of rejecting the constructed promise.
//
// The scanner is static (no test execution) and comment/string/regex
// aware via maskNonCode (shared with testFlakyRisk.js): patterns inside
// comments, string literals, and regex literals are not findings.
//
// Documented limitations:
// - `no-await` only sees `test(`/`it(` callbacks. `await`s inside nested
//   functions are stripped before counting, but object-method shorthand
//   (`async run() { ... }`) and class methods inside a test body are not
//   recognised as nested scopes, so their `await`s count for the outer
//   callback (a missed finding, never a false one).
// - `fire-and-forget` cannot know that an arbitrary user function returns
//   a promise unless its name ends in `Async`. An assigned promise
//   (`const p = fetch(url)`) is not a finding: it may be awaited later.
// - Single-statement `if`/`while` bodies without braces
//   (`if (x) fetch(url);`) are not recognised as statement position.
// - A `.then(` inside a template-literal `${...}` interpolation is
//   scanned as code (same convention as the flaky-risk scanner).

import { maskNonCode } from './testFlakyRisk.js';

export const ASYNC_GAP_KINDS = Object.freeze([
  'no-await',
  'fire-and-forget',
  'unhandled-then',
  'async-executor',
]);

export const ASYNC_GAP_WEIGHTS = Object.freeze({
  'no-await': 3,
  'fire-and-forget': 4,
  'unhandled-then': 2,
  'async-executor': 3,
});

// Kinds that fail `--strict`. A floating promise inside a test can never
// verify anything, so fire-and-forget is never intentional in a committed
// test; the other kinds can be (a deliberately synchronous async
// callback, a then-chain whose rejection is asserted elsewhere).
export const STRICT_KINDS = Object.freeze(['fire-and-forget']);

const TEST_CALL_RE = /\b(test|it)\s*\(/g;
const AWAIT_RE = /\bawait\b/g;
const FIRE_AND_FORGET_CALLEE_RE =
  /(?:^|[;{}])\s*(await\s+|return\s+|void\s+)?(new\s+Promise\s*\(|fetch\s*\(|Promise\s*\.\s*(?:all|race|allSettled|any)\s*\(|(?:(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*)\s*\()/g;
const THEN_RE = /\.then\s*\(/g;
const ASYNC_EXECUTOR_RE = /\bnew\s+Promise\s*\(\s*async\b/g;
const ASYNC_ARROW_EXPR_RE = /\basync\s*(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>/g;

function lineStartsOf(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineAt(lineStarts, offset) {
  let line = 1;
  for (let i = 0; i < lineStarts.length; i += 1) {
    if (lineStarts[i] <= offset) line = i + 1;
    else break;
  }
  return line;
}

/** Index of the `}` matching the `{` at openIdx, or -1. */
function matchBrace(masked, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i += 1) {
    if (masked[i] === '{') depth += 1;
    else if (masked[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Index of the `)` matching the `(` at openIdx, or -1. */
function matchParen(masked, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i += 1) {
    if (masked[i] === '(') depth += 1;
    else if (masked[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function blankSpan(chars, from, to) {
  for (let i = from; i < to; i += 1) {
    if (chars[i] !== '\n') chars[i] = ' ';
  }
}

/**
 * Blank the bodies of functions nested inside a test-callback body so
 * their `await`s do not count for the outer callback. Handles `function`
 * declarations/expressions, arrow block bodies, and async arrow
 * expression bodies. See the module header for the recognised limits.
 */
export function stripNestedFunctions(maskedBody) {
  const chars = maskedBody.split('');
  ASYNC_ARROW_EXPR_RE.lastIndex = 0;

  const blankFunctionFrom = (fnIdx) => {
    // Find the `{` that opens the body: the first `{` at paren-depth 0.
    let parens = 0;
    for (let i = fnIdx; i < chars.length; i += 1) {
      const ch = chars[i];
      if (ch === '(') parens += 1;
      else if (ch === ')') parens -= 1;
      else if (ch === '{' && parens === 0) {
        const close = matchBrace(chars.join(''), i);
        if (close !== -1) blankSpan(chars, fnIdx, close + 1);
        return;
      }
    }
  };

  const fnRe = /\bfunction\b/g;
  let m;
  while ((m = fnRe.exec(maskedBody)) !== null) blankFunctionFrom(m.index);

  const arrowRe = /=>/g;
  while ((m = arrowRe.exec(maskedBody)) !== null) {
    let j = m.index + 2;
    while (j < chars.length && /\s/.test(chars[j])) j += 1;
    if (chars[j] === '{') {
      const close = matchBrace(chars.join(''), j);
      if (close !== -1) {
        // Blank from the start of the parameter list, not just `=>`.
        let from = m.index;
        let parens = 0;
        for (let i = m.index - 1; i >= 0; i -= 1) {
          const ch = chars[i];
          if (ch === ')') parens += 1;
          else if (ch === '(') {
            parens -= 1;
            if (parens === 0) {
              from = i;
              break;
            }
          } else if (parens === 0 && !/[A-Za-z0-9_$]/.test(ch)) {
            from = i + 1;
            break;
          }
        }
        blankSpan(chars, from, close + 1);
      }
    }
  }

  // Async arrow with an expression body: `async x => await f(x)` — the
  // await belongs to the nested arrow, so blank to the end of the
  // expression (first `;`, `,` or `)` at depth 0).
  let a;
  while ((a = ASYNC_ARROW_EXPR_RE.exec(maskedBody)) !== null) {
    const arrowIdx = maskedBody.indexOf('=>', a.index);
    if (arrowIdx === -1) continue;
    let depth = 0;
    let end = chars.length;
    for (let i = arrowIdx + 2; i < chars.length; i += 1) {
      const ch = chars[i];
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') {
        if (depth === 0) {
          end = i;
          break;
        }
        depth -= 1;
      } else if (depth === 0 && (ch === ';' || ch === ',')) {
        end = i;
        break;
      }
    }
    blankSpan(chars, a.index, end);
  }

  return chars.join('');
}

/**
 * Find `test(`/`it(` callbacks: name, async flag, body span, and whether
 * the body is an implicit-return expression. `t.test(` (method call) is
 * excluded; only the runner's top-level registration counts.
 */
export function findTestCallbacks(masked, source) {
  const callbacks = [];
  let m;
  TEST_CALL_RE.lastIndex = 0;
  while ((m = TEST_CALL_RE.exec(masked)) !== null) {
    if (m.index > 0 && masked[m.index - 1] === '.') continue;
    const openParen = masked.indexOf('(', m.index);
    const closeParen = matchParen(masked, openParen);
    if (closeParen === -1) continue;
    const argsText = masked.slice(openParen + 1, closeParen);
    // The callback is the last top-level comma-separated argument.
    let depth = 0;
    let lastComma = -1;
    for (let i = 0; i < argsText.length; i += 1) {
      const ch = argsText[i];
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
      else if (ch === ',' && depth === 0) lastComma = i;
    }
    const callbackText = argsText.slice(lastComma + 1);
    const cbMatch =
      /^\s*(async\s+)?(function\b|\((?:[^()]|\([^()]*\))*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.exec(
        callbackText,
      );
    if (!cbMatch) continue;
    const isAsync = Boolean(cbMatch[1]);
    const cbOffset = openParen + 1 + lastComma + 1 + cbMatch.index;
    let bodyStart = -1;
    let bodyEnd = -1;
    let expressionBody = false;
    if (cbMatch[2] === 'function') {
      let parens = 0;
      for (let i = cbOffset + cbMatch[0].length; i < masked.length; i += 1) {
        const ch = masked[i];
        if (ch === '(') parens += 1;
        else if (ch === ')') parens -= 1;
        else if (ch === '{' && parens === 0) {
          bodyStart = i;
          bodyEnd = matchBrace(masked, i);
          break;
        }
      }
    } else {
      const arrowIdx = masked.indexOf('=>', cbOffset);
      if (arrowIdx !== -1) {
        let j = arrowIdx + 2;
        while (j < masked.length && /\s/.test(masked[j])) j += 1;
        if (masked[j] === '{') {
          bodyStart = j;
          bodyEnd = matchBrace(masked, j);
        } else {
          expressionBody = true;
          bodyStart = j;
          bodyEnd = j;
        }
      }
    }
    if (bodyStart === -1 || (bodyEnd === -1 && !expressionBody)) continue;
    // Test name from the original source (masking blanks string bodies).
    const nameMatch =
      /^\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/.exec(
        source.slice(openParen + 1, closeParen),
      );
    callbacks.push({
      name: nameMatch ? nameMatch[1].slice(1, -1).slice(0, 80) : '(anonymous)',
      async: isAsync,
      bodyStart,
      bodyEnd,
      expressionBody,
      offset: m.index,
    });
  }
  return callbacks;
}

/**
 * Statement-position promise calls that are never awaited, returned,
 * catch-handled, or void-marked. Returns findings.
 */
export function findFireAndForget(masked) {
  const findings = [];
  let m;
  FIRE_AND_FORGET_CALLEE_RE.lastIndex = 0;
  while ((m = FIRE_AND_FORGET_CALLEE_RE.exec(masked)) !== null) {
    const prefix = (m[1] || '').trim();
    if (prefix === 'await' || prefix === 'return' || prefix === 'void') {
      continue;
    }
    const callee = m[2];
    if (
      !/^\s*new\s+Promise\s*\($/.test(callee) &&
      !/^\s*fetch\s*\($/.test(callee) &&
      !/^\s*Promise\s*\.\s*(?:all|race|allSettled|any)\s*\($/.test(callee)
    ) {
      const ident = callee
        .replace(/\s*\($/, '')
        .split('.')
        .pop();
      if (!/Async$/.test(ident)) continue;
    }
    // Statement extent: forward to the `;` at depth 0.
    let depth = 0;
    let end = masked.length;
    for (let i = m.index + m[0].length; i < masked.length; i += 1) {
      const ch = masked[i];
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
      else if (ch === ';' && depth === 0) {
        end = i;
        break;
      }
    }
    const statement = masked.slice(m.index, end);
    if (/\.catch\s*\(/.test(statement) || /\.finally\s*\(/.test(statement)) {
      continue;
    }
    findings.push({ kind: 'fire-and-forget', offset: m.index });
  }
  return findings;
}

/**
 * `.then(` chains with no rejection handling: no `.catch(`/`.finally(`
 * in the statement, not awaited/returned, and no second (rejection)
 * argument to `.then(`.
 */
export function findUnhandledThen(masked) {
  const findings = [];
  let m;
  THEN_RE.lastIndex = 0;
  while ((m = THEN_RE.exec(masked)) !== null) {
    const thenParen = masked.indexOf('(', m.index);
    const thenClose = matchParen(masked, thenParen);
    if (thenClose === -1) continue;
    // Rejection handler as second .then argument counts as handled.
    const thenArgs = masked.slice(thenParen + 1, thenClose);
    let depth = 0;
    let topCommas = 0;
    for (let i = 0; i < thenArgs.length; i += 1) {
      const ch = thenArgs[i];
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
      else if (ch === ',' && depth === 0) topCommas += 1;
    }
    if (topCommas >= 1) continue;
    // Statement extent: backward to the statement start, forward to `;`.
    // Scanning backward, a `(`/`[` at depth 0 opens a call/group whose
    // expression continues to the left (e.g. the `return` in
    // `return getData().then(...)`), so only `;` and a block-closing
    // `}` at depth 0 end the statement.
    let start = 0;
    let bDepth = 0;
    for (let i = m.index - 1; i >= 0; i -= 1) {
      const ch = masked[i];
      if (ch === ')' || ch === ']' || ch === '}') bDepth += 1;
      else if (ch === '(' || ch === '[') {
        if (bDepth > 0) bDepth -= 1;
      } else if (ch === '{') {
        if (bDepth > 0) bDepth -= 1;
        else {
          start = i + 1;
          break;
        }
      } else if (ch === ';' && bDepth === 0) {
        start = i + 1;
        break;
      }
    }
    let fDepth = 0;
    let end = masked.length;
    for (let i = thenClose + 1; i < masked.length; i += 1) {
      const ch = masked[i];
      if (ch === '(' || ch === '[' || ch === '{') fDepth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') {
        if (fDepth === 0) {
          end = i;
          break;
        }
        fDepth -= 1;
      } else if (ch === ';' && fDepth === 0) {
        end = i;
        break;
      }
    }
    const statement = masked.slice(start, end);
    if (/\.catch\s*\(/.test(statement) || /\.finally\s*\(/.test(statement)) {
      continue;
    }
    // Awaited / returned / void-marked chains are handled. Only the
    // segment after the last `;`/`{`/`}` can carry the prefix that
    // governs this `.then(` (the backward scan can over-extend through
    // a preceding block).
    const prefixTail = statement
      .slice(0, m.index - start)
      .split(/[;{}]/)
      .pop();
    if (/\b(await|return|void)\b/.test(prefixTail)) continue;
    // An assigned chain (`const p = foo.then(...)`) may be awaited later
    // in the test; only a bare floating chain is a finding.
    const noComparisons = prefixTail.replace(/===|!==|==|!=|<=|>=|=>/g, ' ');
    if (/=/.test(noComparisons)) continue;
    findings.push({ kind: 'unhandled-then', offset: m.index });
  }
  return findings;
}

export function findAsyncExecutors(masked) {
  const findings = [];
  let m;
  ASYNC_EXECUTOR_RE.lastIndex = 0;
  while ((m = ASYNC_EXECUTOR_RE.exec(masked)) !== null) {
    findings.push({ kind: 'async-executor', offset: m.index });
  }
  return findings;
}

/** Analyse one test file: findings + per-kind counts + score. */
export function analyzeTestFile(file, source) {
  const masked = maskNonCode(source);
  const lines = source.split('\n');
  const lineStarts = lineStartsOf(source);
  const findings = [];
  const push = (kind, offset) => {
    const line = lineAt(lineStarts, offset);
    const text = (lines[line - 1] ?? '').trim().slice(0, 140);
    findings.push({ file, kind, line, text });
  };

  for (const cb of findTestCallbacks(masked, source)) {
    if (!cb.async || cb.expressionBody) continue;
    const body = stripNestedFunctions(masked.slice(cb.bodyStart, cb.bodyEnd));
    AWAIT_RE.lastIndex = 0;
    let awaits = 0;
    let a;
    while ((a = AWAIT_RE.exec(body)) !== null) {
      if (a.index > 0 && body[a.index - 1] === '.') continue;
      awaits += 1;
    }
    if (awaits > 0) continue;
    // A returned promise is awaited by the runner: not a gap.
    if (/(^|[;{}])\s*return\b(?!\s*;)/.test(body)) continue;
    push('no-await', cb.offset);
    // Annotate the finding with the test name for triage.
    findings[findings.length - 1].text = `test '${cb.name}'`.slice(0, 140);
  }

  for (const finding of findFireAndForget(masked)) {
    push(finding.kind, finding.offset);
  }
  for (const finding of findUnhandledThen(masked)) {
    push(finding.kind, finding.offset);
  }
  for (const finding of findAsyncExecutors(masked)) {
    push(finding.kind, finding.offset);
  }

  findings.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
  const { counts, score } = scoreFindings(findings);
  return { file, findings, counts, score };
}

export function scoreFindings(findings) {
  const counts = {};
  for (const kind of ASYNC_GAP_KINDS) counts[kind] = 0;
  for (const finding of findings) counts[finding.kind] += 1;
  let score = 0;
  for (const kind of ASYNC_GAP_KINDS)
    score += counts[kind] * ASYNC_GAP_WEIGHTS[kind];
  return { counts, score };
}

/** Analyse a Map of file -> source (as returned by a discover helper). */
export function analyzeTestFiles(files) {
  const results = [];
  for (const [file, source] of files) {
    results.push(analyzeTestFile(file, source));
  }
  return results;
}

export function rankAsyncGapFiles(results, limit = 10) {
  const ranked = results
    .filter((result) => result.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.findings.length - a.findings.length ||
        a.file.localeCompare(b.file),
    );
  return limit > 0 ? ranked.slice(0, limit) : ranked;
}

export function summarizeResults(results) {
  const findings = results.flatMap((result) => result.findings);
  const findingsByKind = {};
  for (const kind of ASYNC_GAP_KINDS) findingsByKind[kind] = 0;
  for (const finding of findings) findingsByKind[finding.kind] += 1;
  return {
    files: results.length,
    filesWithFindings: results.filter((result) => result.findings.length > 0)
      .length,
    findings: findings.length,
    findingsByKind,
  };
}

export function formatAsyncGapReport(results, limit = 10) {
  const summary = summarizeResults(results);
  const ranked = rankAsyncGapFiles(results, limit);
  const out = [];
  out.push(
    `Async-gap scoreboard: ${summary.findings} finding(s) across ` +
      `${summary.filesWithFindings}/${summary.files} test file(s). ` +
      `Async work a test never waits for: green now, silent later.`,
  );
  out.push(
    `By kind: ${ASYNC_GAP_KINDS.map((kind) => `${kind}=${summary.findingsByKind[kind]}`).join(' ')}`,
  );
  if (ranked.length === 0) {
    out.push('No async-gap findings. Every async test awaits its work.');
    return out.join('\n');
  }
  out.push('');
  for (const result of ranked) {
    const kinds = ASYNC_GAP_KINDS.filter((kind) => result.counts[kind] > 0)
      .map((kind) => `${kind}x${result.counts[kind]}`)
      .join(' ');
    out.push(`${result.file} (score ${result.score}: ${kinds})`);
    for (const finding of result.findings) {
      out.push(`  L${finding.line} [${finding.kind}] ${finding.text}`);
    }
  }
  return out.join('\n');
}

export function parseCliArgs(argv) {
  const args = {
    json: false,
    strict: false,
    help: false,
    limit: 10,
    positional: [],
    error: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--limit' || arg.startsWith('--limit=')) {
      const raw =
        arg === '--limit' ? argv[(i += 1)] : arg.slice('--limit='.length);
      const parsed = Number(raw);
      if (
        raw === undefined ||
        raw === '' ||
        !Number.isInteger(parsed) ||
        parsed < 0
      ) {
        args.error = `--limit expects a non-negative integer, got ${String(raw)}`;
        return args;
      }
      args.limit = parsed;
    } else if (arg.startsWith('-')) {
      args.error = `unknown flag: ${arg}`;
      return args;
    } else {
      args.positional.push(arg);
    }
  }
  return args;
}
