// Todo-debt scoreboard: report-only static audit of comment debt
// markers across `src/`, `server/`, `scripts/`, and `tests/`.
//
// A debt marker is a comment line that OPENS with one of five words
// (uppercase only): FIXME, XXX, HACK, TODO, NOTE. Severity is a
// chosen classification, not a standard:
// - FIXME / XXX / HACK count as `debt`: something is known-broken,
//   surprising, or worked around and needs fixing.
// - TODO counts as `planned`: work the author already intends to do.
// - NOTE counts as `info`: context, not debt; reported so the totals
//   are transparent, but never counted in the debt score.
//
// Only REAL comments count. A marker inside a string, template
// literal, or regex literal is not a comment and is not counted.
// A marker only counts when it opens the comment line (after
// whitespace and, on block-comment continuation lines, one leading
// `*`): a marker buried mid-sentence (`// see the TODO list`) is
// prose, not a marker. One finding per comment line: when a line
// opens with a marker, that first marker is the finding.
// Lowercase `todo` never counts: it is usually prose.
//
// Report-only: no file writes, no behaviour change. Exit 0 even
// when markers exist; `--strict` exits 1 when any finding with
// severity `debt` (FIXME / XXX / HACK) exists.

import path from 'node:path';
import { readdir } from 'node:fs/promises';

export const DEFAULT_LIMIT = 10;
export const SCAN_ROOTS = ['src', 'server', 'scripts', 'tests'];
export const MAX_SNIPPET_LENGTH = 160;
export const MARKERS = ['TODO', 'FIXME', 'XXX', 'HACK', 'NOTE'];
export const SEVERITY_BY_MARKER = {
  FIXME: 'debt',
  XXX: 'debt',
  HACK: 'debt',
  TODO: 'planned',
  NOTE: 'info',
};

const SCAN_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.jsx',
  '.tsx',
  '.css',
]);
const SKIP_DIRS = new Set(['node_modules', '.git']);
const MARKER_AT_START = /^(TODO|FIXME|XXX|HACK|NOTE)\b/;
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

// Collect comment spans: { text, line, block }. `text` covers the
// delimiters; `line` is the 1-based line where the comment starts.
// Strings, template literals (including `${…}` interpolation), and
// regex literals are skipped so a `//` inside one never starts a
// comment. Comments inside template interpolation are found.
export function extractComments(source) {
  const comments = [];
  const stack = [{ type: 'code' }];
  let i = 0;
  let line = 1;
  // Last significant token in the current code context: an
  // identifier/keyword, a punctuator char, or '' at the start.
  // Used to tell a regex literal from division.
  let lastToken = '';
  const top = () => stack[stack.length - 1];

  const advanceLine = (char) => {
    if (char === '\n') line += 1;
  };

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1] ?? '';
    const frame = top();

    if (frame.type === 'template') {
      if (char === '\\') {
        advanceLine(source[i + 1]);
        i += 2;
        continue;
      }
      if (char === '`') {
        stack.pop();
        lastToken = '`';
        i += 1;
        continue;
      }
      if (char === '$' && next === '{') {
        stack.push({ type: 'interp', depth: 0 });
        i += 2;
        continue;
      }
      advanceLine(char);
      i += 1;
      continue;
    }

    // Code or interpolation context.
    if (char === '/' && next === '/') {
      const start = i;
      const startLine = line;
      while (i < source.length && source[i] !== '\n') i += 1;
      comments.push({
        text: source.slice(start, i),
        line: startLine,
        block: false,
      });
      lastToken = '/';
      continue;
    }
    if (char === '/' && next === '*') {
      const start = i;
      const startLine = line;
      i += 2;
      let closed = false;
      while (i < source.length) {
        if (source[i] === '*' && source[i + 1] === '/') {
          i += 2;
          closed = true;
          break;
        }
        advanceLine(source[i]);
        i += 1;
      }
      if (!closed) i = source.length;
      comments.push({
        text: source.slice(start, i),
        line: startLine,
        block: true,
      });
      lastToken = '/';
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i += 1;
          break;
        }
        advanceLine(source[i]);
        i += 1;
      }
      lastToken = quote;
      continue;
    }
    if (char === '`') {
      stack.push({ type: 'template' });
      i += 1;
      continue;
    }
    if (char === '/' && next !== '/' && next !== '*') {
      const regexHere =
        lastToken === '' ||
        REGEX_KEYWORDS.has(lastToken) ||
        REGEX_PUNCTUATORS.has(lastToken);
      if (regexHere) {
        i += 1;
        let inClass = false;
        while (i < source.length) {
          const current = source[i];
          if (current === '\\') {
            i += 2;
            continue;
          }
          if (current === '\n') break;
          if (current === '[') inClass = true;
          if (current === ']') inClass = false;
          if (current === '/' && !inClass) {
            i += 1;
            break;
          }
          i += 1;
        }
        while (i < source.length && /[a-z]/i.test(source[i])) i += 1;
        lastToken = '/';
        continue;
      }
      // Division: fall through to the generic handling below.
    }
    if (frame.type === 'interp' && char === '{') {
      frame.depth += 1;
      lastToken = '{';
      i += 1;
      continue;
    }
    if (frame.type === 'interp' && char === '}') {
      if (frame.depth === 0) {
        stack.pop();
        lastToken = '}';
        i += 1;
        continue;
      }
      frame.depth -= 1;
      lastToken = '}';
      i += 1;
      continue;
    }
    if (isIdentifierStart(char)) {
      let end = i + 1;
      while (end < source.length && isWordChar(source[end])) end += 1;
      lastToken = source.slice(i, end);
      i = end;
      continue;
    }
    if (/\s/.test(char)) {
      advanceLine(char);
      i += 1;
      continue;
    }
    lastToken = char;
    i += 1;
  }
  return comments;
}

function stripCommentLine(rawLine, isFirst, isLast, isBlock) {
  let content = rawLine;
  if (isFirst) {
    content = content.replace(/^\s*(\/\/|\/\*)/, '');
  }
  if (isBlock && isLast) {
    content = content.replace(/\*\/\s*$/, '');
  }
  content = content.replace(/^\s*\*\s?/, '');
  return content.trim();
}

// Findings for one file: { file, line, marker, severity, text }.
export function analyzeSource(source, file) {
  const findings = [];
  for (const comment of extractComments(source)) {
    const lines = comment.text.split('\n');
    lines.forEach((rawLine, index) => {
      const content = stripCommentLine(
        rawLine,
        index === 0,
        index === lines.length - 1,
        comment.block,
      );
      const match = MARKER_AT_START.exec(content);
      if (!match) return;
      const marker = match[1];
      findings.push({
        file,
        line: comment.line + index,
        marker,
        severity: SEVERITY_BY_MARKER[marker],
        text: content.slice(0, MAX_SNIPPET_LENGTH),
      });
    });
  }
  return findings;
}

export async function analyzeFiles(files, { readFile }) {
  const results = [];
  for (const file of files) {
    const source = await readFile(file);
    results.push({ file, findings: analyzeSource(source, file) });
  }
  return results;
}

export async function discoverSourceFiles(root) {
  const found = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(path.join(root, dir), {
        withFileTypes: true,
      });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(relative);
      } else if (
        entry.isFile() &&
        SCAN_EXTENSIONS.has(path.extname(entry.name))
      ) {
        found.push(relative);
      }
    }
  }
  for (const scanRoot of SCAN_ROOTS) await walk(scanRoot);
  return found.sort();
}

export function summarizeResults(results) {
  const byMarker = {};
  for (const marker of MARKERS) byMarker[marker] = 0;
  const bySeverity = { debt: 0, planned: 0, info: 0 };
  let totalFindings = 0;
  let filesWithFindings = 0;
  for (const { findings } of results) {
    if (findings.length > 0) filesWithFindings += 1;
    for (const finding of findings) {
      totalFindings += 1;
      byMarker[finding.marker] += 1;
      bySeverity[finding.severity] += 1;
    }
  }
  return {
    filesScanned: results.length,
    filesWithFindings,
    totalFindings,
    debtTotal: bySeverity.debt,
    byMarker,
    bySeverity,
  };
}

export function rankFiles(results) {
  const ranked = results.map(({ file, findings }) => {
    const counts = { debt: 0, planned: 0, info: 0 };
    for (const finding of findings) counts[finding.severity] += 1;
    return {
      file,
      debt: counts.debt,
      planned: counts.planned,
      info: counts.info,
      total: findings.length,
    };
  });
  ranked.sort((a, b) => {
    // Debt first, then planned, then total, then file name:
    // fully deterministic.
    if (b.debt !== a.debt) return b.debt - a.debt;
    if (b.planned !== a.planned) return b.planned - a.planned;
    if (b.total !== a.total) return b.total - a.total;
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  });
  return ranked;
}

export function flatFindings(results) {
  return results
    .flatMap(({ findings }) => findings)
    .sort((a, b) => {
      if (a.file !== b.file) return a.file < b.file ? -1 : 1;
      return a.line - b.line;
    });
}

export function filterTodoDebtByFiles(results, files) {
  if (!files || files.length === 0) return results;
  const wanted = new Set(files);
  return results.filter(({ file }) => wanted.has(file));
}

export function limitFindings(list, limit) {
  if (!limit || limit <= 0) return list;
  return list.slice(0, limit);
}

export function parseCliArgs(argv) {
  const args = {
    json: false,
    limit: DEFAULT_LIMIT,
    strict: false,
    help: false,
    files: [],
    error: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--strict') {
      args.strict = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--limit' || arg.startsWith('--limit=')) {
      const raw =
        arg === '--limit' ? argv[(index += 1)] : arg.slice('--limit='.length);
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 0) {
        args.error = `--limit expects a non-negative integer, got ${raw ?? ''}`;
        return args;
      }
      args.limit = parsed;
    } else if (arg.startsWith('-')) {
      args.error = `unknown option ${arg}`;
      return args;
    } else {
      args.files.push(arg);
    }
  }
  return args;
}

export function formatTodoDebtReport({ summary, findings, ranked }, limit) {
  const lines = [];
  lines.push('Todo-debt scoreboard');
  lines.push(
    `Files scanned: ${summary.filesScanned} ` +
      `(${summary.filesWithFindings} with findings) | ` +
      `Findings: ${summary.totalFindings} | ` +
      `Debt (FIXME/XXX/HACK): ${summary.bySeverity.debt} | ` +
      `Planned (TODO): ${summary.bySeverity.planned} | ` +
      `Info (NOTE): ${summary.bySeverity.info}`,
  );
  lines.push(
    'By marker: ' +
      MARKERS.map((marker) => `${marker} ${summary.byMarker[marker]}`).join(
        ' · ',
      ),
  );
  lines.push('');
  if (summary.totalFindings === 0) {
    lines.push('No todo-debt markers found.');
    return lines.join('\n');
  }
  lines.push(`Ranked files (top ${limit || 'all'}):`);
  for (const entry of limitFindings(ranked, limit)) {
    if (entry.total === 0) continue;
    lines.push(
      `  ${entry.file} — debt ${entry.debt}, planned ${entry.planned}, ` +
        `info ${entry.info}, total ${entry.total}`,
    );
  }
  lines.push('');
  lines.push(`Findings (top ${limit || 'all'}):`);
  for (const finding of limitFindings(findings, limit)) {
    lines.push(
      `  ${finding.file}:${finding.line} ` +
        `[${finding.marker}/${finding.severity}] ${finding.text}`,
    );
  }
  return lines.join('\n');
}
