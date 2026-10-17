// Test-hygiene scoreboard: silent-green risks in the unit suite.
//
// A green suite can hide untested behaviour. This scanner reports the four
// static signals that make a passing run weaker than it looks:
//
// - `only` — `test.only` / `it.only` / `describe.only` / `{ only: true }`.
//   Under plain `node --test` (what `npm test` runs) `.only` is inert, but
//   under `node --test-only` it silently narrows the run to the marked
//   tests — verified by probe: the unmarked tests do not even count as
//   skipped (skipped 0, exit 0). Nothing in the repo guarded this.
// - `skip` — `t.skip`, `test.skip`, `describe.skip`, `{ skip: ... }`.
//   Intentional skips exist (win32-conditional bash tests, Node-24-only
//   allocation budgets), so skips are reported, never strict-failed.
// - `todo` — `test.todo(...)`: a placeholder that passes without testing.
// - `empty` — a test whose callback body is empty (`() => {}`) or missing:
//   it cannot fail, so it passes vacuously.
// - `duplicate` — the same test name twice in one file: TAP failure
//   attribution becomes ambiguous.
//
// The scanner is static (no test execution) and comment/string/regex aware:
// patterns inside comments, string literals, and regex literals are not
// findings. Template-literal interpolations are treated as string content,
// so a `test(` call inside `${...}` is not seen (documented limitation).

export const HYGIENE_KINDS = Object.freeze([
  'only',
  'skip',
  'todo',
  'empty',
  'duplicate',
]);

// Kinds that fail `--strict`. Skips and todos can be intentional, so they
// are report-only; the other three are never intentional in a committed
// suite.
export const STRICT_KINDS = Object.freeze(['only', 'empty', 'duplicate']);

const MODIFIER_RE = /\b(test|it|describe)\s*\.\s*(only|skip|todo)\b/g;
const T_SKIP_RE = /\bt\s*\.\s*skip\s*\(/g;
const CALL_RE = /\b(test|it|describe)\s*\(/g;

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

function isWordChar(char) {
  return char === '_' || char === '$' || /[A-Za-z0-9]/.test(char);
}

function previousWord(chars, index) {
  let end = index;
  while (end > 0 && /\s/.test(chars[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && isWordChar(chars[start - 1])) start -= 1;
  return chars.slice(start, end).join('');
}

// Mask comments and the interiors of strings and regex literals to spaces
// (newlines kept, delimiters preserved) so pattern matching only sees real
// code. Returns the masked code plus the string tokens, for recovering
// test names from the original source.
//
// The scanner is a small recursive tokenizer: template `${...}`
// interpolations are scanned as code (so nested templates and strings
// inside them cannot desync the mask), and regex character classes
// (`[/]`) do not terminate the literal. `chars` uses `split('')` —
// UTF-16 code units, index-aligned with `source` — never `[...source]`,
// whose code-point iteration shifts every index after an astral
// character (emoji) and silently corrupts all later masking.
function maskNonCode(source) {
  // Index-aligned with `source`: never [...source] (see note above).
  const chars = source.split('');
  const strings = [];
  const blank = (from, to) => {
    for (let i = from; i < to; i += 1) {
      if (chars[i] !== '\n') chars[i] = ' ';
    }
  };

  const scanString = (start, quote) => {
    let j = start + 1;
    let value = '';
    while (j < source.length) {
      if (source[j] === '\\') {
        value += source.slice(j, j + 2);
        j += 2;
        continue;
      }
      if (source[j] === quote) break;
      value += source[j];
      j += 1;
    }
    const stop = j < source.length ? j + 1 : source.length;
    strings.push({
      start,
      end: stop,
      value: decodeStringContent(value),
      isTemplate: false,
      hasInterpolation: false,
    });
    blank(start + 1, stop - 1);
    return stop;
  };

  const scanRegex = (start) => {
    let j = start + 1;
    let inClass = false;
    while (j < source.length) {
      if (source[j] === '\\') {
        j += 2;
        continue;
      }
      if (source[j] === '\n') break;
      if (source[j] === '[') inClass = true;
      else if (source[j] === ']') inClass = false;
      else if (source[j] === '/' && !inClass) break;
      j += 1;
    }
    let stop = j < source.length && source[j] === '/' ? j + 1 : j;
    while (stop < source.length && /[a-z]/i.test(source[stop])) stop += 1;
    blank(start + 1, stop - 1);
    return stop;
  };

  const isRegexPosition = (index) => {
    const prev = previousSignificantChar(chars, index);
    const prevWord = previousWord(chars, index);
    return (
      prev === '' ||
      '([=:[!&|?{};+-*%<>^~,'.includes(prev) ||
      [
        'return',
        'typeof',
        'case',
        'delete',
        'void',
        'in',
        'of',
        'new',
        'throw',
        'yield',
        'await',
      ].includes(prevWord)
    );
  };

  // Scan code starting at `index`. When `inInterpolation` is true, stop
  // after the `}` that closes the interpolation (braces nest). Returns
  // the index to resume from.
  const scanCode = (index, inInterpolation) => {
    let i = index;
    let depth = 0;
    while (i < source.length) {
      const char = source[i];
      const next = source[i + 1] ?? '';
      if (char === '/' && next === '/') {
        const end = source.indexOf('\n', i);
        const stop = end === -1 ? source.length : end;
        blank(i, stop);
        i = stop;
        continue;
      }
      if (char === '/' && next === '*') {
        const end = source.indexOf('*/', i + 2);
        const stop = end === -1 ? source.length : end + 2;
        blank(i, stop);
        i = stop;
        continue;
      }
      if (char === "'" || char === '"') {
        i = scanString(i, char);
        continue;
      }
      if (char === '`') {
        i = scanTemplate(i);
        continue;
      }
      if (char === '/' && isRegexPosition(i)) {
        i = scanRegex(i);
        continue;
      }
      if (inInterpolation) {
        if (char === '{') depth += 1;
        else if (char === '}') {
          if (depth === 0) return i + 1;
          depth -= 1;
        }
      }
      i += 1;
    }
    return i;
  };

  // Scan a template literal starting at `index` (the opening backtick).
  // Interpolations are scanned as code, so nested templates, strings,
  // and braces inside `${...}` cannot desync the mask.
  const scanTemplate = (start) => {
    let j = start + 1;
    let hasInterpolation = false;
    let value = '';
    while (j < source.length) {
      if (source[j] === '\\') {
        value += source.slice(j, j + 2);
        j += 2;
        continue;
      }
      if (source[j] === '`') {
        const stop = j + 1;
        strings.push({
          start,
          end: stop,
          value,
          isTemplate: true,
          hasInterpolation,
        });
        blank(start + 1, stop - 1);
        return stop;
      }
      if (source[j] === '$' && source[j + 1] === '{') {
        hasInterpolation = true;
        // The interpolation code stays unmasked (it is real code); only
        // the `${` / `}` markers are part of the template text.
        j = scanCode(j + 2, true);
        continue;
      }
      value += source[j];
      j += 1;
    }
    strings.push({
      start,
      end: source.length,
      value,
      isTemplate: true,
      hasInterpolation,
    });
    blank(start + 1, source.length);
    return source.length;
  };

  scanCode(0, false);
  return { code: chars.join(''), strings };
}

function previousSignificantChar(chars, index) {
  let i = index - 1;
  while (i >= 0 && /\s/.test(chars[i])) i -= 1;
  return i < 0 ? '' : chars[i];
}

function decodeStringContent(raw) {
  return raw.replace(
    /\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g,
    (match, esc) => {
      if (esc === 'n') return '\n';
      if (esc === 't') return '\t';
      if (esc === 'r') return '\r';
      if (esc === 'b') return '\b';
      if (esc === 'f') return '\f';
      if (esc === 'v') return '\v';
      if (esc === '0') return '\0';
      if (esc.startsWith('u{'))
        return String.fromCodePoint(Number.parseInt(esc.slice(2, -1), 16));
      if (esc.startsWith('u'))
        return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
      if (esc.startsWith('x'))
        return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
      return esc;
    },
  );
}

// Split a call's argument list (masked code, `openParen` points at `(`)
// into top-level arguments. Returns null on unbalanced input.
function splitArgs(code, openParen) {
  const args = [];
  let depth = 0;
  let start = openParen + 1;
  let i = openParen + 1;
  while (i < code.length) {
    const char = code[i];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) {
        args.push({ start, end: i, text: code.slice(start, i) });
        return { args, end: i };
      }
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      args.push({ start, end: i, text: code.slice(start, i) });
      start = i + 1;
    }
    i += 1;
  }
  return null;
}

// Match a `{...}` block starting at `openBrace`; returns the inner text.
function matchBraces(code, openBrace) {
  let depth = 0;
  for (let i = openBrace; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(openBrace + 1, i);
    }
  }
  return null;
}

// Recover a static test name from an argument: the string token covering
// it in the original source, or null for dynamic/non-string names.
function staticName(strings, arg) {
  if (!arg) return null;
  const trimmed = arg.text.trim();
  if (
    !trimmed.startsWith("'") &&
    !trimmed.startsWith('"') &&
    !trimmed.startsWith('`')
  ) {
    return null;
  }
  const token = strings.find(
    (candidate) => candidate.start >= arg.start && candidate.end <= arg.end,
  );
  if (!token || token.hasInterpolation) return null;
  return token.value;
}

function isFunctionLike(text) {
  const trimmed = text.trim();
  return (
    trimmed.startsWith('(') ||
    trimmed.startsWith('async') ||
    trimmed.startsWith('function') ||
    /=>/.test(trimmed)
  );
}

function isBareIdentifier(text) {
  return /^[A-Za-z_$][\w$]*$/.test(text.trim());
}

// Whether a callback argument's body is empty: `() => {}`, `async (t) => {}`,
// `function (t) {}` with nothing but whitespace/comments inside.
function isEmptyCallback(code, arg) {
  const text = arg.text;
  const arrow = text.indexOf('=>');
  const fn = text.search(/\bfunction\b/);
  let bodyStart = -1;
  if (arrow !== -1 && (fn === -1 || arrow < fn)) {
    bodyStart = arg.start + arrow + 2;
  } else if (fn !== -1) {
    const params = code.indexOf('(', arg.start + fn);
    if (params === -1) return false;
    const closed = splitArgs(code, params);
    if (!closed) return false;
    bodyStart = closed.end + 1;
  } else {
    return false;
  }
  let i = bodyStart;
  while (i < code.length && /\s/.test(code[i])) i += 1;
  if (code[i] !== '{') return false;
  const inner = matchBraces(code, i);
  return inner !== null && inner.trim() === '';
}

// Top-level option keys (`skip` / `only` / `todo`) in an options-object
// argument, e.g. `test('name', { skip: cond }, fn)`. Nested objects are
// ignored, so `{ config: { skip: true } }` is not a finding.
function optionsKeys(arg) {
  const keys = [];
  const text = arg.text;
  const open = text.indexOf('{');
  if (open === -1) return keys;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) break;
    } else if (depth === 1) {
      // Word-boundary guard: `{ lonely: 1 }` must not read as `only`.
      const match =
        (i === 0 || !isWordChar(text[i - 1])) &&
        /^(skip|only|todo)\s*(:|,|})/.exec(text.slice(i));
      if (match) {
        keys.push(match[1]);
        i += match[0].length - 1;
      }
    }
  }
  return keys;
}

/** Scan one test file's source for hygiene findings. */
export function scanTestFile(source, file = '(unknown)') {
  const { code, strings } = maskNonCode(source);
  const lineStarts = lineStartsOf(source);
  const findings = [];
  const names = new Map(); // name -> [lines]

  const recordName = (name, offset) => {
    if (name === null) return;
    const line = lineAt(lineStarts, offset);
    if (!names.has(name)) names.set(name, []);
    names.get(name).push(line);
  };

  const calls = [];
  for (const match of code.matchAll(CALL_RE)) {
    // `<receiver>.test(` is a method call, not the test runner — except
    // `t.test(` / `t.it(`, the TestContext subtest API. A receiver word
    // ending in `t` (e.g. `result.test(`) is still rejected: the char
    // before the receiver word must not be a word char or `.`.
    const prev = match.index > 0 ? code[match.index - 1] : '';
    if (prev === '.') {
      let end = match.index - 1;
      let start = end;
      while (start > 0 && isWordChar(code[start - 1])) start -= 1;
      const receiver = code.slice(start, end);
      const before = start > 0 ? code[start - 1] : '';
      if (receiver !== 't' || before === '.' || isWordChar(before)) continue;
    }
    calls.push({ offset: match.index + match[0].length - 1, kind: match[1] });
  }
  for (const match of code.matchAll(MODIFIER_RE)) {
    // `x.test.skip` is a property chain, not the test-runner API.
    const prev = match.index > 0 ? code[match.index - 1] : '';
    if (prev === '.' || isWordChar(prev)) continue;
    calls.push({
      offset: match.index + match[0].length,
      kind: match[1],
      modifier: match[2],
    });
  }

  for (const call of calls) {
    if (call.modifier) {
      // Only a `(` immediately after the modifier belongs to this call;
      // the alias form (`const bashTest = cond ? test.skip : test`) has
      // none, and grabbing a later `(` would attribute the wrong name.
      const after = code.slice(call.offset);
      const leadingWhitespace = /^\s*/.exec(after)[0].length;
      let name = null;
      if (after[leadingWhitespace] === '(') {
        const split = splitArgs(code, call.offset + leadingWhitespace);
        if (split) name = staticName(strings, split.args[0]);
      }
      findings.push({
        file,
        line: lineAt(lineStarts, call.offset),
        kind: call.modifier,
        name,
        detail: name
          ? `${call.kind}.${call.modifier}('${name}')`
          : `${call.kind}.${call.modifier} (conditional/alias form)`,
      });
      recordName(name, call.offset);
      continue;
    }
    const split = splitArgs(code, call.offset);
    if (!split) continue;
    const [nameArg, ...rest] = split.args;
    const name = staticName(strings, nameArg);
    recordName(name, call.offset);
    const optionsArg = rest.find((arg) => arg.text.trimStart().startsWith('{'));
    if (optionsArg) {
      for (const key of optionsKeys(optionsArg)) {
        findings.push({
          file,
          line: lineAt(lineStarts, call.offset),
          kind: key,
          name,
          detail: name
            ? `${call.kind}('${name}', { ${key}: ... })`
            : `${call.kind}(..., { ${key}: ... })`,
        });
      }
    }
    const fnArg = rest.find((arg) => isFunctionLike(arg.text));
    const hasCallback =
      fnArg !== undefined || rest.some((arg) => isBareIdentifier(arg.text));
    if (!hasCallback) {
      findings.push({
        file,
        line: lineAt(lineStarts, call.offset),
        kind: 'empty',
        name,
        detail: name
          ? `${call.kind}('${name}') has no callback`
          : `${call.kind}(...) has no callback`,
      });
    } else if (fnArg && isEmptyCallback(code, fnArg)) {
      findings.push({
        file,
        line: lineAt(lineStarts, call.offset),
        kind: 'empty',
        name,
        detail: name
          ? `${call.kind}('${name}') has an empty callback body`
          : `${call.kind}(...) has an empty callback body`,
      });
    }
  }

  for (const match of code.matchAll(T_SKIP_RE)) {
    // `x.t.skip(` is a property chain, not the TestContext API.
    const prev = match.index > 0 ? code[match.index - 1] : '';
    if (prev === '.' || isWordChar(prev)) continue;
    findings.push({
      file,
      line: lineAt(lineStarts, match.index),
      kind: 'skip',
      name: null,
      detail: 't.skip(...)',
    });
  }

  for (const [name, lines] of names) {
    if (lines.length > 1) {
      findings.push({
        file,
        line: lines[0],
        kind: 'duplicate',
        name,
        detail: `'${name}' occurs ${lines.length} times (lines ${lines.join(', ')})`,
      });
    }
  }

  return findings.sort(
    (a, b) => a.line - b.line || a.kind.localeCompare(b.kind),
  );
}

/** Scan many files: entries are `{ file, source }`. */
export function scanTestFiles(entries) {
  return entries.flatMap((entry) => scanTestFile(entry.source, entry.file));
}

/** Aggregate findings into totals, per-kind counts, and strict failures. */
export function summarizeTestHygiene(findings) {
  const byKind = Object.fromEntries(HYGIENE_KINDS.map((kind) => [kind, 0]));
  for (const finding of findings) {
    if (finding.kind in byKind) byKind[finding.kind] += 1;
  }
  const strict = findings.filter((finding) =>
    STRICT_KINDS.includes(finding.kind),
  );
  return {
    total: findings.length,
    byKind,
    files: [...new Set(findings.map((finding) => finding.file))].sort(),
    strictViolations: strict.length,
    strict,
  };
}

/** Whether findings contain anything that fails `--strict`. */
export function hasStrictViolation(findings) {
  return findings.some((finding) => STRICT_KINDS.includes(finding.kind));
}

/** Human-readable report lines for the CLI. */
export function formatTestHygieneReport(
  findings,
  summary = summarizeTestHygiene(findings),
) {
  const lines = findings.map(
    (finding) =>
      `${finding.file}:${finding.line} [${finding.kind}] ${finding.detail}`,
  );
  lines.push(
    `total=${summary.total} ` +
      HYGIENE_KINDS.map((kind) => `${kind}=${summary.byKind[kind]}`).join(' ') +
      ` strictViolations=${summary.strictViolations}`,
  );
  return lines.join('\n');
}
