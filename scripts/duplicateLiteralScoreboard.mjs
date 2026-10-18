// Duplicate-string-literal scoreboard: report-only static audit of
// repeated long string literals across production code (`src/` and
// `server/`).
//
// A repeated literal is a candidate for a shared constant: one
// definition, one place to fix a typo or change a value. This tool
// only REPORTS candidates — it never rewrites code, and duplication
// here is advisory, not a failure (so there is no `--strict` mode:
// exit 0 even when groups exist; exit 2 only on usage / I/O errors).
//
// What counts as a literal:
// - Single-quoted, double-quoted, and plain template literals
//   (template literals WITH `${...}` interpolation are skipped as a
//   whole — they are not one literal — but string literals nested
//   inside the interpolation ARE scanned).
// - Only literals whose decoded value is at least `minLength`
//   characters, occurring at least `minOccurrences` times across at
//   least `minFiles` distinct files, form a group. Defaults:
//   minLength 12, minOccurrences 3, minFiles 2. Short strings
//   (`'id'`, `'utf-8'`) and same-file repeats are noise for a
//   shared-constant hunt, so they are excluded by design.
//
// What is NOT counted (limits — read before acting on a report):
// - Import / export specifiers (`import x from '...'`,
//   `export ... from '...'`, `require('...')`, `import('...')`,
//   side-effect `import '...'`): module paths repeat by necessity
//   and are not dedupe candidates.
// - Comments, regex literals, JSX text, and strings inside `.json`,
//   `.css`, or other non-JS files: only `.js` / `.mjs` / `.cjs` /
//   `.ts` / `.mts` / `.cts` / `.jsx` / `.tsx` files are scanned.
// - Test files (`*.test.*`, `*.spec.*`): test fixtures repeat
//   expected strings on purpose; scanning them would drown the
//   production signal. `src/` test files are excluded even though
//   they live under a scanned root.
// - Grouping is by exact decoded value: `'a\nb'` and a template
//   literal with a real newline inside decode to the same value and
//   group together; `'Foo'` and `'foo'` do NOT group (case
//   sensitive). Similarity / near-duplicate detection is out of
//   scope — a human judges whether a group deserves a constant.

import path from 'node:path';
import { readdir } from 'node:fs/promises';

export const DEFAULT_LIMIT = 10;
export const DEFAULT_MIN_LENGTH = 12;
export const DEFAULT_MIN_OCCURRENCES = 3;
export const DEFAULT_MIN_FILES = 2;
export const SCAN_ROOTS = ['src', 'server'];
export const MAX_VALUE_DISPLAY = 120;
export const MAX_SAMPLE_LINES = 3;

const SCAN_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.jsx',
  '.tsx',
]);
const SKIP_DIRS = new Set(['node_modules', '.git']);
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
  'yield',
  'await',
  'else',
  'do',
]);
const REGEX_PUNCTUATORS = new Set([
  '(',
  '{',
  '[',
  ',',
  ';',
  ':',
  '!',
  '&',
  '|',
  '?',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '=',
  '^',
  '~',
]);

function isWordChar(char) {
  return char === '_' || char === '$' || /[A-Za-z0-9]/.test(char);
}

function isIdentifierStart(char) {
  return char === '_' || char === '$' || /[A-Za-z]/.test(char);
}

function isDigit(char) {
  return char >= '0' && char <= '9';
}

function isHexDigit(char) {
  return (
    isDigit(char) ||
    (char >= 'a' && char <= 'f') ||
    (char >= 'A' && char <= 'F')
  );
}

// Decode one escape starting at `source[i] === '\\'`. Returns
// `{ value, nextIndex }` where `nextIndex` is the index just past
// the escape. A backslash-newline (line continuation) decodes to
// nothing; an unknown escape decodes to the escaped char itself,
// matching JavaScript semantics.
function decodeEscape(source, i) {
  const next = source[i + 1];
  if (next === undefined) return { value: '\\', nextIndex: i + 1 };
  if (next === '\n') return { value: '', nextIndex: i + 2 };
  if (next === '\r') {
    // `\` + CRLF is also a line continuation.
    return source[i + 2] === '\n'
      ? { value: '', nextIndex: i + 3 }
      : { value: '', nextIndex: i + 2 };
  }
  const simple = {
    n: '\n',
    r: '\r',
    t: '\t',
    b: '\b',
    f: '\f',
    v: '\v',
    0: '\0',
  };
  if (next === '0' && !isDigit(source[i + 2] ?? '')) {
    return { value: '\0', nextIndex: i + 2 };
  }
  if (Object.hasOwn(simple, next)) {
    return { value: simple[next], nextIndex: i + 2 };
  }
  if (next === 'x') {
    const hex = source.slice(i + 2, i + 4);
    if (hex.length === 2 && [...hex].every(isHexDigit)) {
      return {
        value: String.fromCharCode(Number.parseInt(hex, 16)),
        nextIndex: i + 4,
      };
    }
    return { value: 'x', nextIndex: i + 2 };
  }
  if (next === 'u') {
    if (source[i + 2] === '{') {
      const close = source.indexOf('}', i + 3);
      const hex = close === -1 ? '' : source.slice(i + 3, close);
      if (close !== -1 && hex.length > 0 && [...hex].every(isHexDigit)) {
        const code = Number.parseInt(hex, 16);
        if (code <= 0x10ffff) {
          return { value: String.fromCodePoint(code), nextIndex: close + 1 };
        }
      }
      return { value: 'u', nextIndex: i + 2 };
    }
    const hex = source.slice(i + 2, i + 6);
    if (hex.length === 4 && [...hex].every(isHexDigit)) {
      return {
        value: String.fromCharCode(Number.parseInt(hex, 16)),
        nextIndex: i + 6,
      };
    }
    return { value: 'u', nextIndex: i + 2 };
  }
  return { value: next, nextIndex: i + 2 };
}

// Extract string literals from one JS-family source file.
// Returns [{ value, line }] in source order. `line` is the 1-based
// line where the literal OPENS. Comments, regex literals, and
// import specifiers are skipped (see header). Template literals
// with interpolation contribute no literal of their own, but their
// `${...}` code is scanned recursively via the frame stack.
export function extractStringLiterals(source) {
  const literals = [];
  // Frame stack: { type: 'code' | 'template' }. A template frame
  // remembers whether its literal has seen interpolation; when the
  // closing backtick arrives, a clean template yields one literal.
  const stack = [{ type: 'code', value: '', line: 0, interpolated: false }];
  let i = 0;
  let line = 1;
  // Last significant token in the current code context, for the
  // regex-vs-division decision and the import-specifier check:
  // { kind: 'ident' | 'punct', text } or null. Strings, comments,
  // and regex literals never enter the history.
  let prev = null;
  let prevPrev = null;
  const top = () => stack[stack.length - 1];

  const pushToken = (token) => {
    prevPrev = prev;
    prev = token;
  };
  const isImportSpecifier = () => {
    // `from '...'` / `import '...'` (incl. `export ... from '...'`).
    if (
      prev?.kind === 'ident' &&
      (prev.text === 'from' || prev.text === 'import')
    ) {
      return true;
    }
    // `require('...')` / `import('...')`.
    if (
      prev?.kind === 'punct' &&
      prev.text === '(' &&
      prevPrev?.kind === 'ident' &&
      (prevPrev.text === 'require' || prevPrev.text === 'import')
    ) {
      return true;
    }
    return false;
  };

  while (i < source.length) {
    const char = source[i];
    const frame = top();

    if (frame.type === 'template') {
      if (char === '`') {
        const finished = stack.pop();
        if (!finished.interpolated && finished.value.length > 0) {
          literals.push({ value: finished.value, line: finished.line });
        }
        // A template literal behaves like a string for what follows.
        pushToken({ kind: 'punct', text: 'string' });
        i += 1;
        continue;
      }
      if (char === '\\') {
        const { value, nextIndex } = decodeEscape(source, i);
        frame.value += value;
        // A line-continuation escape consumed a newline: keep the
        // line count honest for later literals.
        const consumed = source.slice(i, nextIndex);
        if (consumed.includes('\n')) line += 1;
        i = nextIndex;
        continue;
      }
      if (char === '$' && source[i + 1] === '{') {
        frame.interpolated = true;
        stack.push({ type: 'code', braceDepth: 0 });
        pushToken({ kind: 'punct', text: '${' });
        i += 2;
        continue;
      }
      if (char === '\n') line += 1;
      frame.value += char;
      i += 1;
      continue;
    }

    // Code frame.
    if (char === '\n') {
      line += 1;
      i += 1;
      continue;
    }
    if (
      char === ' ' ||
      char === '\t' ||
      char === '\r' ||
      char === '\v' ||
      char === '\f'
    ) {
      // Whitespace is not a token: it must not overwrite the
      // significant-token history (else `from '...'` and
      // `return /re/` would both misread after the space).
      i += 1;
      continue;
    }
    if (char === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const text = end === -1 ? source.slice(i) : source.slice(i, end + 2);
      line += (text.match(/\n/g) ?? []).length;
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char;
      const startLine = line;
      const skip = isImportSpecifier();
      let value = '';
      i += 1;
      let closed = false;
      while (i < source.length) {
        const c = source[i];
        if (c === quote) {
          closed = true;
          i += 1;
          break;
        }
        if (c === '\n') {
          // Unterminated string: abandon it; the newline belongs
          // to the code stream.
          line += 1;
          i += 1;
          break;
        }
        if (c === '\\') {
          const { value: decoded, nextIndex } = decodeEscape(source, i);
          if (!skip) value += decoded;
          const consumed = source.slice(i, nextIndex);
          if (consumed.includes('\n')) line += 1;
          i = nextIndex;
          continue;
        }
        if (!skip) value += c;
        i += 1;
      }
      if (closed && !skip && value.length > 0) {
        literals.push({ value, line: startLine });
      }
      pushToken({ kind: 'punct', text: 'string' });
      continue;
    }
    if (char === '`') {
      stack.push({ type: 'template', value: '', line, interpolated: false });
      i += 1;
      continue;
    }
    if (char === '/' && prev !== null) {
      // Possible regex literal: allowed after a keyword that takes
      // an expression, after an operator punctuator, or at the
      // start of a template-interpolation code frame.
      const regexAllowed =
        (prev.kind === 'ident' && REGEX_KEYWORDS.has(prev.text)) ||
        (prev.kind === 'punct' && REGEX_PUNCTUATORS.has(prev.text)) ||
        (prev.kind === 'punct' && prev.text === '${');
      if (regexAllowed) {
        i += 1;
        let inClass = false;
        while (i < source.length) {
          const c = source[i];
          if (c === '\n') break;
          if (c === '\\') {
            i += 2;
            continue;
          }
          if (c === '[') inClass = true;
          if (c === ']') inClass = false;
          if (c === '/' && !inClass) {
            i += 1;
            break;
          }
          i += 1;
        }
        while (i < source.length && /[a-z]/.test(source[i])) i += 1;
        pushToken({ kind: 'punct', text: 'regex' });
        continue;
      }
      // Division: fall through to the punctuator handling below.
    }
    if (char === '/' && prev === null) {
      // A `/` at the very start of a file / interpolation can only
      // start a regex (there is no left operand for division).
      i += 1;
      let inClass = false;
      while (i < source.length) {
        const c = source[i];
        if (c === '\n') break;
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '[') inClass = true;
        if (c === ']') inClass = false;
        if (c === '/' && !inClass) {
          i += 1;
          break;
        }
        i += 1;
      }
      while (i < source.length && /[a-z]/.test(source[i])) i += 1;
      pushToken({ kind: 'punct', text: 'regex' });
      continue;
    }
    if (isIdentifierStart(char)) {
      let j = i + 1;
      while (j < source.length && isWordChar(source[j])) j += 1;
      const text = source.slice(i, j);
      pushToken({ kind: 'ident', text });
      i = j;
      continue;
    }
    if (char === '}' && stack.length > 1 && (frame.braceDepth ?? 0) > 0) {
      // A `}` closing an object literal / block nested inside the
      // interpolation: stay in the interpolation.
      frame.braceDepth -= 1;
      pushToken({ kind: 'punct', text: '}' });
      i += 1;
      continue;
    }
    if (char === '}' && stack.length > 1) {
      // End of a `${...}` interpolation: return to the template.
      // The `}` itself is a punctuator for the code that follows
      // the template, so it is NOT pushed as a token here — the
      // closing backtick pushes the template's 'string' token.
      stack.pop();
      i += 1;
      continue;
    }
    if (char === '{' && stack.length > 1) {
      // An object literal (or block) inside interpolation: track
      // nesting so its `}` does not close the interpolation early.
      frame.braceDepth = (frame.braceDepth ?? 0) + 1;
      pushToken({ kind: 'punct', text: '{' });
      i += 1;
      continue;
    }
    // Any other single char is a punctuator (operators, brackets,
    // commas, semicolons). Note: a `}` closing a code block is
    // deliberately NOT in REGEX_PUNCTUATORS, so a `/` after it is
    // treated as division — same rule as the todo-debt scanner.
    pushToken({ kind: 'punct', text: char });
    i += 1;
  }
  return literals;
}

function isTestFile(file) {
  return /\.test\.[^.]+$/.test(file) || /\.spec\.[^.]+$/.test(file);
}

// Recursively list scannable, non-test files under SCAN_ROOTS,
// returned as root-relative paths in deterministic (sorted) order.
export async function discoverSourceFiles(root) {
  const found = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const relative = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(relative);
      } else if (entry.isFile()) {
        if (!SCAN_EXTENSIONS.has(path.extname(entry.name))) continue;
        if (isTestFile(relative)) continue;
        found.push(relative);
      }
    }
  };
  for (const scanRoot of SCAN_ROOTS) {
    await walk(scanRoot);
  }
  return found.sort();
}

// Analyze already-listed files. `readFile` is injected for tests.
// Returns [{ file, literals }] with literals in source order.
export async function analyzeFiles(
  files,
  {
    readFile,
    minLength = DEFAULT_MIN_LENGTH,
    minOccurrences = DEFAULT_MIN_OCCURRENCES,
    minFiles = DEFAULT_MIN_FILES,
  } = {},
) {
  const results = [];
  for (const file of files) {
    const source = await readFile(file);
    const literals = extractStringLiterals(source);
    results.push({ file, literals });
  }
  return { results, thresholds: { minLength, minOccurrences, minFiles } };
}

// Group per-file literals into duplicate groups honouring the
// thresholds. Groups sort by occurrences desc, then value asc, so
// output is deterministic across runs and machines.
export function groupLiterals(
  results,
  {
    minLength = DEFAULT_MIN_LENGTH,
    minOccurrences = DEFAULT_MIN_OCCURRENCES,
    minFiles = DEFAULT_MIN_FILES,
  } = {},
) {
  const byValue = new Map();
  let literalsFound = 0;
  for (const { file, literals } of results) {
    literalsFound += literals.length;
    for (const literal of literals) {
      if (literal.value.length < minLength) continue;
      if (literal.value.trim().length === 0) continue;
      let group = byValue.get(literal.value);
      if (!group) {
        group = { value: literal.value, occurrences: 0, files: new Map() };
        byValue.set(literal.value, group);
      }
      group.occurrences += 1;
      let perFile = group.files.get(file);
      if (!perFile) {
        perFile = { count: 0, lines: [] };
        group.files.set(file, perFile);
      }
      perFile.count += 1;
      if (perFile.lines.length < MAX_SAMPLE_LINES) {
        perFile.lines.push(literal.line);
      }
    }
  }
  const groups = [];
  for (const group of byValue.values()) {
    if (group.occurrences < minOccurrences) continue;
    if (group.files.size < minFiles) continue;
    groups.push({
      value: group.value,
      occurrences: group.occurrences,
      files: [...group.files.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([file, { count, lines }]) => ({ file, count, lines })),
    });
  }
  groups.sort((a, b) => {
    if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  });
  return { groups, literalsFound, distinctValues: byValue.size };
}

export function summarizeResults(
  results,
  { groups, literalsFound, distinctValues },
) {
  const totalDuplicateOccurrences = groups.reduce(
    (sum, group) => sum + group.occurrences,
    0,
  );
  return {
    filesScanned: results.length,
    literalsFound,
    distinctValues,
    duplicateGroups: groups.length,
    totalDuplicateOccurrences,
  };
}

export function filterByFiles(results, files) {
  if (files.length === 0) return results;
  const wanted = new Set(files);
  return results.filter(({ file }) => wanted.has(file));
}

export function limitFindings(findings, limit) {
  if (limit === 0) return findings;
  return findings.slice(0, limit);
}

function displayValue(value) {
  const shown =
    value.length > MAX_VALUE_DISPLAY
      ? `${value.slice(0, MAX_VALUE_DISPLAY)}…`
      : value;
  return JSON.stringify(shown);
}

export function formatDuplicateLiteralReport(
  { summary, groups, ranked },
  limit,
) {
  const lines = [];
  lines.push('Duplicate-string-literal scoreboard (report-only, advisory)');
  lines.push(
    `Scanned ${summary.filesScanned} file(s) in src/ + server/ (tests excluded). ` +
      `${summary.literalsFound} literal(s), ${summary.distinctValues} distinct ` +
      `value(s) at min-length, ${summary.duplicateGroups} duplicate group(s) ` +
      `covering ${summary.totalDuplicateOccurrences} occurrence(s).`,
  );
  lines.push(
    'A group is a literal repeated across >= 2 files; counts below ' +
      'use the CLI thresholds. Repeated literals are shared-constant ' +
      'candidates — a human judges whether each group deserves one.',
  );
  if (ranked.length === 0) {
    lines.push('No duplicate groups at these thresholds.');
    return lines.join('\n');
  }
  lines.push(`Top ${ranked.length} duplicate group(s) (limit ${limit}):`);
  for (const group of ranked) {
    lines.push(
      `- ${displayValue(group.value)} — ${group.occurrences} occurrence(s) ` +
        `in ${group.files.length} file(s)`,
    );
    for (const { file, count, lines: sampleLines } of group.files) {
      lines.push(`    ${file} (${count}x, lines ${sampleLines.join(', ')})`);
    }
  }
  return lines.join('\n');
}

// Parse CLI args. Returns { json, limit, minLength, minOccurrences,
// minFiles, files, help } or { error } on bad input.
export function parseCliArgs(argv) {
  const parsed = {
    json: false,
    limit: DEFAULT_LIMIT,
    minLength: DEFAULT_MIN_LENGTH,
    minOccurrences: DEFAULT_MIN_OCCURRENCES,
    minFiles: DEFAULT_MIN_FILES,
    files: [],
    help: false,
  };
  const parseNonNegativeInt = (flag, value) => {
    if (value === undefined || !/^\d+$/.test(value)) {
      return { error: `${flag} requires a non-negative integer` };
    }
    return { value: Number.parseInt(value, 10) };
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--limit' || arg.startsWith('--limit=')) {
      const raw = arg.includes('=') ? arg.slice('--limit='.length) : argv[++i];
      const { value, error } = parseNonNegativeInt('--limit', raw);
      if (error) return { error };
      parsed.limit = value;
      continue;
    }
    if (arg === '--min-length' || arg.startsWith('--min-length=')) {
      const raw = arg.includes('=')
        ? arg.slice('--min-length='.length)
        : argv[++i];
      const { value, error } = parseNonNegativeInt('--min-length', raw);
      if (error) return { error };
      if (value < 1) return { error: '--min-length must be at least 1' };
      parsed.minLength = value;
      continue;
    }
    if (arg === '--min-occurrences' || arg.startsWith('--min-occurrences=')) {
      const raw = arg.includes('=')
        ? arg.slice('--min-occurrences='.length)
        : argv[++i];
      const { value, error } = parseNonNegativeInt('--min-occurrences', raw);
      if (error) return { error };
      if (value < 1) return { error: '--min-occurrences must be at least 1' };
      parsed.minOccurrences = value;
      continue;
    }
    if (arg === '--min-files' || arg.startsWith('--min-files=')) {
      const raw = arg.includes('=')
        ? arg.slice('--min-files='.length)
        : argv[++i];
      const { value, error } = parseNonNegativeInt('--min-files', raw);
      if (error) return { error };
      if (value < 1) return { error: '--min-files must be at least 1' };
      parsed.minFiles = value;
      continue;
    }
    if (arg.startsWith('-')) {
      return { error: `unknown flag: ${arg}` };
    }
    parsed.files.push(arg);
  }
  return parsed;
}
