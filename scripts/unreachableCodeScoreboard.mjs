// Unreachable-code scoreboard: report statements that can never
// run — statements after a terminator (`return` / `throw` /
// `break` / `continue`) in the same block, and branches guarded by
// a constant condition (`if (false)`, `if (true) ... else`,
// `while (false)`, `for (; false ;)`).
//
// Report-only: nothing is deleted or gated. A finding means
// "this statement is unreachable by the scanner's rules", not
// "safe to delete" — see the limits.
//
// Rules:
// - After-terminator: within one brace block (or the top level),
//   once a bare `return` / `throw` / `break` / `continue`
//   statement is seen, every later statement in that block is
//   reported, until a `case:` / `default:` label (switch dispatch
//   re-enters the block) or the block ends.
// - An `if` / `while` / `for` statement whose own terminators
//   live in a nested block does NOT terminate the outer block:
//   `if (x) { return 1; } foo();` leaves `foo()` reachable.
//   Only a bare terminator statement terminates its block.
// - Constant-condition: the condition must be exactly a boolean
//   literal, an optional run of `!` in front of one, or one
//   parenthesised layer around either. `if (false)` reports its
//   then-branch; `if (true)` reports its else-branch (if any);
//   `while (false)` / `for (; false ;)` report the loop body.
//   `do ... while (false)` is NOT reported: the body runs once.
// - Statements are found by a token-level block parser over
//   masked source (comments / strings / regexes blanked, newlines
//   preserved). Nested `{...}` groups (blocks, method bodies,
//   arrow bodies, class bodies, object-literal methods) are
//   recursed into, so dead code inside a nested function is
//   reported against its own block, not the outer one.
//
// Documented limits (read before deleting anything this flags):
// - Semicolon-free (ASI) code: a statement without a `;` may be
//   merged with the next line, so a finding after it can be
//   MISSED. This scanner favours no false positives over
//   completeness; run prettier first if a file looks odd.
// - `if (x) { return 1; } else { return 2; } foo();` is NOT
//   reported: both-branches-terminate analysis is out of scope.
//   Likewise `try` / `catch` / `finally` never terminate the
//   code after them, even when every path returns.
// - Only exact boolean-literal conditions are recognised:
//   `if (0)`, `if (x && false)`, `if (DEBUG)` (even when
//   `DEBUG` is a constant) and ternaries are NOT reported.
// - `break` / `continue` with a label, and code after an
//   infinite loop (`while (true) {}` with no `break`), are NOT
//   reported: label-target and loop-exit analysis are out of
//   scope.
// - TypeScript-only syntax (enums, `declare`, decorators) is
//   parsed best-effort; a construct the parser cannot follow is
//   skipped, never reported.
// - The scanner trusts masked source: a `return` spelled inside
//   a string, comment, or regex is invisible, and a division
//   `/` misread as a regex start (or vice versa) can shift
//   token boundaries. The regex heuristic matches the one used
//   by the other scoreboard tools (previous-token based).

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
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '^',
  '~',
  '=>',
  '...',
]);

function isWordChar(char) {
  return char === '_' || char === '$' || /[A-Za-z0-9]/.test(char);
}

const OPERATORS = new Set([
  '===',
  '!==',
  '>>>',
  '**=',
  '<<=',
  '>>=',
  '&&=',
  '||=',
  '??=',
  '...',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '?.',
  '=>',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<',
  '>>',
  '**',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ';',
  ',',
  ':',
  '.',
  '?',
  '!',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '=',
  '&',
  '|',
  '^',
  '~',
]);

function isOperatorPrefix(text) {
  for (const op of OPERATORS) {
    if (op.startsWith(text)) return true;
  }
  return false;
}

// Blank comments, string/template/regex contents (preserving
// newlines, so line numbers still line up). Template `${...}`
// code is kept: it is real code. Same-length output.
export function maskSource(source) {
  const out = source.split('');
  const blank = (index) => {
    if (out[index] !== '\n') out[index] = ' ';
  };
  // Frame stack: { type: 'code', braceDepth } |
  // { type: 'template' } | { type: 'string', quote } |
  // { type: 'comment', line: boolean } | { type: 'regex', inClass }
  const stack = [{ type: 'code', braceDepth: 0 }];
  const top = () => stack[stack.length - 1];
  // Previous significant token in code: { kind: 'ident'|'num'|
  // 'punct', text } | null. Drives the regex-vs-division call.
  let prevKind = null;
  let prevText = null;
  let word = '';
  let adjacentPunct = false;
  const flushWord = () => {
    if (word !== '') {
      prevKind = /[0-9]/.test(word[0]) ? 'num' : 'ident';
      prevText = word;
      word = '';
      // A word breaks a punctuation run (`++` vs `+ +`).
      adjacentPunct = false;
    }
    // With no word pending, leave adjacentPunct alone: the
    // caller decides whether the gap breaks the run (a space
    // does; a comment between two `+`s does not matter here).
  };
  const markPunct = (char) => {
    if (
      adjacentPunct &&
      prevKind === 'punct' &&
      isOperatorPrefix(prevText + char)
    ) {
      prevText += char;
    } else {
      prevKind = 'punct';
      prevText = char;
    }
    adjacentPunct = true;
  };
  const regexAllowed = () => {
    if (prevKind === null) return true;
    if (prevKind === 'ident') return REGEX_KEYWORDS.has(prevText);
    if (prevKind === 'punct') return REGEX_PUNCTUATORS.has(prevText);
    return false;
  };

  let i = 0;
  while (i < source.length) {
    const frame = top();
    const char = source[i];

    if (frame.type === 'comment') {
      if (frame.line) {
        if (char === '\n') {
          stack.pop();
          i += 1;
        } else {
          blank(i);
          i += 1;
        }
      } else if (char === '*' && source[i + 1] === '/') {
        blank(i);
        blank(i + 1);
        stack.pop();
        i += 2;
      } else {
        blank(i);
        i += 1;
      }
      continue;
    }

    if (frame.type === 'string') {
      if (char === '\\') {
        blank(i);
        if (i + 1 < source.length) blank(i + 1);
        i += 2;
        continue;
      }
      if (char === frame.quote) {
        blank(i);
        stack.pop();
        prevKind = 'ident';
        prevText = '__literal__';
        adjacentPunct = false;
        i += 1;
        continue;
      }
      blank(i);
      i += 1;
      continue;
    }

    if (frame.type === 'regex') {
      if (char === '\\') {
        blank(i);
        if (i + 1 < source.length) blank(i + 1);
        i += 2;
        continue;
      }
      if (char === '[') frame.inClass = true;
      if (char === ']') frame.inClass = false;
      if (char === '/' && !frame.inClass) {
        blank(i);
        i += 1;
        while (i < source.length && /[a-z]/i.test(source[i])) {
          blank(i);
          i += 1;
        }
        stack.pop();
        prevKind = 'ident';
        prevText = '__literal__';
        adjacentPunct = false;
        continue;
      }
      blank(i);
      i += 1;
      continue;
    }

    if (frame.type === 'template') {
      if (char === '\\') {
        blank(i);
        if (i + 1 < source.length) blank(i + 1);
        i += 2;
        continue;
      }
      if (char === '`') {
        blank(i);
        stack.pop();
        prevKind = 'ident';
        prevText = '__literal__';
        adjacentPunct = false;
        i += 1;
        continue;
      }
      if (char === '$' && source[i + 1] === '{') {
        blank(i);
        // Keep the `{`: the token stream must stay brace-balanced
        // — the matching `}` (kept on template-expr exit) closes
        // it. Blanking `${` outright leaves an unmatched `}` that
        // makes brace matching close the enclosing block early.
        stack.push({ type: 'code', braceDepth: 0 });
        prevKind = null;
        prevText = null;
        word = '';
        adjacentPunct = false;
        i += 2;
        continue;
      }
      blank(i);
      i += 1;
      continue;
    }

    // frame.type === 'code'
    if (char === '/' && source[i + 1] === '/') {
      flushWord();
      blank(i);
      blank(i + 1);
      stack.push({ type: 'comment', line: true });
      i += 2;
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      flushWord();
      blank(i);
      blank(i + 1);
      stack.push({ type: 'comment', line: false });
      i += 2;
      continue;
    }
    if (char === "'" || char === '"') {
      flushWord();
      blank(i);
      stack.push({ type: 'string', quote: char });
      i += 1;
      continue;
    }
    if (char === '`') {
      flushWord();
      blank(i);
      stack.push({ type: 'template' });
      i += 1;
      continue;
    }
    if (char === '/') {
      const allowed = regexAllowed();
      flushWord();
      if (allowed) {
        blank(i);
        stack.push({ type: 'regex', inClass: false });
        i += 1;
      } else {
        markPunct('/');
        i += 1;
      }
      continue;
    }
    if (char === '{') {
      flushWord();
      frame.braceDepth += 1;
      markPunct('{');
      i += 1;
      continue;
    }
    if (char === '}') {
      flushWord();
      if (frame.braceDepth === 0) {
        // End of a template `${...}` expression: back to template.
        // (At the top-level code frame an unmatched `}` is invalid
        // code — do not pop the base frame.)
        if (stack.length > 1) stack.pop();
        prevKind = null;
        prevText = null;
        adjacentPunct = false;
        i += 1;
        continue;
      }
      frame.braceDepth -= 1;
      markPunct('}');
      i += 1;
      continue;
    }
    if (isWordChar(char)) {
      word += char;
      adjacentPunct = false;
      i += 1;
      continue;
    }
    flushWord();
    if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
      adjacentPunct = false;
    } else {
      markPunct(char);
    }
    i += 1;
  }
  return out.join('');
}

const THREE_CHAR_OPS = new Set([
  '===',
  '!==',
  '>>>',
  '**=',
  '<<=',
  '>>=',
  '&&=',
  '||=',
  '??=',
  '...',
]);
const TWO_CHAR_OPS = new Set([
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '?.',
  '=>',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<',
  '>>',
  '**',
]);

// Tokenize masked source. Tokens carry 1-based line/column.
export function tokenize(masked) {
  const tokens = [];
  let line = 1;
  let column = 1;
  let i = 0;
  const advance = (count) => {
    for (let k = 0; k < count; k += 1) {
      if (masked[i] === '\n') {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      i += 1;
    }
  };
  while (i < masked.length) {
    const char = masked[i];
    if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
      advance(1);
      continue;
    }
    const startLine = line;
    const startColumn = column;
    if (char === '_' || char === '$' || /[A-Za-z]/.test(char)) {
      let j = i;
      while (j < masked.length && isWordChar(masked[j])) j += 1;
      const value = masked.slice(i, j);
      tokens.push({ type: 'id', value, line: startLine, column: startColumn });
      advance(j - i);
      continue;
    }
    if (
      /[0-9]/.test(char) ||
      (char === '.' && /[0-9]/.test(masked[i + 1] ?? ''))
    ) {
      let j = i;
      while (j < masked.length && /[A-Za-z0-9_.]/.test(masked[j])) j += 1;
      const value = masked.slice(i, j);
      tokens.push({ type: 'num', value, line: startLine, column: startColumn });
      advance(j - i);
      continue;
    }
    const three = masked.slice(i, i + 3);
    if (THREE_CHAR_OPS.has(three)) {
      tokens.push({
        type: 'punct',
        value: three,
        line: startLine,
        column: startColumn,
      });
      advance(3);
      continue;
    }
    const two = masked.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({
        type: 'punct',
        value: two,
        line: startLine,
        column: startColumn,
      });
      advance(2);
      continue;
    }
    tokens.push({
      type: 'punct',
      value: char,
      line: startLine,
      column: startColumn,
    });
    advance(1);
  }
  return tokens;
}

function findMatching(tokens, openIndex, end, open, close) {
  let depth = 0;
  for (let k = openIndex; k < end; k += 1) {
    if (tokens[k].value === open) depth += 1;
    if (tokens[k].value === close) {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return end;
}

// Classify a condition token list as constant 'true' / 'false',
// or null. Accepts one boolean literal, an optional run of `!`,
// and one optional layer of parentheses around either.
export function classifyCondition(conditionTokens) {
  let tokens = conditionTokens;
  while (
    tokens.length >= 2 &&
    tokens[0].value === '(' &&
    tokens[tokens.length - 1].value === ')' &&
    findMatching(tokens, 0, tokens.length, '(', ')') === tokens.length - 1
  ) {
    tokens = tokens.slice(1, -1);
  }
  let negations = 0;
  while (tokens.length > 0 && tokens[0].value === '!') {
    negations += 1;
    tokens = tokens.slice(1);
  }
  if (tokens.length !== 1 || tokens[0].type !== 'id') return null;
  if (tokens[0].value !== 'true' && tokens[0].value !== 'false') return null;
  const literal = tokens[0].value === 'true';
  const flipped = negations % 2 === 1;
  return literal === flipped ? 'false' : 'true';
}

function makeFinding(ctx, token, kind, detail) {
  const lineText = (ctx.originalLines[token.line - 1] ?? '').trim();
  return {
    file: ctx.file,
    line: token.line,
    column: token.column,
    kind,
    detail,
    snippet: lineText.slice(0, 120),
  };
}

// Recurse into every top-level `{...}` group in [start, end):
// method bodies, static blocks, field initializers, arrow
// bodies, object-literal methods. Harmless on plain object
// literals (their "statements" are labels + values).
function recurseGroups(tokens, start, end, ctx) {
  const findings = [];
  let k = start;
  while (k < end) {
    if (tokens[k].value === '{') {
      const close = findMatching(tokens, k, end, '{', '}');
      if (close >= end) break;
      const inner = parseStatementList(tokens, k + 1, close, ctx);
      findings.push(...inner.findings);
      k = close + 1;
      continue;
    }
    k += 1;
  }
  return findings;
}

// Consume one generic statement starting at `start`: scan to
// the first `;` at depth 0, or to a `}` / the list end, recursing
// into `{...}` groups met along the way.
function consumeGeneric(tokens, start, end, ctx) {
  const findings = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  let k = start;
  while (k < end) {
    const value = tokens[k].value;
    if (value === '{') {
      const close = findMatching(tokens, k, end, '{', '}');
      if (close >= end) return { end, findings };
      const inner = parseStatementList(tokens, k + 1, close, ctx);
      findings.push(...inner.findings);
      k = close + 1;
      continue;
    }
    if (value === '}') return { end: k, findings };
    if (value === '(') parenDepth += 1;
    if (value === ')') parenDepth -= 1;
    if (value === '[') bracketDepth += 1;
    if (value === ']') bracketDepth -= 1;
    if (value === ';' && parenDepth <= 0 && bracketDepth <= 0) {
      return { end: k + 1, findings };
    }
    k += 1;
  }
  return { end, findings };
}

// Parse one branch (then / else / loop body) starting at `start`:
// a `{...}` block, or a single statement. Returns its span.
function parseBranch(tokens, start, end, ctx) {
  if (start >= end) return { end: start, start, empty: true, findings: [] };
  if (tokens[start].value === '{') {
    const close = findMatching(tokens, start, end, '{', '}');
    if (close >= end) return { end, start, empty: true, findings: [] };
    const inner = parseStatementList(tokens, start + 1, close, ctx);
    return {
      end: close + 1,
      start,
      empty: close === start + 1,
      findings: inner.findings,
    };
  }
  const stmt = parseStatement(tokens, start, end, ctx);
  const empty = stmt.end === start + 1 && tokens[start].value === ';';
  return { end: stmt.end, start, empty, findings: stmt.findings };
}

function parseIf(tokens, start, end, ctx) {
  let cursor = start + 1;
  if (tokens[cursor]?.value !== '(') {
    const generic = consumeGeneric(tokens, start, end, ctx);
    return { end: generic.end, terminator: false, findings: generic.findings };
  }
  const close = findMatching(tokens, cursor, end, '(', ')');
  if (close >= end) {
    const generic = consumeGeneric(tokens, start, end, ctx);
    return { end: generic.end, terminator: false, findings: generic.findings };
  }
  const condition = classifyCondition(tokens.slice(cursor + 1, close));
  const findings = [];
  cursor = close + 1;
  const thenBranch = parseBranch(tokens, cursor, end, ctx);
  findings.push(...thenBranch.findings);
  cursor = thenBranch.end;
  if (condition === 'false' && !thenBranch.empty) {
    findings.push(
      makeFinding(
        ctx,
        tokens[thenBranch.start],
        'constant-condition',
        'if (false) — then-branch never runs',
      ),
    );
  }
  if (tokens[cursor]?.value === 'else') {
    const elseBranch = parseBranch(tokens, cursor + 1, end, ctx);
    findings.push(...elseBranch.findings);
    cursor = elseBranch.end;
    if (condition === 'true' && !elseBranch.empty) {
      findings.push(
        makeFinding(
          ctx,
          tokens[elseBranch.start],
          'constant-condition',
          'if (true) — else-branch never runs',
        ),
      );
    }
  }
  return { end: cursor, terminator: false, findings };
}

function parseWhile(tokens, start, end, ctx) {
  let cursor = start + 1;
  if (tokens[cursor]?.value !== '(') {
    const generic = consumeGeneric(tokens, start, end, ctx);
    return { end: generic.end, terminator: false, findings: generic.findings };
  }
  const close = findMatching(tokens, cursor, end, '(', ')');
  if (close >= end) {
    const generic = consumeGeneric(tokens, start, end, ctx);
    return { end: generic.end, terminator: false, findings: generic.findings };
  }
  const condition = classifyCondition(tokens.slice(cursor + 1, close));
  const findings = [];
  const body = parseBranch(tokens, close + 1, end, ctx);
  findings.push(...body.findings);
  if (condition === 'false' && !body.empty) {
    findings.push(
      makeFinding(
        ctx,
        tokens[body.start],
        'constant-condition',
        'while (false) — body never runs',
      ),
    );
  }
  return { end: body.end, terminator: false, findings };
}

function parseFor(tokens, start, end, ctx) {
  let cursor = start + 1;
  if (tokens[cursor]?.value !== '(') {
    const generic = consumeGeneric(tokens, start, end, ctx);
    return { end: generic.end, terminator: false, findings: generic.findings };
  }
  const close = findMatching(tokens, cursor, end, '(', ')');
  if (close >= end) {
    const generic = consumeGeneric(tokens, start, end, ctx);
    return { end: generic.end, terminator: false, findings: generic.findings };
  }
  const header = tokens.slice(cursor + 1, close);
  // Split the header on top-level `;`: [init, test, update].
  const parts = [[]];
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (const token of header) {
    if (token.value === '(') parenDepth += 1;
    if (token.value === ')') parenDepth -= 1;
    if (token.value === '[') bracketDepth += 1;
    if (token.value === ']') bracketDepth -= 1;
    if (token.value === '{') braceDepth += 1;
    if (token.value === '}') braceDepth -= 1;
    if (
      token.value === ';' &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      parts.push([]);
      continue;
    }
    parts[parts.length - 1].push(token);
  }
  const testIsFalse =
    parts.length === 3 && classifyCondition(parts[1]) === 'false';
  const findings = [];
  const body = parseBranch(tokens, close + 1, end, ctx);
  findings.push(...body.findings);
  if (testIsFalse && !body.empty) {
    findings.push(
      makeFinding(
        ctx,
        tokens[body.start],
        'constant-condition',
        'for (; false ;) — body never runs',
      ),
    );
  }
  return { end: body.end, terminator: false, findings };
}

function parseDo(tokens, start, end, ctx) {
  const body = parseBranch(tokens, start + 1, end, ctx);
  let cursor = body.end;
  // Optional `while (...) ;` — the body already ran once, so no
  // constant-condition finding even for `while (false)`.
  if (tokens[cursor]?.value === 'while') {
    cursor += 1;
    if (tokens[cursor]?.value === '(') {
      const close = findMatching(tokens, cursor, end, '(', ')');
      if (close < end) cursor = close + 1;
    }
    if (tokens[cursor]?.value === ';') cursor += 1;
  }
  return { end: cursor, terminator: false, findings: body.findings };
}

function parseSwitch(tokens, start, end, ctx) {
  let cursor = start + 1;
  if (tokens[cursor]?.value !== '(') {
    const generic = consumeGeneric(tokens, start, end, ctx);
    return { end: generic.end, terminator: false, findings: generic.findings };
  }
  const close = findMatching(tokens, cursor, end, '(', ')');
  if (close >= end) {
    const generic = consumeGeneric(tokens, start, end, ctx);
    return { end: generic.end, terminator: false, findings: generic.findings };
  }
  cursor = close + 1;
  if (tokens[cursor]?.value !== '{') {
    const generic = consumeGeneric(tokens, start, end, ctx);
    return { end: generic.end, terminator: false, findings: generic.findings };
  }
  const blockClose = findMatching(tokens, cursor, end, '{', '}');
  if (blockClose >= end) {
    const generic = consumeGeneric(tokens, start, end, ctx);
    return { end: generic.end, terminator: false, findings: generic.findings };
  }
  const inner = parseStatementList(tokens, cursor + 1, blockClose, ctx);
  return { end: blockClose + 1, terminator: false, findings: inner.findings };
}

function parseTry(tokens, start, end, ctx) {
  const findings = [];
  let cursor = start + 1;
  if (tokens[cursor]?.value !== '{') {
    const generic = consumeGeneric(tokens, start, end, ctx);
    return { end: generic.end, terminator: false, findings: generic.findings };
  }
  const tryClose = findMatching(tokens, cursor, end, '{', '}');
  if (tryClose >= end) {
    const generic = consumeGeneric(tokens, start, end, ctx);
    return { end: generic.end, terminator: false, findings: generic.findings };
  }
  findings.push(
    ...parseStatementList(tokens, cursor + 1, tryClose, ctx).findings,
  );
  cursor = tryClose + 1;
  if (tokens[cursor]?.value === 'catch') {
    cursor += 1;
    if (tokens[cursor]?.value === '(') {
      const close = findMatching(tokens, cursor, end, '(', ')');
      if (close < end) cursor = close + 1;
    }
    if (tokens[cursor]?.value === '{') {
      const catchClose = findMatching(tokens, cursor, end, '{', '}');
      if (catchClose < end) {
        findings.push(
          ...parseStatementList(tokens, cursor + 1, catchClose, ctx).findings,
        );
        cursor = catchClose + 1;
      }
    }
  }
  if (tokens[cursor]?.value === 'finally') {
    cursor += 1;
    if (tokens[cursor]?.value === '{') {
      const finallyClose = findMatching(tokens, cursor, end, '{', '}');
      if (finallyClose < end) {
        findings.push(
          ...parseStatementList(tokens, cursor + 1, finallyClose, ctx).findings,
        );
        cursor = finallyClose + 1;
      }
    }
  }
  return { end: cursor, terminator: false, findings };
}

function parseFunction(tokens, start, end, ctx) {
  const findings = [];
  let cursor = start + 1;
  if (tokens[cursor]?.value === '*') cursor += 1;
  if (tokens[cursor]?.type === 'id') cursor += 1;
  if (tokens[cursor]?.value !== '(') {
    const generic = consumeGeneric(tokens, start, end, ctx);
    return { end: generic.end, terminator: false, findings: generic.findings };
  }
  const paramsClose = findMatching(tokens, cursor, end, '(', ')');
  if (paramsClose >= end) {
    const generic = consumeGeneric(tokens, start, end, ctx);
    return { end: generic.end, terminator: false, findings: generic.findings };
  }
  // Default parameter values may hold arrow bodies with dead code.
  findings.push(...recurseGroups(tokens, cursor + 1, paramsClose, ctx));
  cursor = paramsClose + 1;
  if (tokens[cursor]?.value === '{') {
    const bodyClose = findMatching(tokens, cursor, end, '{', '}');
    if (bodyClose < end) {
      findings.push(
        ...parseStatementList(tokens, cursor + 1, bodyClose, ctx).findings,
      );
      return { end: bodyClose + 1, terminator: false, findings };
    }
  }
  if (tokens[cursor]?.value === ';') cursor += 1;
  return { end: cursor, terminator: false, findings };
}

function parseClass(tokens, start, end, ctx) {
  let cursor = start + 1;
  let parenDepth = 0;
  let bracketDepth = 0;
  while (cursor < end) {
    const value = tokens[cursor].value;
    if (value === '(') parenDepth += 1;
    if (value === ')') parenDepth -= 1;
    if (value === '[') bracketDepth += 1;
    if (value === ']') bracketDepth -= 1;
    if (value === '{' && parenDepth === 0 && bracketDepth === 0) break;
    if (value === ';' && parenDepth === 0 && bracketDepth === 0) {
      return { end: cursor + 1, terminator: false, findings: [] };
    }
    cursor += 1;
  }
  if (cursor >= end || tokens[cursor]?.value !== '{') {
    const generic = consumeGeneric(tokens, start, end, ctx);
    return { end: generic.end, terminator: false, findings: generic.findings };
  }
  const bodyClose = findMatching(tokens, cursor, end, '{', '}');
  if (bodyClose >= end) {
    const generic = consumeGeneric(tokens, start, end, ctx);
    return { end: generic.end, terminator: false, findings: generic.findings };
  }
  const findings = recurseGroups(tokens, cursor + 1, bodyClose, ctx);
  return { end: bodyClose + 1, terminator: false, findings };
}

// Parse one statement starting at `start`. Returns
// `{ end, terminator, terminatorKind, findings }` where `end`
// is the index just past the statement.
function parseStatement(tokens, start, end, ctx) {
  // Consume leading `label:` pairs (not `case:` / `default:`,
  // which the statement list handles).
  let cursor = start;
  while (
    cursor + 1 < end &&
    tokens[cursor].type === 'id' &&
    tokens[cursor + 1].value === ':'
  ) {
    cursor += 2;
  }
  if (cursor >= end) return { end: cursor, terminator: false, findings: [] };
  const first = tokens[cursor];
  if (first.value === '{') {
    const close = findMatching(tokens, cursor, end, '{', '}');
    if (close >= end) return { end, terminator: false, findings: [] };
    const inner = parseStatementList(tokens, cursor + 1, close, ctx);
    return { end: close + 1, terminator: false, findings: inner.findings };
  }
  if (first.type === 'id') {
    switch (first.value) {
      case 'if':
        return parseIf(tokens, cursor, end, ctx);
      case 'while':
        return parseWhile(tokens, cursor, end, ctx);
      case 'for':
        return parseFor(tokens, cursor, end, ctx);
      case 'do':
        return parseDo(tokens, cursor, end, ctx);
      case 'switch':
        return parseSwitch(tokens, cursor, end, ctx);
      case 'try':
        return parseTry(tokens, cursor, end, ctx);
      case 'function':
        return parseFunction(tokens, cursor, end, ctx);
      case 'class':
        return parseClass(tokens, cursor, end, ctx);
      case 'return':
      case 'throw':
      case 'break':
      case 'continue': {
        const generic = consumeGeneric(tokens, cursor, end, ctx);
        return {
          end: generic.end,
          terminator: true,
          terminatorKind: first.value,
          findings: generic.findings,
        };
      }
      default:
        break;
    }
  }
  const generic = consumeGeneric(tokens, cursor, end, ctx);
  return { end: generic.end, terminator: false, findings: generic.findings };
}

// Parse the statement list in [start, end): the body of a block
// or a whole file. `case:` / `default:` labels reset the
// terminated flag; a bare terminator sets it.
function parseStatementList(tokens, start, end, ctx) {
  const findings = [];
  let terminated = false;
  let lastTerminator = null;
  let i = start;
  while (i < end) {
    const token = tokens[i];
    if (token.value === ';') {
      i += 1;
      continue;
    }
    if (token.value === '}') break;
    if (
      token.type === 'id' &&
      (token.value === 'case' || token.value === 'default')
    ) {
      // Consume through the `:` at depth 0, skipping ternary
      // `:`s (a `?` at depth 0 opens one, its `:` closes it).
      let k = i + 1;
      let parenDepth = 0;
      let bracketDepth = 0;
      let braceDepth = 0;
      let ternaryDepth = 0;
      while (k < end) {
        const value = tokens[k].value;
        if (value === '(') parenDepth += 1;
        if (value === ')') parenDepth -= 1;
        if (value === '[') bracketDepth += 1;
        if (value === ']') bracketDepth -= 1;
        if (value === '{') braceDepth += 1;
        if (value === '}') braceDepth -= 1;
        if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
          if (value === '?') ternaryDepth += 1;
          if (value === ':') {
            if (ternaryDepth > 0) {
              ternaryDepth -= 1;
            } else {
              k += 1;
              break;
            }
          }
        }
        k += 1;
      }
      i = k;
      terminated = false;
      lastTerminator = null;
      continue;
    }
    const stmtStart = i;
    const stmt = parseStatement(tokens, i, end, ctx);
    if (stmt.end <= stmtStart) {
      i = stmtStart + 1;
      continue;
    }
    i = stmt.end;
    if (terminated) {
      findings.push(
        makeFinding(
          ctx,
          tokens[stmtStart],
          'after-terminator',
          `Unreachable: statement follows ${lastTerminator}`,
        ),
      );
    }
    if (stmt.terminator) {
      terminated = true;
      lastTerminator = stmt.terminatorKind;
    }
    findings.push(...stmt.findings);
  }
  return { findings, end: i };
}

// Analyze one source string. Returns findings sorted by
// (line, column, kind).
export function analyzeSource(source, file) {
  const ctx = { file, originalLines: source.split('\n') };
  const tokens = tokenize(maskSource(source));
  const { findings } = parseStatementList(tokens, 0, tokens.length, ctx);
  return [...findings].sort(
    (a, b) =>
      a.line - b.line || a.column - b.column || a.kind.localeCompare(b.kind),
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
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
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
  // Root-level JS files (vite.config.js and friends).
  let rootEntries;
  try {
    rootEntries = await readdir(root, { withFileTypes: true });
  } catch {
    rootEntries = [];
  }
  for (const entry of rootEntries.sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      found.push(entry.name);
    }
  }
  return [...new Set(found)].sort();
}

export async function analyzeFiles(files, { readFile }) {
  const all = [];
  for (const file of files) {
    const source = await readFile(file);
    all.push(...analyzeSource(source, file));
  }
  all.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.column - b.column ||
      a.kind.localeCompare(b.kind),
  );
  return { findings: all, filesScanned: files.length };
}

export function filterByFiles(findings, files) {
  if (!files || files.length === 0) return findings;
  const wanted = new Set(files);
  return findings.filter((finding) => wanted.has(finding.file));
}

export function summarizeResults(analyzed, { findings }) {
  const byKind = {};
  for (const finding of findings) {
    byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1;
  }
  return {
    filesScanned: analyzed.filesScanned,
    findings: findings.length,
    byKind,
  };
}

export function groupByFile(findings) {
  const groups = new Map();
  for (const finding of findings) {
    if (!groups.has(finding.file)) groups.set(finding.file, []);
    groups.get(finding.file).push(finding);
  }
  return [...groups.entries()]
    .map(([file, items]) => ({ file, count: items.length, findings: items }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}

export function limitFindings(groups, limit) {
  if (!limit || limit <= 0) return groups;
  return groups.slice(0, limit);
}

export function formatUnreachableCodeReport({ summary, ranked }, limit) {
  const lines = [];
  lines.push('Unreachable-code scoreboard (report-only)');
  lines.push(
    `Scanned ${summary.filesScanned} files — ${summary.findings} unreachable statement(s) ` +
      `(${summary.byKind['after-terminator'] ?? 0} after-terminator, ` +
      `${summary.byKind['constant-condition'] ?? 0} constant-condition)`,
  );
  if (ranked.length === 0) {
    lines.push('No unreachable code found.');
    return lines.join('\n');
  }
  lines.push(`Top ${ranked.length} file(s) by unreachable statements:`);
  for (const group of ranked) {
    lines.push(`  ${group.file} — ${group.count}`);
    for (const finding of group.findings) {
      lines.push(
        `    ${finding.file}:${finding.line}:${finding.column} [${finding.kind}] ${finding.detail}`,
      );
      if (finding.snippet) lines.push(`      ${finding.snippet}`);
    }
  }
  lines.push(
    'Advisory only: verify before deleting — see the documented limits in src/tooling/unreachableCodeScoreboard.js.',
  );
  return lines.join('\n');
}

export function parseCliArgs(argv) {
  const args = {
    json: false,
    limit: DEFAULT_LIMIT,
    files: [],
    help: false,
    error: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--limit') {
      const raw = argv[i + 1];
      if (raw === undefined) {
        args.error = '--limit needs a value';
        return args;
      }
      const value = Number.parseInt(raw, 10);
      if (!Number.isFinite(value) || value < 0) {
        args.error = `--limit must be a non-negative integer (got ${raw})`;
        return args;
      }
      args.limit = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const raw = arg.slice('--limit='.length);
      const value = Number.parseInt(raw, 10);
      if (!Number.isFinite(value) || value < 0) {
        args.error = `--limit must be a non-negative integer (got ${raw})`;
        return args;
      }
      args.limit = value;
      continue;
    }
    if (arg.startsWith('--')) {
      args.error = `unknown option ${arg}`;
      return args;
    }
    args.files.push(arg);
  }
  return args;
}
