// Complexity-hotspot scoreboard: report-only static audit of `src/`
// maintainability hotspots.
//
// For every `src/**/*.js|mjs` file (excluding `*.test.mjs`) it reports a
// heuristic per-file profile:
//
// - lines / codeLines — total lines vs non-blank lines of real code
//   (comments and string/template text blanked, newlines kept).
// - functionCount — `function` keywords plus arrow functions (`=>`).
// - branchCount — `if` / `for` / `while` / `case` / `catch` keywords plus
//   ternary `?`, `&&`, `||`, and `??` operators.
// - complexity — `1 + branchCount` (cyclomatic-style, per file).
// - maxDepth — deepest brace nesting at which a branch occurs.
// - longestFunctionLines — longest function body in lines, found by
//   brace-matching from the first `{` after each function start.
// - todoCount — TODO / FIXME / HACK / XXX markers inside comments.
// - hotspotScore — `complexity + 2 * maxDepth
//   + ceil(longestFunctionLines / 25) + todoCount`, ranked descending.
//
// Heuristic, not a parser: regex literals are scanned as code (a regex
// containing the word `if` inflates branchCount by one), method
// shorthand is not counted as a function, and `${…}` interpolation
// inside template literals is scanned as code. Rank order is
// deterministic: hotspotScore desc, complexity desc, longest function
// desc, file asc.
//
// Report-only: no file writes, no behaviour change. Exit 0 even when
// hotspots exist; `--strict` exits 1 when any file nests branches
// deeper than STRICT_MAX_DEPTH (the one gated finding class).

import path from 'node:path';
import { readdir } from 'node:fs/promises';

export const DEFAULT_LIMIT = 10;
export const STRICT_MAX_DEPTH = 6;
export const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX)\b/gi;

function isWordChar(char) {
  return char === '_' || char === '$' || /[A-Za-z0-9]/.test(char);
}

function isWordAt(code, index, word) {
  if (!code.startsWith(word, index)) return false;
  const before = index === 0 ? '' : code[index - 1];
  const after = code[index + word.length] ?? '';
  return !isWordChar(before) && !isWordChar(after);
}

// Blank comments and string/template-literal text to spaces (newlines
// kept, offsets preserved) so keyword counting only sees real code.
// Template `${…}` interpolations are scanned as code, including nested
// templates; comment text is collected separately for TODO counting.
// `chars` uses `split('')` — UTF-16 code units, index-aligned with
// `source` — never `[...source]`, whose code-point iteration shifts
// every index after an astral character (emoji).
export function blankCommentsAndStrings(source) {
  const chars = source.split('');
  const commentChars = [];
  const blank = (from, to) => {
    for (let i = from; i < to; i += 1) {
      if (chars[i] !== '\n') chars[i] = ' ';
    }
  };

  // Frames: { type: 'code' | 'template', braceDepth, interpolation }.
  // The bottom frame is the file's code. A template frame's `${`
  // pushes an interpolation code frame; its closing `}` at depth 0
  // pops back to the template.
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
        frames.pop();
        i += 1;
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
      commentChars.push(chars.slice(i, j).join(''));
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === '/' && next === '*') {
      let j = i + 2;
      while (
        j + 1 < chars.length &&
        !(chars[j] === '*' && chars[j + 1] === '/')
      ) {
        j += 1;
      }
      const end = Math.min(j + 2, chars.length);
      commentChars.push(chars.slice(i, end).join(''));
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
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '`') {
      frames.push({ type: 'template', braceDepth: 0, interpolation: false });
      i += 1;
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
  return { code: chars.join(''), comments: commentChars.join('\n') };
}

// Count TODO / FIXME / HACK / XXX markers in comment text. The global
// regex's lastIndex is reset so repeated calls on the same text agree.
export function countTodos(commentText) {
  TODO_PATTERN.lastIndex = 0;
  let count = 0;
  while (TODO_PATTERN.exec(commentText) !== null) count += 1;
  return count;
}

const BRANCH_KEYWORDS = ['if', 'for', 'while', 'case', 'catch'];

// Length in lines of the function starting at `start` (index of the
// `function` keyword or `=>`): brace-match from the first `{` after
// the start. Expression-bodied arrows (`=> expr`) have no brace and
// count as 1 line.
function functionLengthLines(code, start) {
  const open = code.indexOf('{', start);
  const lineBreak = code.indexOf('\n', start);
  if (open === -1 || (lineBreak !== -1 && lineBreak < open)) return 1;
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return code.slice(start, i + 1).split('\n').length;
      }
    }
  }
  return code.slice(start).split('\n').length;
}

// Per-file complexity profile for one source text. `file` is carried
// through for ranking / reporting only.
export function analyzeSource(source, file) {
  const rawLines = source.split('\n');
  if (rawLines.length && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }
  const { code, comments } = blankCommentsAndStrings(source);
  const codeLines = code
    .split('\n')
    .filter((line) => line.trim() !== '').length;

  let functionCount = 0;
  let branchCount = 0;
  let maxDepth = 0;
  const functionStarts = [];
  let depth = 0;
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (isWordAt(code, i, 'function')) {
      functionCount += 1;
      functionStarts.push(i);
      continue;
    }
    if (code.startsWith('=>', i)) {
      functionCount += 1;
      functionStarts.push(i);
      continue;
    }
    let isBranch = false;
    let twoCharOperator = false;
    for (const keyword of BRANCH_KEYWORDS) {
      if (isWordAt(code, i, keyword)) {
        isBranch = true;
        break;
      }
    }
    if (!isBranch) {
      const next = code[i + 1] ?? '';
      if (
        (ch === '&' && next === '&') ||
        (ch === '|' && next === '|') ||
        (ch === '?' && next === '?')
      ) {
        isBranch = true;
        // Skip the second char so `??` is not also counted as a
        // ternary `?`, and `&&` / `||` are not counted twice.
        twoCharOperator = true;
      } else if (ch === '?' && next !== '.' && next !== '?') {
        // Ternary `?` — not optional chaining (`?.`) or `??`.
        isBranch = true;
      }
    }
    if (isBranch) {
      branchCount += 1;
      if (depth > maxDepth) maxDepth = depth;
      if (twoCharOperator) i += 1;
    }
  }

  let longestFunctionLines = 0;
  for (const start of functionStarts) {
    const length = functionLengthLines(code, start);
    if (length > longestFunctionLines) longestFunctionLines = length;
  }

  const todoCount = countTodos(comments);
  const complexity = 1 + branchCount;
  const hotspotScore =
    complexity +
    2 * maxDepth +
    Math.ceil(longestFunctionLines / 25) +
    todoCount;
  return {
    file,
    lines: rawLines.length,
    codeLines,
    functionCount,
    branchCount,
    complexity,
    maxDepth,
    longestFunctionLines,
    todoCount,
    hotspotScore,
  };
}

// All scanned source files under `<root>/src`: `.js`/`.mjs` except
// `*.test.mjs`, returned as root-relative paths, sorted.
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

// Profile every file in `files`. `readFile` is injected so tests can
// use in-memory fakes; the CLI wires the real filesystem.
export async function analyzeFiles(files, { readFile }) {
  const results = [];
  let totalLines = 0;
  let totalCodeLines = 0;
  let totalComplexity = 0;
  let totalFunctions = 0;
  let totalTodos = 0;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const profile = analyzeSource(source, file);
    results.push(profile);
    totalLines += profile.lines;
    totalCodeLines += profile.codeLines;
    totalComplexity += profile.complexity;
    totalFunctions += profile.functionCount;
    totalTodos += profile.todoCount;
  }
  return {
    results,
    stats: {
      files: files.length,
      totalLines,
      totalCodeLines,
      totalComplexity,
      totalFunctions,
      totalTodos,
    },
  };
}

// Rank: hotspotScore desc, complexity desc, longest function desc,
// file asc. Deterministic — no wall-clock or hash order.
export function rankHotspots(results) {
  return [...results].sort((a, b) => {
    if (b.hotspotScore !== a.hotspotScore) {
      return b.hotspotScore - a.hotspotScore;
    }
    if (b.complexity !== a.complexity) {
      return b.complexity - a.complexity;
    }
    if (b.longestFunctionLines !== a.longestFunctionLines) {
      return b.longestFunctionLines - a.longestFunctionLines;
    }
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    return 0;
  });
}

// Keep only profiles for `files`. Empty `files` keeps everything.
export function filterHotspotsByFiles(results, files) {
  if (!files.length) return results;
  const wanted = new Set(files);
  return results.filter((profile) => wanted.has(profile.file));
}

export function limitHotspots(hotspots, limit) {
  return limit === 0 ? hotspots : hotspots.slice(0, limit);
}

export function summarizeResults(stats, hotspots) {
  const ranked = rankHotspots(hotspots);
  const avgComplexity =
    stats.files === 0
      ? 0
      : Math.round((stats.totalComplexity / stats.files) * 10) / 10;
  return {
    ...stats,
    hotspots: hotspots.length,
    topFile: ranked[0]?.file ?? null,
    maxScore: ranked[0]?.hotspotScore ?? 0,
    avgComplexity,
  };
}

export function formatComplexityReport(
  { stats, hotspots },
  limit = DEFAULT_LIMIT,
) {
  const summary = summarizeResults(stats, hotspots);
  const lines = [
    `Complexity-hotspot scoreboard: ${summary.files} files, ` +
      `${summary.totalLines} lines (${summary.totalCodeLines} code), ` +
      `${summary.totalFunctions} functions, ${summary.totalTodos} TODOs`,
    `Avg complexity: ${summary.avgComplexity} | max hotspot score: ` +
      `${summary.maxScore}${summary.topFile ? ` (${summary.topFile})` : ''}`,
    '',
  ];
  const shown = limitHotspots(rankHotspots(hotspots), limit);
  if (!shown.length) {
    lines.push('No source files found.');
  } else {
    lines.push('score  cmplx depth longestFn funcs branches todos  file');
    for (const profile of shown) {
      lines.push(
        `${String(profile.hotspotScore).padStart(5)}  ` +
          `${String(profile.complexity).padStart(5)}  ` +
          `${String(profile.maxDepth).padStart(4)}  ` +
          `${String(profile.longestFunctionLines).padStart(9)}  ` +
          `${String(profile.functionCount).padStart(5)}  ` +
          `${String(profile.branchCount).padStart(8)}  ` +
          `${String(profile.todoCount).padStart(5)}  ${profile.file}`,
      );
    }
    if (shown.length < hotspots.length) {
      lines.push(
        `... and ${hotspots.length - shown.length} more file(s) (use --limit 0 to show all).`,
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
