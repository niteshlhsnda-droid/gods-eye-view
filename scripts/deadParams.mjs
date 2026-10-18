// Dead-parameter scoreboard: report function parameters that are never read
// in the function body (or in another parameter's default expression).
// Report-only: exit 0 even when findings exist; `--strict` exits 1 when any
// `dead-trailing` finding exists (trailing dead params are safe to delete).
// No file writes.
//
// Usage:
//   node scripts/scoreboard-dead-params.mjs [--json] [--limit N] [--strict] [file ...]
//
// With no file arguments the whole `src/` tree is reported. With file
// arguments, only those files are shown (paths as given, e.g.
// `src/data/foo.js`). `--limit N` caps the finding list (0 means all;
// default 10).
//
// Finding classes:
//   dead-trailing   - dead param with no live params after it; deleting it
//                     cannot break positional callers (severity: warn)
//   dead-positional - dead param before a live param; kept for call shape,
//                     consider a `_` prefix or an API review (severity: info)
//
// A parameter counts as read when its name appears in the body as a value
// (shorthand `{name}`, ternaries, `this.x = name` all count). It does NOT
// count when it only appears as a property access (`obj.name`), an object
// key (`{name: 1}`), or inside a nested function that re-binds the name.
//
// LIMITS (documented; verify before deleting):
//   - Lexer-based, not a real parser: regex literals are heuristically
//     masked (`/` after `= ( , : [ ! & | ? { } ;` or a keyword); an unusual
//     division/regex split can hide or invent code.
//   - Expression-bodied arrows are handled; `eval`/dynamic property reads
//     are invisible.
//   - Functions referencing the `arguments` object are skipped entirely
//     (any param may be read dynamically).
//   - Nested `var`/`let` shadowing is not tracked, only nested function
//     params that re-bind the name.
//   - `_`-prefixed params are treated as intentionally unused and skipped.
//   - Computed destructuring keys (`{ [k]: v }`) treat `k` as bound, not
//     read (rare; verify manually).
//   - Method shorthand detection requires `{` right after the param list,
//     so `if`/`for`/`while`/`switch`/`catch` headers are excluded by keyword.

import { readdir } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_LIMIT = 10;

export const FINDING_CLASSES = ['dead-trailing', 'dead-positional'];

// Classes that fail `--strict`. `dead-positional` stays report-only because
// removing it would break positional callers.
export const STRICT_CLASSES = new Set(['dead-trailing']);

const KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'with',
  'do',
  'return',
  'typeof',
  'case',
]);

const IDENT_START = /[$A-Z_a-z]/;
const IDENT_CHAR = /[$\w]/;

function isIdent(text) {
  return /^[$A-Z_a-z][$\w]*$/.test(text);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function skipWs(text, i) {
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

export function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

// Blank a [from, to) range with spaces, preserving newlines so line numbers
// stay aligned with the original source.
function blankRange(out, from, to) {
  for (let k = from; k < to; k++) {
    if (out[k] !== '\n') out[k] = ' ';
  }
}

// Mask strings, template literals, comments, and heuristic regex literals.
// Template `${ ... }` expressions are kept (recursively masked) because they
// are real code that may read parameters.
export function maskCode(source) {
  const out = source.split('');
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      let j = i + 2;
      while (j < n && source[j] !== '\n') j++;
      blankRange(out, i, j);
      i = j;
    } else if (c === '/' && source[i + 1] === '*') {
      let j = source.indexOf('*/', i + 2);
      j = j === -1 ? n : j + 2;
      blankRange(out, i, j);
      i = j;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (source[j] === '\\') j += 2;
        else if (source[j] === c) {
          j++;
          break;
        } else j++;
      }
      blankRange(out, i, j);
      i = j;
    } else if (c === '`') {
      i = maskTemplate(source, out, i);
    } else if (c === '/' && isRegexStart(source, i)) {
      let j = i + 1;
      while (j < n) {
        if (source[j] === '\\') j += 2;
        else if (source[j] === '/') {
          j++;
          break;
        } else if (source[j] === '\n') break;
        else j++;
      }
      while (j < n && /[a-z]/i.test(source[j])) j++;
      blankRange(out, i, j);
      i = j;
    } else {
      i++;
    }
  }
  return out.join('');
}

// A `/` starts a regex literal (rather than division) when the previous
// significant token cannot end an expression.
function isRegexStart(source, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(source[j])) j--;
  if (j < 0) return true;
  const prev = source[j];
  if ('=(:,[!&|?{};'.includes(prev)) return true;
  let k = j;
  while (k >= 0 && IDENT_CHAR.test(source[k])) k--;
  const word = source.slice(k + 1, j + 1);
  return KEYWORDS.has(word);
}

function maskTemplate(source, out, i) {
  const n = source.length;
  let j = i + 1;
  let segStart = j;
  while (j < n) {
    const c = source[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '`') {
      blankRange(out, segStart, j);
      return j + 1;
    }
    if (c === '$' && source[j + 1] === '{') {
      blankRange(out, segStart, j);
      let depth = 1;
      let k = j + 2;
      while (k < n && depth > 0) {
        if (source[k] === '{') depth++;
        else if (source[k] === '}') depth--;
        k++;
      }
      const inner = maskCode(source.slice(j + 2, k - 1));
      for (let t = 0; t < inner.length; t++) out[j + 2 + t] = inner[t];
      j = k;
      segStart = j;
      continue;
    }
    j++;
  }
  blankRange(out, segStart, j);
  return j;
}

export function matchParens(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function matchParensBackward(text, close) {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (text[i] === ')') depth++;
    else if (text[i] === '(') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function matchBraces(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Split on `sep` at bracket depth 0 (parens, braces, and square brackets).
export function splitTopLevel(text, sep) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function indexOfTopLevel(text, ch) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ch && depth === 0) return i;
  }
  return -1;
}

// `obj.name` is property access (not a read), but `...name` is a spread
// read. Optional chaining (`obj?.name`) still counts as property access.
function precededByPropertyDot(text, index) {
  if (index <= 0 || text[index - 1] !== '.') return false;
  return !(index >= 3 && text[index - 2] === '.' && text[index - 3] === '.');
}

// All identifiers in `text` that are not property names after a dot
// (spread reads like `...args` count as reads).
function identifiers(text) {
  const names = [];
  const re = /[$A-Z_a-z][$\w]*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (precededByPropertyDot(text, m.index)) continue;
    names.push(m[0]);
  }
  return names;
}

// Parse one parameter segment into bound names and identifiers read by its
// default expression. Handles defaults, rest params, and nested object/
// array destructuring.
export function parsePattern(text) {
  const bound = [];
  const reads = [];
  const t = text.trim();
  if (!t) return { bound, reads };
  const eq = indexOfTopLevel(t, '=');
  let target = t;
  if (eq >= 0) {
    target = t.slice(0, eq);
    reads.push(...identifiers(t.slice(eq + 1)));
  }
  const tt = target.trim();
  if (tt.startsWith('...')) {
    const name = tt.slice(3).trim();
    if (isIdent(name)) bound.push(name);
    return { bound, reads };
  }
  if (tt.startsWith('{') && tt.endsWith('}')) {
    const inner = tt.slice(1, -1);
    for (const prop of splitTopLevel(inner, ',')) {
      const p = prop.trim();
      if (!p) continue;
      const ci = indexOfTopLevel(p, ':');
      if (ci >= 0) {
        const key = p.slice(0, ci).trim();
        if (key.startsWith('[')) {
          reads.push(...identifiers(key.slice(1, key.lastIndexOf(']'))));
        }
        const sub = parsePattern(p.slice(ci + 1));
        bound.push(...sub.bound);
        reads.push(...sub.reads);
      } else {
        const sub = parsePattern(p);
        bound.push(...sub.bound);
        reads.push(...sub.reads);
      }
    }
    return { bound, reads };
  }
  if (tt.startsWith('[') && tt.endsWith(']')) {
    const inner = tt.slice(1, -1);
    for (const el of splitTopLevel(inner, ',')) {
      const sub = parsePattern(el);
      bound.push(...sub.bound);
      reads.push(...sub.reads);
    }
    return { bound, reads };
  }
  if (isIdent(tt)) bound.push(tt);
  return { bound, reads };
}

// Find function/method/arrow definitions in masked code. Each entry carries
// the param paren range (or identifier range for paren-less arrows) and the
// body range. Nested definitions are included; callers compute shadowing.
export function findFunctions(masked) {
  const funcs = [];
  const seen = new Set();

  for (const m of masked.matchAll(/\bfunction\b/g)) {
    let i = skipWs(masked, m.index + 8);
    if (masked[i] === '*') i = skipWs(masked, i + 1);
    let name = '';
    const nm = /^[$A-Z_a-z][$\w]*/.exec(masked.slice(i, i + 64));
    if (nm) {
      name = nm[0];
      i = skipWs(masked, i + nm[0].length);
    }
    if (masked[i] !== '(') continue;
    const pClose = matchParens(masked, i);
    if (pClose < 0) continue;
    const bOpen = skipWs(masked, pClose + 1);
    if (masked[bOpen] !== '{') continue;
    const bClose = matchBraces(masked, bOpen);
    if (bClose < 0) continue;
    funcs.push({
      kind: 'function',
      name,
      headerStart: m.index,
      paramsStart: i,
      paramsEnd: pClose,
      bodyStart: bOpen,
      bodyEnd: bClose,
    });
    seen.add(i);
  }

  // Method shorthand: `name(params) {` — the `(` must be preceded by a bare
  // identifier (not `.name`, not a call result) and followed by a block.
  for (const m of masked.matchAll(/\(/g)) {
    const open = m.index;
    if (seen.has(open)) continue;
    let j = open - 1;
    while (j >= 0 && /\s/.test(masked[j])) j--;
    const nameEnd = j + 1;
    while (j >= 0 && IDENT_CHAR.test(masked[j])) j--;
    const name = masked.slice(j + 1, nameEnd);
    if (!name || KEYWORDS.has(name)) continue;
    const prev = masked[j];
    if (prev && (IDENT_CHAR.test(prev) || prev === '.')) continue;
    if (/\bfunction\s*$/.test(masked.slice(Math.max(0, j - 9), j + 1)))
      continue;
    const pClose = matchParens(masked, open);
    if (pClose < 0) continue;
    const bOpen = skipWs(masked, pClose + 1);
    if (masked[bOpen] !== '{') continue;
    const bClose = matchBraces(masked, bOpen);
    if (bClose < 0) continue;
    funcs.push({
      kind: 'method',
      name,
      headerStart: j + 1,
      paramsStart: open,
      paramsEnd: pClose,
      bodyStart: bOpen,
      bodyEnd: bClose,
    });
    seen.add(open);
  }

  for (const m of masked.matchAll(/=>/g)) {
    const arrow = m.index;
    let j = arrow - 1;
    while (j >= 0 && /\s/.test(masked[j])) j--;
    let paramsStart;
    let paramsEnd;
    let headerStart;
    if (masked[j] === ')') {
      const open = matchParensBackward(masked, j);
      if (open < 0) continue;
      paramsStart = open;
      paramsEnd = j;
      headerStart = open;
    } else {
      let k = j;
      while (k >= 0 && IDENT_CHAR.test(masked[k])) k--;
      const name = masked.slice(k + 1, j + 1);
      if (!name || KEYWORDS.has(name)) continue;
      paramsStart = k + 1;
      paramsEnd = j + 1;
      headerStart = k + 1;
    }
    if (seen.has(paramsStart)) continue;
    let b = skipWs(masked, arrow + 2);
    let bodyStart;
    let bodyEnd;
    if (masked[b] === '{') {
      const bClose = matchBraces(masked, b);
      if (bClose < 0) continue;
      bodyStart = b;
      bodyEnd = bClose;
    } else {
      let depth = 0;
      let k = b;
      while (k < masked.length) {
        const c = masked[k];
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') {
          if (depth === 0) break;
          depth--;
        } else if (depth === 0 && (c === ',' || c === ';')) break;
        k++;
      }
      bodyStart = b;
      bodyEnd = k;
    }
    funcs.push({
      kind: 'arrow',
      name: '',
      headerStart,
      paramsStart,
      paramsEnd,
      bodyStart,
      bodyEnd,
    });
    seen.add(paramsStart);
  }

  funcs.sort((a, b) => a.headerStart - b.headerStart);
  return funcs;
}

function usesArgumentsObject(masked, fn) {
  const body = masked.slice(fn.bodyStart, fn.bodyEnd);
  const re = /(?<![\w$])arguments(?![\w$])/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (precededByPropertyDot(body, m.index)) continue;
    return true;
  }
  return false;
}

// Does `name` occur in `text` as a value read (not a property access, not an
// object key)? `exclude` holds [start, end) ranges to ignore (shadowing).
function isReadIn(name, text, baseOffset, exclude) {
  const re = new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const abs = baseOffset + m.index;
    if (exclude.some(([s, e]) => abs >= s && abs < e)) continue;
    if (precededByPropertyDot(text, m.index)) continue;
    // Object key `{name: ...}` / `{a, name: ...}`: skip, but `case name:`
    // and labels aside, a `:` after the name with `{` or `,` before it is
    // a key position, not a read.
    let k = m.index + m[0].length;
    while (k < text.length && /\s/.test(text[k])) k++;
    if (text[k] === ':') {
      let q = m.index - 1;
      while (q >= 0 && /\s/.test(text[q])) q--;
      const before = text[q];
      if (before === '{' || before === ',') continue;
      const wordBefore = /[$A-Z_a-z][$\w]*$/.exec(text.slice(0, m.index));
      if (wordBefore && wordBefore[0] !== 'case') continue;
    }
    return true;
  }
  return false;
}

// Analyze one source string. Returns findings sorted by line.
export function analyzeSource(source, file = '<input>') {
  const masked = maskCode(source);
  const funcs = findFunctions(masked);
  const findings = [];

  for (const fn of funcs) {
    if (usesArgumentsObject(masked, fn)) continue;
    const parenParams = masked[fn.paramsStart] === '(';
    const paramsRaw = parenParams
      ? masked.slice(fn.paramsStart + 1, fn.paramsEnd)
      : masked.slice(fn.paramsStart, fn.paramsEnd);
    const segments = parenParams ? splitTopLevel(paramsRaw, ',') : [paramsRaw];
    const parsed = segments.map((seg) => parsePattern(seg));
    const segOffset = [];
    let cursor = parenParams ? fn.paramsStart + 1 : fn.paramsStart;
    for (const seg of segments) {
      segOffset.push(cursor);
      cursor += seg.length + 1;
    }

    // Nested functions that re-bind a name shadow the outer param inside
    // their range.
    const shadowRangesFor = (name) =>
      funcs
        .filter(
          (g) =>
            g !== fn &&
            g.headerStart >= fn.bodyStart &&
            g.bodyEnd <= fn.bodyEnd &&
            parsedNames(g, masked).includes(name),
        )
        .map((g) => [g.headerStart, g.bodyEnd]);

    const bodyText = masked.slice(fn.bodyStart, fn.bodyEnd);
    const deadFlags = parsed.map((p, i) => {
      // Default expressions of the OTHER params may read this param.
      const otherDefaultReads = parsed
        .filter((_, j) => j !== i)
        .flatMap((q) => q.reads)
        .join('\n');
      const live = p.bound.filter((name) => {
        if (name.startsWith('_')) return true; // intentionally unused
        const exclude = shadowRangesFor(name);
        if (isReadIn(name, bodyText, fn.bodyStart, exclude)) return true;
        if (
          otherDefaultReads &&
          isReadIn(name, otherDefaultReads, -1_000_000_000, [])
        )
          return true;
        return false;
      });
      return {
        seg: i,
        bound: p.bound,
        dead: p.bound.filter((n) => !live.includes(n)),
      };
    });

    // Classify: dead with no live param after it is trailing (deletable).
    const liveAfter = (i) =>
      deadFlags
        .slice(i + 1)
        .some((d) => d.bound.some((n) => !d.dead.includes(n)));
    deadFlags.forEach((d, i) => {
      for (const name of d.dead) {
        const cls = liveAfter(i) ? 'dead-positional' : 'dead-trailing';
        const nameAt = new RegExp(
          `(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`,
        ).exec(segments[i]);
        findings.push({
          file,
          line: lineAt(source, segOffset[i] + (nameAt ? nameAt.index : 0)),
          fn: fn.name || '<anonymous>',
          kind: fn.kind,
          param: name,
          class: cls,
          severity: cls === 'dead-trailing' ? 'warn' : 'info',
          detail:
            cls === 'dead-trailing'
              ? 'never read; trailing, safe to delete'
              : 'never read; positional, kept for call shape',
        });
      }
    });
  }

  findings.sort((a, b) => a.line - b.line || a.param.localeCompare(b.param));
  return findings;
}

// Bound names of another function (used for shadow-range computation).
function parsedNames(fn, masked) {
  const parenParams = masked[fn.paramsStart] === '(';
  const paramsRaw = parenParams
    ? masked.slice(fn.paramsStart + 1, fn.paramsEnd)
    : masked.slice(fn.paramsStart, fn.paramsEnd);
  const segments = parenParams ? splitTopLevel(paramsRaw, ',') : [paramsRaw];
  return segments.flatMap((seg) => parsePattern(seg).bound);
}

// Discover .js/.mjs sources under src/ (test files excluded: test callbacks
// follow different unused-param conventions). Lives in scripts/ so the
// node:fs import never crosses the browser module boundary.
export async function discoverSourceFiles(root) {
  const srcDir = path.join(root, 'src');
  const found = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') await walk(full);
      } else if (
        (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) &&
        !entry.name.endsWith('.test.mjs')
      ) {
        found.push(path.relative(root, full));
      }
    }
  }
  await walk(srcDir);
  return found.sort();
}

// Scan every file in `files`. `readFile` is injected so tests can use
// in-memory fakes; the CLI wires the real filesystem.
export async function analyzeFiles(files, { readFile }) {
  const results = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const findings = analyzeSource(source, file);
    const masked = maskCode(source);
    results.push({ file, findings, functions: findFunctions(masked).length });
  }
  return results;
}

export function filterFindingsByFiles(findings, files) {
  if (!files.length) return findings;
  const wanted = new Set(files);
  return findings.filter((f) => wanted.has(f.file));
}

export function limitFindings(findings, limit) {
  if (!limit || limit <= 0) return findings;
  return findings.slice(0, limit);
}

export function summarizeResults(results) {
  const findings = results.flatMap((r) => r.findings);
  const byClass = {};
  for (const cls of FINDING_CLASSES) byClass[cls] = 0;
  for (const f of findings) byClass[f.class] = (byClass[f.class] || 0) + 1;
  return {
    files: results.length,
    functions: results.reduce((n, r) => n + r.functions, 0),
    findings: findings.length,
    byClass,
    filesWithFindings: results.filter((r) => r.findings.length).length,
  };
}

export function rankOffenders(results) {
  return results
    .filter((r) => r.findings.length)
    .map((r) => ({ file: r.file, findings: r.findings.length }))
    .sort((a, b) => b.findings - a.findings || a.file.localeCompare(b.file));
}

export function formatDeadParamsReport(results, summary, ranked, findings) {
  const lines = [];
  lines.push('Dead-parameter scoreboard (report-only)');
  lines.push(
    `Scanned ${summary.files} files, ${summary.functions} functions: ` +
      `${summary.findings} dead params in ${summary.filesWithFindings} files`,
  );
  for (const cls of FINDING_CLASSES) {
    lines.push(`  ${cls}: ${summary.byClass[cls] || 0}`);
  }
  lines.push('');
  if (ranked.length) {
    lines.push('Top files by dead-param count:');
    for (const r of ranked.slice(0, 10)) {
      lines.push(`  ${r.findings}x  ${r.file}`);
    }
    lines.push('');
  }
  if (findings.length) {
    lines.push('Findings:');
    for (const f of findings) {
      lines.push(
        `  ${f.file}:${f.line}  ${f.fn}() param '${f.param}' [${f.class}] — ${f.detail}`,
      );
    }
  } else {
    lines.push('No dead parameters found.');
  }
  return lines.join('\n');
}

export function parseCliArgs(argv) {
  const args = {
    json: false,
    limit: DEFAULT_LIMIT,
    strict: false,
    help: false,
    files: [],
    error: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--limit') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 0) {
        args.error = `--limit needs a non-negative integer (got '${argv[i]}')`;
        break;
      }
      args.limit = v;
    } else if (a.startsWith('--limit=')) {
      const v = Number(a.slice('--limit='.length));
      if (!Number.isInteger(v) || v < 0) {
        args.error = `--limit needs a non-negative integer (got '${a}')`;
        break;
      }
      args.limit = v;
    } else if (a.startsWith('-')) {
      args.error = `unknown flag '${a}'`;
      break;
    } else {
      args.files.push(a);
    }
  }
  return args;
}
