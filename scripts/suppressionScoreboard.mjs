// Suppression scoreboard: report-only static audit of lint / coverage /
// formatter opt-outs across `src/`, `server/`, and `scripts/`.
//
// A suppression is a directive comment that tells a checker to look
// away: `eslint-disable`, `@ts-ignore`, `istanbul ignore`, `c8 ignore`,
// `prettier-ignore`. Each one is sometimes justified — but each one is
// also a hole in the check it silences, so the repo should know where
// the holes are and how big they are.
//
// Only REAL comments count. A marker inside a string, template literal,
// or regex literal is not a directive and is not counted. A marker
// only counts when it starts a comment line (after whitespace, and
// after a leading `*` on block-comment lines), matching how ESLint /
// Istanbul / c8 / Prettier themselves recognise directives: a marker
// buried mid-sentence (`// see eslint-disable for details`) is prose,
// not a suppression.
//
// Kinds reported:
// - `eslint-disable` / `eslint-disable-line` /
//   `eslint-disable-next-line` — with the rule list when given;
//   no rules means a BLANKET disable (every rule silenced).
// - `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`.
// - `istanbul ignore` — scope `file` / `next` / `else` / `if` /
//   `statement` (no scope word).
// - `c8 ignore` — scope `next` / `line` / `start` / `stop` /
//   `statement` (no scope word).
// - `prettier-ignore`.
//
// Report-only: no file writes, no behaviour change. Exit 0 even when
// suppressions exist; `--strict` exits 1 when any BLANKET
// ESLint disable or any `istanbul ignore file` is found (the two
// findings that silence a whole check for a whole line / file).

import path from 'node:path';
import { readdir } from 'node:fs/promises';

export const DEFAULT_LIMIT = 10;
export const SCAN_ROOTS = ['src', 'server', 'scripts'];
export const MAX_SNIPPET_LENGTH = 160;

const ESLINT_KEYWORDS = [
  'eslint-disable-next-line',
  'eslint-disable-line',
  'eslint-disable',
];
const TS_KEYWORDS = ['@ts-expect-error', '@ts-ignore', '@ts-nocheck'];
const ISTANBUL_SCOPES = new Set(['file', 'next', 'else', 'if']);
const C8_SCOPES = new Set(['next', 'line', 'start', 'stop']);
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

function isWordChar(char) {
  return char === '_' || char === '$' || /[A-Za-z0-9]/.test(char);
}

function lineNumberAt(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

// Collect comment spans: { start, end, bodyStart, bodyEnd, block }.
// `start`/`end` cover the delimiters; the body is the text between
// them. Strings, template literals (including `${…}` interpolation),
// and regex literals are skipped so a `//` inside one never starts a
// comment. A leading `#!` hashbang line is skipped. Regex-vs-division
// is a heuristic on the previous significant token: `/` after an
// identifier / number / `)` / `]` / `.` is division, otherwise a
// regex literal.
export function extractComments(source) {
  const comments = [];
  const chars = source.split('');
  let i = 0;
  if (source.startsWith('#!')) {
    const newline = source.indexOf('\n');
    i = newline === -1 ? chars.length : newline + 1;
  }
  // Frames: { type: 'code' | 'template', braceDepth, interpolation }.
  // The bottom frame is the file's code. A template frame's `${`
  // pushes an interpolation code frame; its closing `}` at depth 0
  // pops back to the template.
  const frames = [{ type: 'code', braceDepth: 0, interpolation: false }];
  let lastSignificant = '';
  const skipString = (quote) => {
    i += 1;
    while (i < chars.length) {
      if (chars[i] === '\\') {
        i += 2;
        continue;
      }
      if (chars[i] === quote || chars[i] === '\n') {
        if (chars[i] === quote) i += 1;
        break;
      }
      i += 1;
    }
  };
  const skipRegex = () => {
    // `i` is at the opening `/`.
    i += 1;
    let inClass = false;
    while (i < chars.length) {
      const ch = chars[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '\n') break;
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) {
        i += 1;
        while (i < chars.length && /[a-z]/i.test(chars[i])) i += 1;
        break;
      }
      i += 1;
    }
  };
  const prevWordIsRegexKeyword = () => {
    let end = i - 1;
    while (end >= 0 && /\s/.test(chars[end])) end -= 1;
    if (end < 0) return true;
    let start = end;
    while (start >= 0 && isWordChar(chars[start])) start -= 1;
    const word = chars.slice(start + 1, end + 1).join('');
    return word.length > 0 && REGEX_KEYWORDS.has(word);
  };
  const slashStartsRegex = () => {
    if (lastSignificant === '') return true;
    if (isWordChar(lastSignificant)) {
      return prevWordIsRegexKeyword();
    }
    if (lastSignificant === ')' || lastSignificant === ']') return false;
    if (lastSignificant === '.') return false;
    return true;
  };
  while (i < chars.length) {
    const frame = frames[frames.length - 1];
    const ch = chars[i];
    const next = chars[i + 1];
    if (frame.type === 'template') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        frames.pop();
        lastSignificant = '`';
        i += 1;
        continue;
      }
      if (ch === '$' && next === '{') {
        frames.push({ type: 'code', braceDepth: 0, interpolation: true });
        lastSignificant = '{';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    // Code frame (file code or template interpolation).
    if (ch === '/' && next === '/') {
      const start = i;
      let end = i + 2;
      while (end < chars.length && chars[end] !== '\n') end += 1;
      comments.push({
        start,
        end,
        bodyStart: start + 2,
        bodyEnd: end,
        block: false,
      });
      i = end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const start = i;
      const close = source.indexOf('*/', i + 2);
      const end = close === -1 ? chars.length : close + 2;
      comments.push({
        start,
        end,
        bodyStart: start + 2,
        bodyEnd: close === -1 ? end : close,
        block: true,
      });
      i = end;
      continue;
    }
    if (ch === "'" || ch === '"') {
      skipString(ch);
      lastSignificant = ch;
      continue;
    }
    if (ch === '`') {
      frames.push({ type: 'template', braceDepth: 0, interpolation: false });
      i += 1;
      continue;
    }
    if (ch === '/') {
      if (slashStartsRegex()) {
        skipRegex();
      } else {
        i += next === '=' ? 2 : 1;
      }
      lastSignificant = '/';
      continue;
    }
    if (ch === '{') {
      frame.braceDepth += 1;
      lastSignificant = '{';
      i += 1;
      continue;
    }
    if (ch === '}') {
      if (frame.braceDepth > 0) {
        frame.braceDepth -= 1;
      } else if (frame.interpolation && frames.length > 1) {
        frames.pop();
      }
      lastSignificant = '}';
      i += 1;
      continue;
    }
    if (!/\s/.test(ch)) lastSignificant = ch;
    i += 1;
  }
  return comments;
}

function parseEslintRules(rest) {
  // `rest` is the text after the eslint keyword, trimmed.
  // `-- reason` separates an optional human reason; anything before
  // it is the rule list (comma / whitespace separated).
  let rulesPart = rest;
  let reason = '';
  const separator = rest.indexOf('--');
  if (separator !== -1) {
    rulesPart = rest.slice(0, separator);
    reason = rest.slice(separator + 2).trim();
  }
  const rules = rulesPart
    .split(/[\s,]+/)
    .map((rule) => rule.trim())
    .filter((rule) => rule.length > 0);
  return { rules, reason };
}

function parseScopeWord(rest, scopes) {
  const first = rest.split(/\s+/)[0] ?? '';
  return scopes.has(first) ? first : 'statement';
}

// Match one directive at the start of a stripped comment line.
// Returns a finding detail, or null when the line is not a directive.
function matchDirectiveLine(stripped) {
  for (const keyword of ESLINT_KEYWORDS) {
    if (!stripped.startsWith(keyword)) continue;
    const after = stripped.slice(keyword.length);
    if (
      after.length > 0 &&
      !/[\s,]/.test(after[0]) &&
      !after.startsWith('--')
    ) {
      continue;
    }
    const kind =
      keyword === 'eslint-disable'
        ? 'eslint-disable'
        : keyword === 'eslint-disable-line'
          ? 'eslint-disable-line'
          : 'eslint-disable-next-line';
    const { rules, reason } = parseEslintRules(after.trim());
    return { kind, rules, blanket: rules.length === 0, reason };
  }
  for (const keyword of TS_KEYWORDS) {
    if (!stripped.startsWith(keyword)) continue;
    const after = stripped.slice(keyword.length);
    if (after.length > 0 && !/[\s,]/.test(after[0])) continue;
    const kind =
      keyword === '@ts-expect-error'
        ? 'ts-expect-error'
        : keyword === '@ts-ignore'
          ? 'ts-ignore'
          : 'ts-nocheck';
    return { kind };
  }
  if (stripped.startsWith('istanbul')) {
    const after = stripped.slice('istanbul'.length);
    if (/^\s+ignore(\s|$)/.test(after)) {
      const rest = after.replace(/^\s+ignore\s*/, '');
      return {
        kind: 'istanbul-ignore',
        scope: parseScopeWord(rest, ISTANBUL_SCOPES),
      };
    }
    return null;
  }
  if (stripped.startsWith('c8')) {
    const after = stripped.slice('c8'.length);
    if (/^\s+ignore(\s|$)/.test(after)) {
      const rest = after.replace(/^\s+ignore\s*/, '');
      return { kind: 'c8-ignore', scope: parseScopeWord(rest, C8_SCOPES) };
    }
    return null;
  }
  if (stripped.startsWith('prettier-ignore')) {
    const after = stripped.slice('prettier-ignore'.length);
    if (after.length === 0 || /[\s,]/.test(after[0])) {
      return { kind: 'prettier-ignore' };
    }
  }
  return null;
}

// Scan one comment's body line by line for directives. Block-comment
// lines lose a leading run of `*`s (JSDoc style); line comments do
// not (ESLint itself only trims whitespace there).
function findingsInComment(source, comment, file) {
  const findings = [];
  const body = source.slice(comment.bodyStart, comment.bodyEnd);
  const lines = body.split('\n');
  let offset = comment.bodyStart;
  for (const line of lines) {
    const stripped = comment.block
      ? line.replace(/^\s*\*+\s?/, '').trim()
      : line.trim();
    if (stripped.length > 0) {
      const detail = matchDirectiveLine(stripped);
      if (detail) {
        findings.push({
          file,
          line: lineNumberAt(source, offset),
          text: stripped.slice(0, MAX_SNIPPET_LENGTH),
          ...detail,
        });
      }
    }
    offset += line.length + 1;
  }
  return findings;
}

export function analyzeSource(source, file) {
  const findings = [];
  for (const comment of extractComments(source)) {
    findings.push(...findingsInComment(source, comment, file));
  }
  findings.sort((a, b) => a.line - b.line);
  return { file, findings };
}

export async function analyzeFiles(files, { readFile }) {
  const results = [];
  for (const file of files) {
    const source = await readFile(file);
    results.push(analyzeSource(source, file));
  }
  return results;
}

export async function discoverSourceFiles(root) {
  const found = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const relative = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(relative);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))
      ) {
        found.push(relative);
      }
    }
  };
  for (const scanRoot of SCAN_ROOTS) {
    await walk(scanRoot);
  }
  return found.sort();
}

export function summarizeResults(results) {
  const byKind = {};
  const byDirectory = {};
  let totalSuppressions = 0;
  let filesWithSuppressions = 0;
  let blanketEslintDisables = 0;
  let istanbulIgnoreFile = 0;
  let testFileSuppressions = 0;
  for (const { file, findings } of results) {
    if (findings.length > 0) filesWithSuppressions += 1;
    if (file.endsWith('.test.mjs')) testFileSuppressions += findings.length;
    totalSuppressions += findings.length;
    if (findings.length > 0) {
      const dir = file.includes('/')
        ? file.slice(0, file.lastIndexOf('/'))
        : '.';
      byDirectory[dir] = (byDirectory[dir] ?? 0) + findings.length;
    }
    for (const finding of findings) {
      byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1;
      if (finding.kind.startsWith('eslint-disable') && finding.blanket) {
        blanketEslintDisables += 1;
      }
      if (finding.kind === 'istanbul-ignore' && finding.scope === 'file') {
        istanbulIgnoreFile += 1;
      }
    }
  }
  const sortedByKind = {};
  for (const kind of Object.keys(byKind).sort()) {
    sortedByKind[kind] = byKind[kind];
  }
  const sortedByDirectory = {};
  for (const dir of Object.keys(byDirectory).sort(
    (a, b) => byDirectory[b] - byDirectory[a] || a.localeCompare(b),
  )) {
    sortedByDirectory[dir] = byDirectory[dir];
  }
  return {
    filesScanned: results.length,
    filesWithSuppressions,
    totalSuppressions,
    testFileSuppressions,
    blanketEslintDisables,
    istanbulIgnoreFile,
    byKind: sortedByKind,
    byDirectory: sortedByDirectory,
  };
}

export function rankFiles(results) {
  return results
    .filter((result) => result.findings.length > 0)
    .map((result) => {
      const byKind = {};
      for (const finding of result.findings) {
        byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1;
      }
      return { file: result.file, total: result.findings.length, byKind };
    })
    .sort((a, b) => b.total - a.total || a.file.localeCompare(b.file));
}

export function limitFindings(findings, limit) {
  if (limit === 0) return findings;
  return findings.slice(0, limit);
}

export function filterSuppressionsByFiles(results, files) {
  if (files.length === 0) return results;
  const wanted = new Set(files);
  return results.filter((result) => wanted.has(result.file));
}

export function flatFindings(results) {
  return results
    .flatMap((result) => result.findings)
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function describeFinding(finding) {
  const parts = [];
  if (finding.rules !== undefined) {
    parts.push(
      finding.rules.length > 0
        ? `rules: ${finding.rules.join(', ')}`
        : 'BLANKET (no rules)',
    );
    if (finding.reason) parts.push(`reason: ${finding.reason}`);
  }
  if (finding.scope !== undefined) parts.push(`scope: ${finding.scope}`);
  const detail = parts.length > 0 ? ` [${parts.join('; ')}]` : '';
  return `${finding.file}:${finding.line} [${finding.kind}]${detail} — ${finding.text}`;
}

export function formatSuppressionReport({ summary, findings, ranked }, limit) {
  const lines = [];
  lines.push(
    `Suppression scoreboard — ${summary.totalSuppressions} suppression(s) ` +
      `in ${summary.filesWithSuppressions} file(s) ` +
      `(${summary.filesScanned} files scanned)`,
  );
  lines.push(
    `Blanket eslint-disable: ${summary.blanketEslintDisables} | ` +
      `istanbul ignore file: ${summary.istanbulIgnoreFile} | ` +
      `in test files: ${summary.testFileSuppressions}`,
  );
  lines.push('');
  lines.push('By kind:');
  for (const [kind, count] of Object.entries(summary.byKind)) {
    lines.push(`  ${kind}  ${count}`);
  }
  if (Object.keys(summary.byDirectory).length > 0) {
    lines.push('');
    lines.push('By directory:');
    for (const [dir, count] of Object.entries(summary.byDirectory)) {
      lines.push(`  ${dir}  ${count}`);
    }
  }
  const shownRanked = limitFindings(ranked, limit);
  lines.push('');
  lines.push(
    `Files ranked by suppression count (showing ${shownRanked.length} ` +
      `of ${ranked.length}):`,
  );
  for (const entry of shownRanked) {
    lines.push(`  ${entry.total}  ${entry.file}`);
  }
  const shownFindings = limitFindings(findings, limit);
  lines.push('');
  lines.push(
    `Findings (showing ${shownFindings.length} of ${findings.length}):`,
  );
  for (const finding of shownFindings) {
    lines.push(`  ${describeFinding(finding)}`);
  }
  if (findings.length > shownFindings.length) {
    lines.push(
      `  ... and ${findings.length - shownFindings.length} more ` +
        `(re-run with --limit 0 for all)`,
    );
  }
  return lines.join('\n');
}

export function parseCliArgs(argv) {
  const args = {
    json: false,
    strict: false,
    help: false,
    limit: DEFAULT_LIMIT,
  };
  const files = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--strict') {
      args.strict = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--limit' || arg.startsWith('--limit=')) {
      let raw;
      if (arg === '--limit') {
        raw = argv[i + 1];
        i += 1;
      } else {
        raw = arg.slice('--limit='.length);
      }
      if (raw === undefined || raw === '' || !/^\d+$/.test(raw)) {
        return { error: `--limit needs a non-negative integer (got ${raw})` };
      }
      args.limit = Number(raw);
    } else if (arg.startsWith('-')) {
      return { error: `unknown flag ${arg}` };
    } else {
      files.push(arg);
    }
    i += 1;
  }
  return { ...args, files };
}
