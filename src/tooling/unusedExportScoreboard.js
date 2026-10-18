// Unused-export scoreboard: report exported symbols (functions,
// consts, classes, types, defaults) in production files that have
// zero importers anywhere in the repo, ranked by file.
//
// Report-only: nothing is deleted or gated. An entry means "no
// in-repo import found", not "safe to delete" — see the limits.
//
// Rules:
// - Exports are collected from src/ + server/ + scripts/ + build/
//   + root-level JS files. Test files (`*.test.*`, `*.spec.*`,
//   `tests/`, `src/testSupport/`) export nothing reportable, but
//   they DO count as importers: an export used only by tests is
//   reported as test-only, not unused.
// - Importers are every scanned file, including scripts/, tests/,
//   and root configs (vite.config.js re-exports a server module).
// - Named imports, namespace imports (`import * as ns`), dynamic
//   imports (`await import(...)`, destructured or bare), `require`,
//   and re-exports (`export { x } from`, `export * from`) all count
//   as usage. A side-effect-only import (`import './x'`) does NOT
//   count as usage of any named export: it runs the module without
//   touching its exports.
// - Package self-references (`gods-eye-view/...`) resolve through
//   package.json `exports`, so entry-point modules imported by
//   their public name are not misreported as unused.
// - Exports of files listed in package.json `exports` (public API)
//   are excluded from the unused list by default; pass
//   `includePublic: true` / `--include-public` to see them.
// - Self-imports (a file importing its own exports) do not count.
//
// Documented limits (read before deleting anything this flags):
// - String/template content is blanked before parsing, so an
//   import/export spelled inside a string is invisible — and a
//   computed import (`import(\`./layers/${name}\`)`) cannot be
//   resolved, so its target's exports may be misreported.
// - Entry points loaded outside the module graph (HTML script
//   tags, workers, bundler entries) may appear unused.
// - Re-exports via `export *` mark every target export used; a
//   barrel that nobody imports still shields its targets.
// - Destructuring patterns with defaults/computed keys use a
//   best-effort binding extraction; exotic patterns may miss a name.

import path from 'node:path';
import { readdir } from 'node:fs/promises';

export const DEFAULT_LIMIT = 10;
export const SCAN_ROOTS = ['src', 'server', 'scripts', 'tests', 'build'];
export const SCAN_EXTENSIONS = new Set([
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
// `{ value, nextIndex }` where `nextIndex` is just past the escape.
// A backslash-newline (line continuation) decodes to nothing.
function decodeEscape(source, i) {
  const next = source[i + 1];
  if (next === undefined) return { value: '\\', nextIndex: i + 1 };
  if (next === '\n') return { value: '', nextIndex: i + 2 };
  if (next === '\r') {
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

// Blank comments, string/template/regex contents (preserving
// newlines), and replace each quoted string with a
// `__GEVSTRn__` placeholder whose value lands in `strings`.
// Template `${...}` code is kept: it is real code. Returns
// `{ code, strings }` where `code` keeps every newline of `source`
// in order, so line numbers still line up. (`code` is not the
// same length as `source`: a placeholder can be shorter or longer
// than the string it replaces; only newlines are preserved.)
export function stripCommentsAndStrings(source) {
  const strings = [];
  const parts = [];
  const emit = (text) => parts.push(text);
  const blank = (from, to) => {
    emit(source.slice(from, to).replace(/[^\n]/g, ' '));
  };
  const newlines = (from, to) => {
    let count = 0;
    for (let k = from; k < to; k += 1) {
      if (source[k] === '\n') count += 1;
    }
    return '\n'.repeat(count);
  };
  const emitString = (from, to, value) => {
    const placeholder = `__GEVSTR${strings.length}__`;
    strings.push(value);
    emit(placeholder);
    // Keep the string's newlines so later line numbers line up.
    emit(newlines(from, to));
  };
  // Frame stack: { type: 'code', braceDepth } | { type: 'template' }.
  const stack = [{ type: 'code', braceDepth: 0 }];
  let prev = null; // { kind, text } — last significant token in code
  const top = () => stack[stack.length - 1];
  const pushToken = (token) => {
    prev = token;
  };
  const regexAllowed = () => {
    if (prev === null) return true;
    if (prev.kind === 'ident') return REGEX_KEYWORDS.has(prev.text);
    if (prev.kind === 'punct') return REGEX_PUNCTUATORS.has(prev.text);
    return false;
  };

  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const frame = top();

    if (frame.type === 'template') {
      if (char === '`') {
        emit(' ');
        stack.pop();
        pushToken({ kind: 'string', text: '' });
        i += 1;
        continue;
      }
      if (char === '\\') {
        emit(' ');
        if (source[i + 1] !== undefined && source[i + 1] !== '\n') {
          emit(' ');
        } else if (source[i + 1] === '\n') {
          emit('\n');
        }
        i += 2;
        continue;
      }
      if (char === '$' && source[i + 1] === '{') {
        emit('${');
        stack.push({ type: 'code', braceDepth: 0 });
        pushToken({ kind: 'punct', text: '${' });
        i += 2;
        continue;
      }
      emit(char === '\n' ? '\n' : ' ');
      i += 1;
      continue;
    }

    // Code frame.
    if (char === '/' && source[i + 1] === '/') {
      let end = source.indexOf('\n', i);
      if (end === -1) end = source.length;
      blank(i, end);
      i = end;
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const to = end === -1 ? source.length : end + 2;
      blank(i, to);
      i = to;
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char;
      let j = i + 1;
      let value = '';
      while (j < source.length) {
        const c = source[j];
        if (c === '\\') {
          const { value: decoded, nextIndex } = decodeEscape(source, j);
          value += decoded;
          j = nextIndex;
          continue;
        }
        if (c === quote) break;
        if (c === '\n') break; // unterminated: bail, treat as code
        value += c;
        j += 1;
      }
      if (j < source.length && source[j] === quote) {
        emitString(i, j + 1, value);
        pushToken({ kind: 'string', text: '' });
        i = j + 1;
      } else {
        emit(char);
        pushToken({ kind: 'punct', text: quote });
        i += 1;
      }
      continue;
    }
    if (char === '`') {
      emit(' ');
      stack.push({ type: 'template' });
      i += 1;
      continue;
    }
    if (char === '/' && regexAllowed()) {
      // Regex literal: blank through the closing `/` + flags.
      let j = i + 1;
      let inClass = false;
      while (j < source.length) {
        const c = source[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '\n') break;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        j += 1;
      }
      let end = j + 1;
      while (end < source.length && /[a-z]/i.test(source[end])) end += 1;
      blank(i, end);
      pushToken({ kind: 'regex', text: '' });
      i = end;
      continue;
    }
    if (char === '{') {
      frame.braceDepth += 1;
      emit(char);
      pushToken({ kind: 'punct', text: '{' });
      i += 1;
      continue;
    }
    if (char === '}') {
      if (stack.length > 1 && frame.braceDepth === 0) {
        // Closes a `${...}` interpolation: back to the template.
        stack.pop();
        emit(char);
        pushToken({ kind: 'punct', text: '}' });
        i += 1;
        continue;
      }
      frame.braceDepth -= 1;
      emit(char);
      pushToken({ kind: 'punct', text: '}' });
      i += 1;
      continue;
    }
    if (isIdentifierStart(char)) {
      let j = i + 1;
      while (j < source.length && isWordChar(source[j])) j += 1;
      emit(source.slice(i, j));
      pushToken({ kind: 'ident', text: source.slice(i, j) });
      i = j;
      continue;
    }
    if (isDigit(char) || (char === '.' && isDigit(source[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < source.length && /[\w.]/.test(source[j])) j += 1;
      emit(source.slice(i, j));
      pushToken({ kind: 'number', text: '' });
      i = j;
      continue;
    }
    if (char === '+' && source[i + 1] === '+') {
      emit('++');
      pushToken({ kind: 'number', text: '' });
      i += 2;
      continue;
    }
    if (char === '-' && source[i + 1] === '-') {
      emit('--');
      pushToken({ kind: 'number', text: '' });
      i += 2;
      continue;
    }
    if (char === '=' && source[i + 1] === '>') {
      emit('=>');
      pushToken({ kind: 'punct', text: '=>' });
      i += 2;
      continue;
    }
    if (' \t\r\n'.includes(char)) {
      emit(char);
      i += 1;
      continue;
    }
    emit(char);
    pushToken({ kind: 'punct', text: char });
    i += 1;
  }
  return { code: parts.join(''), strings };
}

function makeLineOf(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] === '\n') starts.push(i + 1);
  }
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

function stringValue(strings, placeholder) {
  const match = /^__GEVSTR(\d+)__$/.exec(placeholder);
  if (!match) return null;
  return strings[Number(match[1])] ?? null;
}

// Split on top-level commas: depth-aware over () [] {}.
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

// First top-level `:` or `=` in a binding-pattern fragment, or -1.
function firstTopLevel(text, wanted) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (depth === 0 && wanted.includes(char)) return i;
  }
  return -1;
}

// Binding names of a destructuring pattern (or a bare identifier).
// `{ a, b: c, ...rest }` -> a, c, rest; `[x, [y]]` -> x, y;
// `{ a = 1 }` -> a (defaults are expressions, not bindings).
export function bindingNames(pattern) {
  const text = pattern.trim();
  if (text.startsWith('{') && text.endsWith('}')) {
    const names = [];
    for (const entry of splitTopLevel(text.slice(1, -1))) {
      if (entry.startsWith('...')) {
        names.push(...bindingNames(entry.slice(3)));
        continue;
      }
      const colon = firstTopLevel(entry, ':');
      if (colon !== -1) {
        names.push(...bindingNames(entry.slice(colon + 1)));
        continue;
      }
      const equals = firstTopLevel(entry, '=');
      if (equals !== -1) {
        names.push(...bindingNames(entry.slice(0, equals)));
        continue;
      }
      names.push(...bindingNames(entry));
    }
    return names;
  }
  if (text.startsWith('[') && text.endsWith(']')) {
    const names = [];
    for (const entry of splitTopLevel(text.slice(1, -1))) {
      if (entry.startsWith('...')) {
        names.push(...bindingNames(entry.slice(3)));
        continue;
      }
      const equals = firstTopLevel(entry, '=');
      if (equals !== -1) {
        names.push(...bindingNames(entry.slice(0, equals)));
        continue;
      }
      names.push(...bindingNames(entry));
    }
    return names;
  }
  const match = /^[A-Za-z_$][\w$]*/.exec(text);
  return match ? [match[0]] : [];
}

// Parse an `import { ... }` / `export { ... }` list. Returns
// [{ imported, exported }] where `imported` is the name in the
// source module and `exported` the local name. For imports,
// `import { default as foo }` -> imported 'default'; for exports,
// `export { foo as default }` -> exported 'default'.
function parseBraceList(inner) {
  const entries = [];
  for (const item of splitTopLevel(inner)) {
    const cleaned = item.replace(/^type\s+/, '').trim();
    const match =
      /^([A-Za-z_$][\w$]*|default)(?:\s+as\s+([A-Za-z_$][\w$]*|default))?$/.exec(
        cleaned,
      );
    if (match)
      entries.push({ imported: match[1], exported: match[2] ?? match[1] });
  }
  return entries;
}

function claimSpan(claimed, start, end) {
  for (const [from, to] of claimed) {
    if (start < to && end > from) return false;
  }
  claimed.push([start, end]);
  return true;
}

// Extract exports from stripped `code`. Returns
// [{ name, kind, line }]; `kind` is one of 'function', 'class',
// 'variable', 'named-list', 'named-reexport', 'namespace-reexport',
// 'type', 'type-list', 'default', 'cjs', 'cjs-default'.
export function parseExports(code, strings) {
  const lineOf = makeLineOf(code);
  const exports = [];
  const claimed = [];
  const push = (name, kind, index) => {
    if (!exports.some((entry) => entry.name === name)) {
      exports.push({ name, kind, line: lineOf(index) });
    }
  };

  // `export * as ns from '...'` — also a namespace import.
  const namespaceReexportRe =
    /export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+(__GEVSTR\d+__)/g;
  // `export * from '...'` — no export of its own, handled in imports.
  // `export { a, b as c } from '...'`
  const namedReexportRe =
    /export\s+(?:type\s+)?\{([^}]*)\}\s*from\s+(__GEVSTR\d+__)/g;
  // `export { a, b as c }` (local list, no `from`)
  const namedListRe = /export\s+(?:type\s+)?\{([^}]*)\}(?!\s*from\b)/g;
  // `export default ...`
  const defaultRe = /export\s+default\b/g;
  // `export [declare] [async] function|class|interface|type|enum|namespace name`
  const declarationRe =
    /export\s+(?:declare\s+)?(?:(async\s+function|function|class|abstract\s+class)\s+([A-Za-z_$][\w$]*)|(interface|enum|namespace)\s+([A-Za-z_$][\w$]*)|type\s+([A-Za-z_$][\w$]*)\s*(?:=|<))/g;
  // `export [declare] const|let|var <declarators>;`
  const variableRe = /export\s+(?:declare\s+)?(const|let|var)\s+/g;
  // CommonJS: `exports.name =`, `module.exports.name =`
  const cjsNamedRe =
    /(?<![\w$.])(?:exports|module\.exports)\.([A-Za-z_$][\w$]*)\s*=/g;
  // CommonJS: `module.exports = { a, b }`
  const cjsObjectRe = /module\.exports\s*=\s*\{([^}]*)\}/g;
  // CommonJS: `module.exports = <expr>` (not `.name`, not `{...}`)
  const cjsDefaultRe = /module\.exports\s*=(?!\s*\{)(?!\s*[A-Za-z_$][\w$]*\.)/g;

  let match;
  while ((match = namespaceReexportRe.exec(code)) !== null) {
    if (!claimSpan(claimed, match.index, match.index + match[0].length))
      continue;
    push(match[1], 'namespace-reexport', match.index);
  }
  while ((match = namedReexportRe.exec(code)) !== null) {
    if (!claimSpan(claimed, match.index, match.index + match[0].length))
      continue;
    for (const entry of parseBraceList(match[1])) {
      push(entry.exported, 'named-reexport', match.index);
    }
  }
  while ((match = namedListRe.exec(code)) !== null) {
    if (!claimSpan(claimed, match.index, match.index + match[0].length))
      continue;
    const kind = /export\s+type\s*\{/.test(match[0])
      ? 'type-list'
      : 'named-list';
    for (const entry of parseBraceList(match[1])) {
      push(entry.exported, kind, match.index);
    }
  }
  while ((match = defaultRe.exec(code)) !== null) {
    if (!claimSpan(claimed, match.index, match.index + match[0].length))
      continue;
    push('default', 'default', match.index);
  }
  while ((match = declarationRe.exec(code)) !== null) {
    if (!claimSpan(claimed, match.index, match.index + match[0].length))
      continue;
    if (match[2] !== undefined) {
      push(
        match[2],
        /class/.test(match[1]) ? 'class' : 'function',
        match.index,
      );
    } else if (match[4] !== undefined) {
      push(match[4], 'type', match.index);
    } else if (match[5] !== undefined) {
      push(match[5], 'type', match.index);
    }
  }
  while ((match = variableRe.exec(code)) !== null) {
    // Find the declarator list: scan to the top-level `;`.
    let depth = 0;
    let end = -1;
    for (let i = match.index + match[0].length; i < code.length; i += 1) {
      const char = code[i];
      if (char === '(' || char === '[' || char === '{') depth += 1;
      else if (char === ')' || char === ']' || char === '}') depth -= 1;
      else if (char === ';' && depth === 0) {
        end = i;
        break;
      }
    }
    if (end === -1) end = code.length;
    const spanEnd = end;
    if (!claimSpan(claimed, match.index, spanEnd)) continue;
    const declarators = splitTopLevel(
      code.slice(match.index + match[0].length, end),
    );
    for (const declarator of declarators) {
      const equals = firstTopLevel(declarator, '=');
      const pattern = equals === -1 ? declarator : declarator.slice(0, equals);
      for (const name of bindingNames(pattern)) {
        push(name, 'variable', match.index);
      }
    }
  }
  while ((match = cjsNamedRe.exec(code)) !== null) {
    if (!claimSpan(claimed, match.index, match.index + match[0].length))
      continue;
    push(match[1], 'cjs', match.index);
  }
  while ((match = cjsObjectRe.exec(code)) !== null) {
    if (!claimSpan(claimed, match.index, match.index + match[0].length))
      continue;
    for (const item of splitTopLevel(match[1])) {
      const key = item.split(':')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(key)) push(key, 'cjs', match.index);
      else {
        const value = stringValue(strings, key);
        if (value !== null) push(value, 'cjs', match.index);
      }
    }
  }
  while ((match = cjsDefaultRe.exec(code)) !== null) {
    if (!claimSpan(claimed, match.index, match.index + match[0].length))
      continue;
    push('default', 'cjs-default', match.index);
  }
  return exports;
}

// Extract imports from stripped `code`. Returns
// `{ imports, sideEffectImports }` where each import is
// `{ specifier, names, kind }`: `names` is a Set of imported names
// or '*' for namespace / whole-module usage; `kind` is one of
// 'import', 'reexport', 'dynamic', 'require'. Side-effect-only
// imports land in `sideEffectImports` as `{ specifier }`.
export function parseImports(code, strings) {
  const imports = [];
  const sideEffectImports = [];
  const dynamicClaimed = [];
  const add = (specifier, names, kind) => {
    if (specifier !== null) imports.push({ specifier, names, kind });
  };

  // Re-exports count as imports of the source module.
  const namespaceReexportRe =
    /export\s+\*\s+as\s+[A-Za-z_$][\w$]*\s+from\s+(__GEVSTR\d+__)/g;
  const starReexportRe = /export\s+\*\s+from\s+(__GEVSTR\d+__)/g;
  const namedReexportRe =
    /export\s+(?:type\s+)?\{([^}]*)\}\s*from\s+(__GEVSTR\d+__)/g;
  let match;
  while ((match = namespaceReexportRe.exec(code)) !== null) {
    add(stringValue(strings, match[1]), '*', 'reexport');
  }
  while ((match = starReexportRe.exec(code)) !== null) {
    add(stringValue(strings, match[1]), '*', 'reexport');
  }
  while ((match = namedReexportRe.exec(code)) !== null) {
    const names = new Set(
      parseBraceList(match[1]).map((entry) => entry.imported),
    );
    add(stringValue(strings, match[2]), names, 'reexport');
  }

  // Static imports. Clause forms: default, `{...}`, `* as ns`,
  // `default, {...}`, `default, * as ns`; or a bare specifier
  // (side-effect import).
  const staticRe =
    /import\s*(?:type\s+)?(?:(__GEVSTR\d+__)|(?:([A-Za-z_$][\w$]*)(?:\s*,\s*(?:(\*\s*as\s+[A-Za-z_$][\w$]*)|(\{[^}]*\}))?)?|(?:(\*\s*as\s+[A-Za-z_$][\w$]*)|(\{[^}]*\})))\s*from\s*(__GEVSTR\d+__))/g;
  while ((match = staticRe.exec(code)) !== null) {
    if (match[1] !== undefined) {
      sideEffectImports.push({
        specifier: stringValue(strings, match[1]),
      });
      continue;
    }
    const specifier = stringValue(strings, match[7]);
    if (match[3] !== undefined || match[5] !== undefined) {
      add(specifier, '*', 'import');
      continue;
    }
    const names = new Set();
    if (match[2] !== undefined) names.add('default');
    const brace = match[4] ?? match[6];
    if (brace !== undefined) {
      for (const entry of parseBraceList(brace.slice(1, -1))) {
        names.add(entry.imported);
      }
    }
    add(specifier, names, 'import');
  }

  // Destructured dynamic import: `const { a, b: c } = await import('x')`.
  const dynamicDestructuredRe =
    /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?import\s*\(\s*(__GEVSTR\d+__)\s*\)/g;
  while ((match = dynamicDestructuredRe.exec(code)) !== null) {
    const specifier = stringValue(strings, match[2]);
    const names = new Set();
    for (const item of splitTopLevel(match[1])) {
      const trimmed = item.trim();
      if (trimmed.startsWith('...')) {
        names.add('*');
        continue;
      }
      const colon = firstTopLevel(trimmed, ':');
      const equals = firstTopLevel(trimmed, '=');
      const head =
        colon !== -1
          ? trimmed.slice(0, colon)
          : equals !== -1
            ? trimmed.slice(0, equals)
            : trimmed;
      const name = head.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
    if (names.has('*')) add(specifier, '*', 'dynamic');
    else add(specifier, names, 'dynamic');
    dynamicClaimed.push([match.index, match.index + match[0].length]);
  }
  // Namespace dynamic import: `const mod = await import('x')`.
  const dynamicAssignedRe =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?import\s*\(\s*(__GEVSTR\d+__)\s*\)/g;
  while ((match = dynamicAssignedRe.exec(code)) !== null) {
    add(stringValue(strings, match[2]), '*', 'dynamic');
    dynamicClaimed.push([match.index, match.index + match[0].length]);
  }
  // Bare dynamic import: `await import('x')` — whole-module usage.
  const dynamicBareRe = /(?<![\w$.])import\s*\(\s*(__GEVSTR\d+__)\s*\)/g;
  while ((match = dynamicBareRe.exec(code)) !== null) {
    const overlapped = dynamicClaimed.some(
      ([from, to]) => match.index < to && match.index + match[0].length > from,
    );
    if (overlapped) continue;
    add(stringValue(strings, match[1]), '*', 'dynamic');
  }

  // `require('x')` (CJS): destructured, assigned, or bare.
  const requireClaimed = [];
  const requireDestructuredRe =
    /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*(__GEVSTR\d+__)\s*\)/g;
  while ((match = requireDestructuredRe.exec(code)) !== null) {
    const names = new Set();
    for (const item of splitTopLevel(match[1])) {
      const trimmed = item.trim();
      if (trimmed.startsWith('...')) {
        names.add('*');
        continue;
      }
      const colon = firstTopLevel(trimmed, ':');
      const head =
        colon !== -1 ? trimmed.slice(0, colon) : trimmed.split('=')[0];
      const name = head.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
    if (names.has('*')) add(stringValue(strings, match[2]), '*', 'require');
    else add(stringValue(strings, match[2]), names, 'require');
    requireClaimed.push([match.index, match.index + match[0].length]);
  }
  const requireBareRe = /(?<![\w$.])require\s*\(\s*(__GEVSTR\d+__)\s*\)/g;
  while ((match = requireBareRe.exec(code)) !== null) {
    const overlapped = requireClaimed.some(
      ([from, to]) => match.index < to && match.index + match[0].length > from,
    );
    if (overlapped) continue;
    add(stringValue(strings, match[1]), '*', 'require');
  }
  return { imports, sideEffectImports };
}

export function isTestFile(file) {
  return (
    file.startsWith('tests/') ||
    file.startsWith('src/testSupport/') ||
    /\.test\.[mc]?[jt]sx?$/.test(file) ||
    /\.spec\.[mc]?[jt]sx?$/.test(file)
  );
}

export async function discoverSourceFiles(root) {
  const found = [];
  const walk = async (dir, prefix) => {
    let entries;
    try {
      entries = await readdir(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(relative, relative);
      } else if (entry.isFile()) {
        if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
          found.push(relative);
        }
      }
    }
  };
  for (const scanRoot of SCAN_ROOTS) {
    await walk(scanRoot, scanRoot);
  }
  // Root-level JS files (vite.config.js, playwright.config.mjs, ...).
  // Non-recursive on purpose: worktree dirs (wt-*) must not leak in.
  let rootEntries = [];
  try {
    rootEntries = await readdir(root, { withFileTypes: true });
  } catch {
    rootEntries = [];
  }
  for (const entry of rootEntries) {
    if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      found.push(entry.name);
    }
  }
  return [...new Set(found)].sort();
}

// Resolve an import specifier from `fromFile` to a scanned file
// (root-relative), or null when it is external / unresolvable /
// not a JS-family module. `fileSet` is the set of scanned files;
// `packageName` / `packageExports` serve self-references.
export function resolveSpecifier(
  fromFile,
  specifier,
  { fileSet, packageName = null, packageExports = {} } = {},
) {
  if (typeof specifier !== 'string' || specifier.length === 0) return null;
  if (specifier.startsWith('node:')) return null;
  if (
    packageName &&
    (specifier === packageName || specifier.startsWith(`${packageName}/`))
  ) {
    const rest =
      specifier === packageName ? '' : specifier.slice(packageName.length + 1);
    const key = rest === '' ? '.' : `./${rest}`;
    const target = packageExports[key];
    const value =
      typeof target === 'string'
        ? target
        : (target?.node ?? target?.default ?? null);
    if (typeof value !== 'string') return null;
    const candidate = value.replace(/^\.\//, '');
    return fileSet.has(candidate) ? candidate : null;
  }
  if (!specifier.startsWith('.')) return null;
  const fromDir = path.posix.dirname(fromFile);
  const joined = path.posix.normalize(path.posix.join(fromDir, specifier));
  const candidates = [joined];
  for (const ext of SCAN_EXTENSIONS) candidates.push(`${joined}${ext}`);
  for (const ext of SCAN_EXTENSIONS) {
    candidates.push(path.posix.join(joined, `index${ext}`));
  }
  // `./foo.js` may point at a `./foo.ts` source in TS layouts.
  if (joined.endsWith('.js')) {
    candidates.push(`${joined.slice(0, -3)}.ts`);
  }
  for (const candidate of candidates) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

// Public-API files: every package.json `exports` target.
export function publicFilesFromExports(packageExports = {}) {
  const files = new Set();
  for (const target of Object.values(packageExports)) {
    const value =
      typeof target === 'string'
        ? target
        : (target?.node ?? target?.default ?? null);
    if (typeof value === 'string') files.add(value.replace(/^\.\//, ''));
  }
  return files;
}

// Analyze parsed files. `readFile` maps a root-relative file to its
// source text. Returns per-file results:
// `{ file, exports, imports, sideEffectImports, usages }` where
// `usages` maps export name -> sorted importer files.
export async function analyzeFiles(
  files,
  {
    readFile,
    packageName = null,
    packageExports = {},
    publicFiles = new Set(),
  } = {},
) {
  const fileSet = new Set(files);
  const parsed = [];
  for (const file of files) {
    const source = await readFile(file);
    const { code, strings } = stripCommentsAndStrings(source);
    const exports = isTestFile(file) ? [] : parseExports(code, strings);
    const { imports, sideEffectImports } = parseImports(code, strings);
    parsed.push({ file, exports, imports, sideEffectImports });
  }
  const byFile = new Map(parsed.map((entry) => [entry.file, entry]));
  const usageMap = new Map(); // `${target}\0${name}` -> Set(importers)
  const sideEffectMap = new Map(); // target -> Set(importers)
  const noteUsage = (target, name, importer) => {
    if (target === importer) return; // self-imports do not count
    const key = `${target}\0${name}`;
    if (!usageMap.has(key)) usageMap.set(key, new Set());
    usageMap.get(key).add(importer);
  };
  for (const entry of parsed) {
    for (const imported of entry.imports) {
      const target = resolveSpecifier(entry.file, imported.specifier, {
        fileSet,
        packageName,
        packageExports,
      });
      if (target === null) continue;
      const targetEntry = byFile.get(target);
      if (!targetEntry) continue;
      if (imported.names === '*') {
        for (const exported of targetEntry.exports) {
          noteUsage(target, exported.name, entry.file);
        }
      } else {
        for (const name of imported.names) {
          noteUsage(target, name, entry.file);
        }
      }
    }
    for (const sideEffect of entry.sideEffectImports) {
      const target = resolveSpecifier(entry.file, sideEffect.specifier, {
        fileSet,
        packageName,
        packageExports,
      });
      if (target === null) continue;
      if (!sideEffectMap.has(target)) sideEffectMap.set(target, new Set());
      if (target !== entry.file) sideEffectMap.get(target).add(entry.file);
    }
  }
  return parsed.map((entry) => {
    const usages = {};
    for (const exported of entry.exports) {
      const importers = usageMap.get(`${entry.file}\0${exported.name}`);
      usages[exported.name] = importers ? [...importers].sort() : [];
    }
    return {
      file: entry.file,
      exports: entry.exports,
      imports: entry.imports,
      sideEffectImports: entry.sideEffectImports,
      usages,
      sideEffectImporters: sideEffectMap.has(entry.file)
        ? [...sideEffectMap.get(entry.file)].sort()
        : [],
      public: publicFiles.has(entry.file),
    };
  });
}

// Unused entries: `{ file, name, kind, line, importers, importerFiles,
// testOnly, public }`. `importers` is the distinct-importer count.
export function findUnused(results, { includePublic = false } = {}) {
  const unused = [];
  for (const result of results) {
    for (const exported of result.exports) {
      const importerFiles = result.usages[exported.name] ?? [];
      const testOnly =
        importerFiles.length > 0 &&
        importerFiles.every((file) => isTestFile(file));
      if (importerFiles.length > 0) continue;
      if (result.public && !includePublic) continue;
      unused.push({
        file: result.file,
        name: exported.name,
        kind: exported.kind,
        line: exported.line,
        importers: 0,
        importerFiles: [],
        testOnly: false,
        public: result.public,
      });
    }
  }
  return unused.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
  );
}

export function summarizeResults(results, { unused } = {}) {
  let exportsTotal = 0;
  let used = 0;
  let testOnly = 0;
  let publicUnused = 0;
  for (const result of results) {
    for (const exported of result.exports) {
      exportsTotal += 1;
      const importerFiles = result.usages[exported.name] ?? [];
      if (importerFiles.length === 0) {
        if (result.public) publicUnused += 1;
      } else if (importerFiles.every((file) => isTestFile(file))) {
        testOnly += 1;
      } else {
        used += 1;
      }
    }
  }
  return {
    filesScanned: results.length,
    filesWithExports: results.filter((result) => result.exports.length > 0)
      .length,
    exportsTotal,
    unused: unused?.length ?? 0,
    used,
    testOnly,
    public: results
      .filter((result) => result.public)
      .reduce((sum, result) => sum + result.exports.length, 0),
    publicUnused,
  };
}

// Group unused entries by file, ranked by unused count desc,
// then file asc.
export function groupByFile(unused) {
  const byFile = new Map();
  for (const entry of unused) {
    if (!byFile.has(entry.file)) byFile.set(entry.file, []);
    byFile.get(entry.file).push(entry);
  }
  return [...byFile.entries()]
    .map(([file, entries]) => ({
      file,
      unusedCount: entries.length,
      unused: entries,
    }))
    .sort((a, b) =>
      b.unusedCount === a.unusedCount
        ? a.file < b.file
          ? -1
          : 1
        : b.unusedCount - a.unusedCount,
    );
}

export function filterByFiles(unused, files) {
  if (!files || files.length === 0) return unused;
  const wanted = new Set(files);
  return unused.filter((entry) => wanted.has(entry.file));
}

export function limitFindings(groups, limit) {
  if (limit === 0) return groups;
  return groups.slice(0, limit);
}

export function formatUnusedExportReport({ summary, ranked }, limit) {
  const lines = [
    'Unused-export scoreboard (src + server + scripts + tests + build + root configs; test files excluded as exporters)',
    `Files scanned: ${summary.filesScanned} · files with exports: ${summary.filesWithExports} · exports: ${summary.exportsTotal} · unused: ${summary.unused} · used: ${summary.used} · test-only: ${summary.testOnly} · public API: ${summary.public} (${summary.publicUnused} unused-but-public)`,
    '',
  ];
  if (ranked.length === 0) {
    lines.push('No unused exports found.');
    return lines.join('\n');
  }
  lines.push(
    `Top files by unused exports${limit === 0 ? ' (all)' : ` (limit ${limit})`}:`,
  );
  for (const group of ranked) {
    lines.push(`${group.file} — ${group.unusedCount} unused`);
    for (const entry of group.unused) {
      lines.push(
        `  ${entry.name} (${entry.kind}, line ${entry.line})${entry.public ? ' [public API]' : ''}`,
      );
    }
  }
  lines.push('');
  lines.push(
    'Report-only: verify an entry before deleting it — computed imports, HTML/worker entry points, and barrel re-exports can hide real usage.',
  );
  return lines.join('\n');
}

export function parseCliArgs(argv) {
  const args = {
    json: false,
    limit: DEFAULT_LIMIT,
    includePublic: false,
    files: [],
    help: false,
    error: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--include-public') args.includePublic = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--limit') {
      const value = argv[i + 1];
      if (value === undefined || !/^\d+$/.test(value)) {
        args.error = '--limit requires a non-negative integer';
        return args;
      }
      args.limit = Number(value);
      i += 1;
    } else if (arg.startsWith('--limit=')) {
      const value = arg.slice('--limit='.length);
      if (!/^\d+$/.test(value)) {
        args.error = '--limit requires a non-negative integer';
        return args;
      }
      args.limit = Number(value);
    } else if (arg.startsWith('-')) {
      args.error = `unknown flag: ${arg}`;
      return args;
    } else {
      args.files.push(arg);
    }
  }
  return args;
}
