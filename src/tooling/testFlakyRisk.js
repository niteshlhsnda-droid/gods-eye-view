// Test flaky-risk scoreboard: static signals that make a passing test
// flaky in a later run.
//
// A test can be green today and red tomorrow when it depends on something
// outside its own control. This scanner reports the static signals for
// that, per test file, without executing anything:
//
// - `real-timer` — `setTimeout` / `setInterval` / `setImmediate`: the test
//   waits a fixed wall-clock amount and hopes the work finished in time.
// - `real-clock` — `Date.now()` / `new Date()` / `performance.now()`:
//   assertions that depend on the actual current time (midnight,
//   DST, slow CI) can flip.
// - `random` — `Math.random()` / `crypto.random*`: nondeterministic
//   inputs make failures unreproducible.
// - `network` — `fetch` / `WebSocket` / `EventSource` /
//   `XMLHttpRequest`: real network in a unit test (a stubbed global
//   `fetch` still counts — the stub itself is load-bearing, and the
//   test breaks if the stub's shape drifts).
// - `filesystem` — `fs.*` calls, or bare `readFile` / `writeFile` /
//   `mkdtemp` / … when the file imports `node:fs*`: real disk state
//   (leftover fixtures, parallel runs, read-only checkouts) leaks in.
// - `env-mutation` — writes to / deletes from `process.env`, or
//   `process.chdir`: mutates process-global state other test files
//   in the same worker can observe.
// - `shared-state` — a top-level `let` / `var` in the test file:
//   mutable module state shared by every test in the file, so the
//   result can depend on test order.
// - `global-mutation` — assignments to `globalThis.*` / `global.*` or
//   `Object.defineProperty(globalThis, …)`: same cross-test leakage,
//   process-wide.
// - `port` — `.listen(<nonzero>)`: a hardcoded port collides when
//   tests run in parallel or the port is already in use. The repo
//   convention is `.listen(0, …)` (ephemeral port); any nonzero port
//   is a deviation.
//
// Scoring is a weighted sum of findings (see FLAKY_WEIGHTS). It is a
// triage ranking, not a verdict: several signals are intentional when
// guarded (a save/restore wrapper around env mutation, a `listen(0)`),
// which is why only `port` fails `--strict` — a nonzero listen port is
// never intentional in this repo's tests.
//
// The scanner is comment/string/regex aware: patterns inside comments,
// string literals, and regex literals are not findings. Template-literal
// `${…}` interpolations are scanned as code, so a `fetch(` call inside
// an interpolation counts (a `fetch(` in the literal text does not).
// A call-shaped match whose closing paren is followed by `{` is a
// method/function *definition* (e.g. a fake `setTimeout(handler, delay)
// { … }`), not a call, and is not a finding.

export const FLAKY_KINDS = Object.freeze([
  'real-timer',
  'real-clock',
  'random',
  'network',
  'filesystem',
  'env-mutation',
  'shared-state',
  'global-mutation',
  'port',
]);

// Weights: how strongly one finding pulls a file up the ranking.
// Cross-test leakage and port collisions (3) outrank single-test
// timing luck (2); network (3) outranks disk (2) because it also
// depends on the outside world.
export const FLAKY_WEIGHTS = Object.freeze({
  'real-timer': 2,
  'real-clock': 2,
  random: 2,
  network: 3,
  filesystem: 2,
  'env-mutation': 3,
  'shared-state': 2,
  'global-mutation': 3,
  port: 3,
});

// Kinds that fail `--strict`. Only `port`: every other kind has
// legitimate guarded uses (save/restore, ephemeral ports, seeded
// fakes), so they stay report-only.
export const STRICT_KINDS = Object.freeze(['port']);

const FS_BARE_CALLS = [
  'readFile',
  'writeFile',
  'appendFile',
  'mkdir',
  'mkdtemp',
  'readdir',
  'stat',
  'lstat',
  'unlink',
  'rm',
  'rename',
  'copyFile',
  'access',
  'realpath',
  'symlink',
  'truncate',
  'open',
  'watch',
];

const FS_METHODS = [
  ...FS_BARE_CALLS,
  'readFileSync',
  'writeFileSync',
  'existsSync',
  'createReadStream',
  'createWriteStream',
];

// One regex per kind. A kind may need several patterns (e.g. the two
// spellings of a clock read); matches are deduplicated by end offset,
// so `crypto.randomUUID(` — matched by both the `crypto.` pattern and
// the bare-name pattern — counts once.
const KIND_PATTERNS = {
  'real-timer': [/\b(?:setTimeout|setInterval|setImmediate)\s*\(/g],
  'real-clock': [
    /\bDate\s*\.\s*(?:now|parse|UTC)\s*\(/g,
    /\bnew\s+Date\s*\(/g,
    /\bperformance\s*\.\s*now\s*\(/g,
  ],
  random: [
    /\bMath\s*\.\s*random\s*\(/g,
    /\bcrypto\s*\.\s*(?:randomUUID|randomBytes|getRandomValues|randomInt)\s*\(/g,
    /(?:^|[^.\w$])(?:randomUUID|randomBytes|randomInt)\s*\(/g,
  ],
  network: [
    /\bfetch\s*\(/g,
    /\bnew\s+WebSocket\s*\(/g,
    /\bnew\s+EventSource\s*\(/g,
    /\bXMLHttpRequest\b/g,
  ],
  filesystem: [
    new RegExp(`\\bfs\\s*\\.\\s*(?:${FS_METHODS.join('|')})\\s*\\(`, 'g'),
    new RegExp(
      `\\bfsPromises\\s*\\.\\s*(?:${FS_METHODS.join('|')})\\s*\\(`,
      'g',
    ),
  ],
  'env-mutation': [
    /\bprocess\s*\.\s*env\s*\.\s*[A-Za-z_$][\w$]*\s*=(?!=)/g,
    /\bdelete\s+process\s*\.\s*env\b/g,
    /\bprocess\s*\.\s*chdir\s*\(/g,
  ],
  'global-mutation': [
    /\b(?:globalThis|global)\s*\.\s*[A-Za-z_$][\w$]*\s*=(?!=)/g,
    /\bObject\s*\.\s*defineProperty\s*\(\s*(?:globalThis|global)\b/g,
  ],
  port: [/\.\s*listen\s*\(\s*(0|[1-9][0-9]*)\b/g],
};

function isWordChar(char) {
  return char === '_' || char === '$' || /[A-Za-z0-9]/.test(char);
}

function lineStartsOf(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineAt(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineStarts[mid] <= offset) low = mid + 1;
    else high = mid - 1;
  }
  return high + 1;
}

// Whether a `/` at `index` opens a regex literal, from the previous
// significant character. Heuristic, same family as every JS
// highlighter: after an operand or a closing bracket the slash divides;
// after an operator, keyword, or opener it starts a regex.
const REGEX_KEYWORDS = new Set([
  'return',
  'typeof',
  'case',
  'delete',
  'void',
  'in',
  'of',
  'instanceof',
  'new',
  'throw',
  'else',
  'do',
  'yield',
  'await',
]);

function regexAllowedBefore(chars, index) {
  let j = index - 1;
  while (j >= 0 && /\s/.test(chars[j])) j -= 1;
  if (j < 0) return true;
  const prev = chars[j];
  if (
    prev === ')' ||
    prev === ']' ||
    prev === "'" ||
    prev === '"' ||
    prev === '`'
  ) {
    return false;
  }
  if (prev === '+' || prev === '-') {
    // `i++ / 2` divides; `x + /re/` starts a regex. A doubled operator
    // means the slash is the binary operator.
    if (j > 0 && chars[j - 1] === prev) return false;
    return true;
  }
  if (isWordChar(prev)) {
    let start = j;
    while (start > 0 && isWordChar(chars[start - 1])) start -= 1;
    const word = chars.slice(start, j + 1).join('');
    if (REGEX_KEYWORDS.has(word)) return true;
    return false;
  }
  return true;
}

// Mask comments and the interiors of strings and regex literals to
// spaces (newlines kept, offsets preserved) so pattern matching only
// sees real code. Template-literal text is masked; `${…}`
// interpolations are scanned as code, including nested templates and
// strings inside them.
//
// `chars` uses `split('')` — UTF-16 code units, index-aligned with
// `source` — never `[...source]`, whose code-point iteration shifts
// every index after an astral character (emoji).
export function maskNonCode(source) {
  const chars = source.split('');
  const blank = (from, to) => {
    for (let i = from; i < to; i += 1) {
      if (chars[i] !== '\n') chars[i] = ' ';
    }
  };

  // Frames: { type: 'code' | 'template', braceDepth: number,
  // interpolation: boolean }. The bottom frame is the file's code.
  // A template frame's `${` pushes an interpolation code frame; its
  // closing `}` at depth 0 pops back to the template.
  const frames = [{ type: 'code', braceDepth: 0, interpolation: false }];
  let i = 0;
  while (i < chars.length) {
    const frame = frames[frames.length - 1];
    const ch = chars[i];
    const next = chars[i + 1];
    if (frame.type === 'template') {
      if (ch === '\\') {
        blank(i, Math.min(i + 2, chars.length));
        i += 2;
        continue;
      }
      if (ch === '`') {
        i += 1;
        frames.pop();
        continue;
      }
      if (ch === '$' && next === '{') {
        frames.push({ type: 'code', braceDepth: 0, interpolation: true });
        i += 2;
        continue;
      }
      blank(i, i + 1);
      i += 1;
      continue;
    }
    // Code frame.
    if (ch === '/' && next === '/') {
      let j = i + 2;
      while (j < chars.length && chars[j] !== '\n') j += 1;
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === '/' && next === '*') {
      let j = i + 2;
      while (
        j + 1 < chars.length &&
        !(chars[j] === '*' && chars[j + 1] === '/')
      )
        j += 1;
      const end = Math.min(j + 2, chars.length);
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < chars.length) {
        if (chars[j] === '\\') {
          j += 2;
          continue;
        }
        if (chars[j] === ch || chars[j] === '\n') break;
        j += 1;
      }
      const end = j < chars.length && chars[j] === ch ? j + 1 : j;
      blank(i + 1, end - 1);
      i = end;
      continue;
    }
    if (ch === '`') {
      frames.push({ type: 'template', braceDepth: 0, interpolation: false });
      i += 1;
      continue;
    }
    if (ch === '/' && next !== '=' && regexAllowedBefore(chars, i)) {
      // Regex literal: escapes and `[...]` classes (where `]` as the
      // first class char, and `\/`, do not terminate it) handled.
      let j = i + 1;
      let inClass = false;
      let classFirst = false;
      while (j < chars.length) {
        const c = chars[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '\n') break;
        if (inClass) {
          if (c === ']' && !classFirst) inClass = false;
          classFirst = false;
          j += 1;
          continue;
        }
        if (c === '[') {
          inClass = true;
          classFirst = true;
          j += 1;
          continue;
        }
        if (c === '/') break;
        j += 1;
      }
      let end = j < chars.length && chars[j] === '/' ? j + 1 : j;
      while (end < chars.length && /[a-z]/.test(chars[end])) end += 1;
      blank(i + 1, end);
      i = end;
      continue;
    }
    if (ch === '{') {
      frame.braceDepth += 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      if (frame.interpolation && frame.braceDepth === 0) {
        frames.pop();
        i += 1;
        continue;
      }
      frame.braceDepth = Math.max(0, frame.braceDepth - 1);
      i += 1;
      continue;
    }
    i += 1;
  }
  return chars.join('');
}

// Top-level `let` / `var` declarations: mutable module state shared by
// every test in the file. Brace-depth scan over masked code; `let`
// inside `for (…)` is loop-scoped, not shared, and is skipped, as are
// property names (`obj.let`) and declarations nested in any block.
function findSharedState(masked) {
  const findings = [];
  let depth = 0;
  let i = 0;
  while (i < masked.length) {
    const ch = masked[i];
    if (ch === '{') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }
    if (
      (masked.startsWith('let', i) || masked.startsWith('var', i)) &&
      depth === 0
    ) {
      const keyword = masked.startsWith('let', i) ? 'let' : 'var';
      const before = i > 0 ? masked[i - 1] : '';
      const after = masked[i + keyword.length] ?? '';
      const isStandalone =
        !isWordChar(before) && before !== '.' && !isWordChar(after);
      if (isStandalone) {
        let j = i + keyword.length;
        while (j < masked.length && /\s/.test(masked[j])) j += 1;
        const nextChar = masked[j] ?? '';
        const isDeclaration =
          isWordChar(nextChar) || nextChar === '[' || nextChar === '{';
        const beforeTrimmed = masked.slice(0, i).trimEnd();
        const inForLoop = /for\s*\($/.test(beforeTrimmed);
        if (isDeclaration && !inForLoop) {
          findings.push({ offset: i, end: j });
          i = j;
          continue;
        }
      }
    }
    i += 1;
  }
  return findings;
}

// Whether a call match is really a method/function *definition*, not a
// call: `setTimeout(handler, delay) { … }` defines a fake timer, it
// does not wait on a real one. A definition is a call-shaped match
// whose closing paren is followed by `{`. A genuine call is followed
// by `;`, `)`, `,`, an operator, or similar — never a bare block.
// (A call followed by a standalone block on the next line is valid
// JS via ASI, but does not occur in this repo's tests; the fake-timer
// definitions do, so the exclusion trades a theoretical miss for
// several real false positives.)
function isDefinitionCall(masked, match) {
  if (masked[match.end - 1] !== '(') return false;
  let depth = 1;
  let j = match.end;
  while (j < masked.length && depth > 0) {
    if (masked[j] === '(') depth += 1;
    else if (masked[j] === ')') depth -= 1;
    j += 1;
  }
  if (depth !== 0) return false;
  while (j < masked.length && /\s/.test(masked[j])) j += 1;
  return masked[j] === '{';
}

function collectMatches(masked, patterns) {
  const seenEnds = new Set();
  const matches = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(masked)) !== null) {
      const end = match.index + match[0].length;
      if (match[0] === '') {
        pattern.lastIndex += 1;
        continue;
      }
      if (!seenEnds.has(end)) {
        seenEnds.add(end);
        matches.push({ offset: match.index, end });
      }
    }
  }
  return matches.sort((a, b) => a.offset - b.offset);
}

/** All flaky-risk findings in one test file's source. */
export function findFlakyRisks(source, file = '<unknown>') {
  const masked = maskNonCode(source);
  const lines = source.split('\n');
  const lineStarts = lineStartsOf(source);
  const findings = [];
  const push = (kind, offset) => {
    const line = lineAt(lineStarts, offset);
    const text = (lines[line - 1] ?? '').trim().slice(0, 140);
    findings.push({ file, kind, line, text });
  };

  for (const kind of FLAKY_KINDS) {
    if (kind === 'shared-state') {
      for (const match of findSharedState(masked)) push(kind, match.offset);
      continue;
    }
    if (kind === 'filesystem') {
      const patterns = [...KIND_PATTERNS.filesystem];
      if (/['"]node:fs/.test(source)) {
        patterns.push(
          new RegExp(
            `(?:^|[^.\\w$])(?:${FS_BARE_CALLS.join('|')})\\s*\\(`,
            'g',
          ),
        );
      }
      for (const match of collectMatches(masked, patterns)) {
        if (!isDefinitionCall(masked, match)) push(kind, match.offset);
      }
      continue;
    }
    if (kind === 'port') {
      for (const match of collectMatches(masked, KIND_PATTERNS.port)) {
        const snippet = masked.slice(match.offset, match.end);
        const port = /([0-9]+)\s*$/.exec(snippet)?.[1];
        if (port !== undefined && port !== '0') push(kind, match.offset);
      }
      continue;
    }
    for (const match of collectMatches(masked, KIND_PATTERNS[kind])) {
      if (!isDefinitionCall(masked, match)) push(kind, match.offset);
    }
  }
  findings.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
  return findings;
}

export function scoreFindings(findings) {
  const counts = {};
  for (const kind of FLAKY_KINDS) counts[kind] = 0;
  for (const finding of findings) counts[finding.kind] += 1;
  let score = 0;
  for (const kind of FLAKY_KINDS) score += counts[kind] * FLAKY_WEIGHTS[kind];
  return { counts, score };
}

/** Analyse one test file: findings + per-kind counts + score. */
export function analyzeTestFile(file, source) {
  const findings = findFlakyRisks(source, file);
  const { counts, score } = scoreFindings(findings);
  return { file, findings, counts, score };
}

export function summarizeResults(results) {
  const totals = {};
  for (const kind of FLAKY_KINDS) totals[kind] = 0;
  let totalFindings = 0;
  let totalScore = 0;
  let filesWithFindings = 0;
  for (const result of results) {
    if (result.findings.length) filesWithFindings += 1;
    totalFindings += result.findings.length;
    totalScore += result.score;
    for (const kind of FLAKY_KINDS) totals[kind] += result.counts[kind];
  }
  return {
    files: results.length,
    filesWithFindings,
    totalFindings,
    totalScore,
    totals,
  };
}

/** Rank files by score desc, then findings desc, then path asc. */
export function rankFlakyFiles(results, limit = 10) {
  const ranked = [...results]
    .filter((result) => result.findings.length > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.findings.length - a.findings.length ||
        a.file.localeCompare(b.file),
    );
  if (limit === 0) return ranked;
  return ranked.slice(0, limit);
}

export function formatFlakyRiskReport(results, limit = 10) {
  const summary = summarizeResults(results);
  const ranked = rankFlakyFiles(results, limit);
  const out = [];
  out.push('Flaky-risk scoreboard (static, report-only)');
  out.push(
    `Files scanned: ${summary.files}, files with findings: ${summary.filesWithFindings}, ` +
      `total findings: ${summary.totalFindings}, total score: ${summary.totalScore}`,
  );
  out.push('');
  out.push(
    `Top ${ranked.length} file${ranked.length === 1 ? '' : 's'} by flaky-risk score:`,
  );
  for (const result of ranked) {
    const kinds = FLAKY_KINDS.filter((kind) => result.counts[kind] > 0)
      .map((kind) => `${kind}=${result.counts[kind]}`)
      .join(' ');
    out.push(`  ${result.score}  ${result.file}  (${kinds})`);
  }
  out.push('');
  out.push('Per-kind totals:');
  for (const kind of FLAKY_KINDS) {
    out.push(`  ${kind}: ${summary.totals[kind]}`);
  }
  if (ranked.length) {
    out.push('');
    out.push('Findings (top files):');
    for (const result of ranked) {
      out.push(`  ${result.file} (score ${result.score})`);
      for (const finding of result.findings) {
        out.push(`    L${finding.line} ${finding.kind}: ${finding.text}`);
      }
    }
  }
  return `${out.join('\n')}\n`;
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
