// Import-cycle scoreboard: report-only static audit of the src/ import graph.
//
// A circular import (`a.js` imports `b.js` imports `a.js`) is legal ESM
// but a standing source of partial-initialization bugs: whichever module
// the loader enters first sees the other's bindings still in their
// temporal dead zone, so behaviour depends on entry point. This scanner
// builds the directed graph of static + dynamic relative imports across
// `src/**/*.js|mjs` (excluding `*.test.mjs`), finds strongly connected
// components with Tarjan's algorithm, and reports each cycle as a
// scoreboard ranked by size, then internal edge count, then first file.
//
// Only relative specifiers (starting with `.`) are graph edges: bare
// package imports and `node:` builtins cannot form a cycle inside the
// repo. A resolved target that is not a JS module (`.json` via
// `with { type: 'json' }`, `.css`) is counted as `non-module`, not a
// cycle edge; a specifier that resolves to no file is `unresolved`.
//
// The scanner is comment/string/regex aware: imports inside comments,
// string literals, regex literals, and template-literal text are not
// edges. Template `${…}` interpolations are scanned as code (a dynamic
// `import(…)` there is real code), including nested templates.
//
// Report-only: no file writes, no behaviour change. Exit 0 even when
// cycles exist; `--strict` exits 1 when any cycle is found.

import path from 'node:path';
import { readdir } from 'node:fs/promises';

export const DEFAULT_LIMIT = 10;

const EMPTY_SET = Object.freeze(new Set());

function isWordChar(char) {
  return char === '_' || char === '$' || /[A-Za-z0-9]/.test(char);
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

// Split source into code plus the spans of string and regex literals.
// Comments and template-literal text are blanked to spaces (newlines
// kept, offsets preserved) so pattern matching only sees real code.
// String contents are kept intact — the import specifiers live in
// them — and reported as spans so a match starting inside one can be
// rejected. `chars` uses `split('')` — UTF-16 code units, index-aligned
// with `source` — never `[...source]`, whose code-point iteration
// shifts every index after an astral character (emoji).
export function scanSource(source) {
  const chars = source.split('');
  const stringSpans = [];
  const regexSpans = [];
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
      stringSpans.push([i, end]);
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
      regexSpans.push([i, end]);
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
  return { code: chars.join(''), stringSpans, regexSpans };
}

// Static imports (default/named/namespace/side-effect), re-exports
// (`export … from`), and dynamic `import(…)`. The binding part of a
// static import excludes `;` so the pattern cannot span into the next
// statement and swallow a side-effect import (`import './a'; export
// … from './b'` must yield both specifiers).
const STATIC_IMPORT = /\bimport\s+(?:[^'";]*?\bfrom\s+)?['"]([^'"]+)['"]/g;
const REEXPORT =
  /\bexport\s+(?:\*\s+(?:as\s+\w+\s+)?from|\{[^}]*\}\s+from)\s+['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]/g;

function inSpans(spans, offset) {
  return spans.some(([start, end]) => offset >= start && offset < end);
}

// Relative import specifiers in `source`, deduplicated, grouped by
// pattern: static imports, then re-exports, then dynamic imports.
// `import.meta` is not an import; bare package / `node:` specifiers
// are not relative and are not returned.
export function extractRelativeImports(source) {
  const { code, stringSpans, regexSpans } = scanSource(source);
  const specs = [];
  for (const pattern of [STATIC_IMPORT, REEXPORT, DYNAMIC_IMPORT]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(code)) !== null) {
      if (match[0] === '') {
        pattern.lastIndex += 1;
        continue;
      }
      if (
        inSpans(stringSpans, match.index) ||
        inSpans(regexSpans, match.index)
      ) {
        continue;
      }
      const spec = match[1];
      if (spec.startsWith('.') && !specs.includes(spec)) specs.push(spec);
    }
  }
  return specs;
}

// Resolve one relative specifier against its importing file.
// `hasFile` answers whether a candidate path is a real file (the CLI
// wires it to the filesystem; tests wire it to a Set). Candidates:
// exact path, `+.js`, `+.mjs`, `/index.js`, `/index.mjs`. Paths stay
// in the importer's form (relative in, relative out) so graph keys
// stay consistent.
export function resolveImport(importer, spec, hasFile) {
  if (!spec.startsWith('.')) return { status: 'external', target: null };
  const base = path.join(path.dirname(importer), spec);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, 'index.js'),
    path.join(base, 'index.mjs'),
  ];
  for (const candidate of candidates) {
    if (hasFile(candidate)) {
      if (candidate.endsWith('.js') || candidate.endsWith('.mjs')) {
        return { status: 'module', target: candidate };
      }
      return { status: 'non-module', target: candidate };
    }
  }
  return { status: 'unresolved', target: null };
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

// Build the import graph for `files`. `readFile` / `hasFile` are
// injected so tests can use in-memory fakes; the CLI wires the real
// filesystem. Returns the graph (file -> Set of module targets) plus
// counts and the per-import details behind the non-module /
// unresolved counts.
export async function analyzeFiles(files, { readFile, hasFile }) {
  const graph = new Map();
  const nonModuleImports = [];
  const unresolvedImports = [];
  let edges = 0;
  let nonModule = 0;
  let unresolved = 0;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const targets = new Set();
    for (const spec of extractRelativeImports(source)) {
      const resolved = resolveImport(file, spec, hasFile);
      if (resolved.status === 'module') {
        targets.add(resolved.target);
      } else if (resolved.status === 'non-module') {
        nonModule += 1;
        nonModuleImports.push({ file, spec, target: resolved.target });
      } else if (resolved.status === 'unresolved') {
        unresolved += 1;
        unresolvedImports.push({ file, spec });
      }
    }
    graph.set(file, targets);
    edges += targets.size;
  }
  return {
    graph,
    stats: { files: files.length, edges, nonModule, unresolved },
    nonModuleImports,
    unresolvedImports,
  };
}

// One concrete cycle through a strongly connected component: a greedy
// walk from the alphabetically first member. The walk never branches,
// so every visited node is on the current path; each component member
// has an in-component successor, so the walk must eventually revisit
// a node on the path, closing a real cycle (returned with its start
// node repeated at the end). A single-member component is a self-loop.
function representativeCyclePath(memberSet, successors) {
  const start = [...memberSet].sort()[0];
  const path = [start];
  const position = new Map([[start, 0]]);
  let current = start;
  for (;;) {
    const onPath = [...successors(current)]
      .filter((n) => memberSet.has(n) && position.has(n))
      .sort();
    if (onPath.length) {
      const close = onPath[0];
      return [...path.slice(position.get(close)), close];
    }
    const unvisited = [...successors(current)]
      .filter((n) => memberSet.has(n) && !position.has(n))
      .sort();
    const next = unvisited[0];
    position.set(next, path.length);
    path.push(next);
    current = next;
  }
}

// Tarjan's algorithm: every strongly connected component with more
// than one member — or a single member importing itself — is a cycle.
// Targets outside the scanned set are leaves (no outgoing edges) and
// can never be in a cycle.
export function findCycles(graph) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let counter = 0;
  const successors = (node) => graph.get(node) ?? EMPTY_SET;
  function strongconnect(node) {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of successors(node)) {
      if (!index.has(next)) {
        strongconnect(next);
        low.set(node, Math.min(low.get(node), low.get(next)));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node), index.get(next)));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component = [];
      let popped;
      do {
        popped = stack.pop();
        onStack.delete(popped);
        component.push(popped);
      } while (popped !== node);
      components.push(component);
    }
  }
  const nodes = new Set([...graph.keys()]);
  for (const targets of graph.values()) {
    for (const target of targets) nodes.add(target);
  }
  for (const node of nodes) {
    if (!index.has(node)) strongconnect(node);
  }
  const cycles = [];
  for (const component of components) {
    const memberSet = new Set(component);
    const selfLoop =
      component.length === 1 && successors(component[0]).has(component[0]);
    if (component.length === 1 && !selfLoop) continue;
    const members = [...component].sort();
    const edges = [];
    for (const from of members) {
      for (const to of successors(from)) {
        if (memberSet.has(to)) edges.push([from, to]);
      }
    }
    cycles.push({
      members,
      edges,
      path: representativeCyclePath(memberSet, successors),
    });
  }
  return rankCycles(cycles);
}

// Rank: most members first, then most internal edges, then first
// member alphabetically. Deterministic — no wall-clock or hash order.
export function rankCycles(cycles) {
  return [...cycles].sort((a, b) => {
    if (b.members.length !== a.members.length) {
      return b.members.length - a.members.length;
    }
    if (b.edges.length !== a.edges.length) {
      return b.edges.length - a.edges.length;
    }
    if (a.members[0] < b.members[0]) return -1;
    if (a.members[0] > b.members[0]) return 1;
    return 0;
  });
}

// Keep only cycles containing at least one of `files`. Empty `files`
// keeps everything.
export function filterCyclesByFiles(cycles, files) {
  if (!files.length) return cycles;
  const wanted = new Set(files);
  return cycles.filter((cycle) =>
    cycle.members.some((member) => wanted.has(member)),
  );
}

export function summarizeResults(stats, cycles) {
  const inCycles = new Set();
  for (const cycle of cycles) {
    for (const member of cycle.members) inCycles.add(member);
  }
  return { ...stats, cycles: cycles.length, filesInCycles: inCycles.size };
}

export function limitCycles(cycles, limit) {
  return limit === 0 ? cycles : cycles.slice(0, limit);
}

export function formatImportCyclesReport(
  { stats, cycles, nonModuleImports = [], unresolvedImports = [] },
  limit = DEFAULT_LIMIT,
) {
  const summary = summarizeResults(stats, cycles);
  const lines = [
    `Import-cycle scoreboard: ${summary.files} files, ${summary.edges} edges, ${summary.cycles} cycle(s)`,
    `Files in cycles: ${summary.filesInCycles} | non-module imports: ${summary.nonModule} | unresolved: ${summary.unresolved}`,
    '',
  ];
  const shown = limitCycles(cycles, limit);
  if (!shown.length) {
    lines.push('No import cycles found.');
  } else {
    shown.forEach((cycle, i) => {
      lines.push(
        `Cycle ${i + 1} (${cycle.members.length} files, ${cycle.edges.length} edges):`,
      );
      lines.push(`  ${cycle.path.join(' -> ')}`);
      lines.push('  Members:');
      for (const member of cycle.members) lines.push(`    - ${member}`);
    });
    if (shown.length < cycles.length) {
      lines.push(
        `... and ${cycles.length - shown.length} more cycle(s) (use --limit 0 to show all).`,
      );
    }
  }
  if (nonModuleImports.length) {
    lines.push('', `Non-module imports (${nonModuleImports.length}):`);
    for (const entry of nonModuleImports) {
      lines.push(`  ${entry.file} -> ${entry.spec} (${entry.target})`);
    }
  }
  if (unresolvedImports.length) {
    lines.push('', `Unresolved imports (${unresolvedImports.length}):`);
    for (const entry of unresolvedImports) {
      lines.push(`  ${entry.file} -> ${entry.spec}`);
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
