// Long-parameter-list scoreboard: functions and methods in src/ production
// code whose parameter list is longer than the threshold (default: more
// than 5 params) — ranked worst-first so the riskiest signatures get
// reviewed first. Report-only; always exits 0.
//
// What it flags: every function-like node — `function` declarations and
// expressions, arrow functions, object methods, class methods (including
// constructors) — with `params.length > threshold`. Each parameter counts
// once, whatever its shape: a defaulted parameter (`b = 1`), a rest
// parameter (`...rest`), and a destructured parameter (`{ a, b }`, `[c]`)
// each count as ONE parameter. That matches how a reader experiences the
// signature: one slot in the call they must fill in the right order.
//
// What it deliberately ignores:
// - Test files, fixture trees, src/tooling/, src/testSupport/,
//   *.worker.mjs: same scope as the other static scoreboards.
// - Getters/setters are scanned like everything else (0-1 params), so they
//   never appear as offenders — no special-casing needed.
//
// Conservative by design: a long parameter list is not automatically
// wrong (data-table builders, framework callbacks), but every finding is
// a candidate for the "introduce a parameter object" refactor — hence
// report-only, with the parameter names printed so a human can judge
// without opening the file. Files that fail to parse are counted in the
// summary and skipped, never fatal.
import { parsers } from 'prettier/plugins/babel.mjs';

const SOURCE_SUFFIXES = Object.freeze(['.js', '.mjs']);

const TEST_SUFFIXES = Object.freeze(['.test.mjs', '.spec.mjs']);

/** Directories whose files are test infrastructure, not production code. */
const TEST_INFRASTRUCTURE_DIRS = Object.freeze([
  'src/tooling/',
  'src/testSupport/',
]);

const FIXTURE_SEGMENTS = Object.freeze(['fixtures', '__fixtures__']);

/** The default "long" threshold: flag functions with MORE than this many params. */
export const DEFAULT_THRESHOLD = 5;

/** Default number of offenders shown in the human report. */
export const DEFAULT_LIMIT = 20;

/** True for a repo-relative, posix-style src/ production module. */
export function isScannedFile(file) {
  if (!file.startsWith('src/')) return false;
  if (!SOURCE_SUFFIXES.some((suffix) => file.endsWith(suffix))) return false;
  if (TEST_SUFFIXES.some((suffix) => file.endsWith(suffix))) return false;
  if (file.endsWith('.worker.mjs')) return false;
  if (TEST_INFRASTRUCTURE_DIRS.some((directory) => file.startsWith(directory)))
    return false;
  return !file.split('/').some((segment) => FIXTURE_SEGMENTS.includes(segment));
}

/** True for a babel AST node that declares a parameter list. */
function isFunctionLike(node) {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'ObjectMethod' ||
    node.type === 'ClassMethod' ||
    node.type === 'ClassPrivateMethod'
  );
}

/** A short label for a single parameter pattern. */
function patternLabel(pattern) {
  if (pattern.type === 'Identifier') return pattern.name;
  if (pattern.type === 'ObjectPattern' || pattern.type === 'ArrayPattern')
    return '<destructured>';
  return '<param>';
}

/**
 * Describe one parameter: `{ label, kind }` where kind is one of
 * 'plain' | 'default' | 'rest' | 'destructured'. A defaulted or rest
 * parameter still counts as one parameter; the kind only documents shape.
 */
export function describeParam(param) {
  if (param.type === 'RestElement') {
    return {
      label: `...${patternLabel(param.argument)}`,
      kind: 'rest',
    };
  }
  if (param.type === 'AssignmentPattern') {
    const inner = describeParam(param.left);
    return { label: inner.label, kind: 'default' };
  }
  if (param.type === 'ObjectPattern' || param.type === 'ArrayPattern') {
    return { label: '<destructured>', kind: 'destructured' };
  }
  return { label: patternLabel(param), kind: 'plain' };
}

/** Key name of a method (handles string keys and private names). */
function methodKeyName(key) {
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'StringLiteral' || key.type === 'NumericLiteral')
    return String(key.value);
  if (key.type === 'PrivateName') return `#${key.id.name}`;
  return '<computed>';
}

/** Best-effort display name for a function-like node, given its parent. */
export function nameOf(node, parent) {
  if (
    node.type === 'ObjectMethod' ||
    node.type === 'ClassMethod' ||
    node.type === 'ClassPrivateMethod'
  ) {
    const key = methodKeyName(node.key);
    if (
      (node.type === 'ClassMethod' || node.type === 'ClassPrivateMethod') &&
      parent?.type === 'ClassBody' &&
      typeof parent.__className === 'string'
    ) {
      return `${parent.__className}.${key}`;
    }
    return key;
  }
  if (node.id?.type === 'Identifier') return node.id.name;
  if (!parent) return '<anonymous>';
  if (
    parent.type === 'VariableDeclarator' &&
    parent.id?.type === 'Identifier'
  ) {
    return parent.id.name;
  }
  if (
    parent.type === 'AssignmentExpression' &&
    parent.left?.type === 'Identifier'
  ) {
    return parent.left.name;
  }
  if (
    (parent.type === 'ObjectProperty' || parent.type === 'ClassProperty') &&
    parent.key
  ) {
    return methodKeyName(parent.key);
  }
  return '<anonymous>';
}

/** Coarse kind for the report: function | arrow | method | constructor. */
function kindOf(node) {
  if (node.type === 'ArrowFunctionExpression') return 'arrow';
  if (
    node.type === 'ObjectMethod' ||
    node.type === 'ClassMethod' ||
    node.type === 'ClassPrivateMethod'
  ) {
    return node.kind === 'constructor' ? 'constructor' : 'method';
  }
  return 'function';
}

function walk(node, parent, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'comments', 'tokens', 'extra'].includes(key)) continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, node, visit);
    } else if (value && typeof value === 'object') {
      walk(value, node, visit);
    }
  }
}

/**
 * Scan parsed entries `{ file, source }[]` for functions with more than
 * `threshold` parameters. Returns `{ findings, stats }`: `findings` are
 * sorted worst-first (param count desc, then file, then line); `stats`
 * carries filesScanned, functionsScanned, and parseErrors.
 */
export function scanLongParams(
  entries,
  { threshold = DEFAULT_THRESHOLD } = {},
) {
  const findings = [];
  let functionsScanned = 0;
  let parseErrors = 0;
  for (const { file, source } of entries) {
    let ast;
    try {
      ast = parsers.babel.parse(source, {
        sourceType: 'module',
        allowImportExportEverywhere: true,
      });
    } catch {
      parseErrors += 1;
      continue;
    }
    walk(ast, null, (node, parent) => {
      if (
        node.type === 'ClassBody' &&
        parent &&
        (parent.type === 'ClassDeclaration' ||
          parent.type === 'ClassExpression')
      ) {
        node.__className =
          parent.id?.type === 'Identifier' ? parent.id.name : '<anonymous>';
      }
      if (!isFunctionLike(node)) return;
      functionsScanned += 1;
      const paramCount = node.params.length;
      if (paramCount <= threshold) return;
      findings.push({
        file,
        line: node.loc?.start.line ?? 0,
        name: nameOf(node, parent),
        kind: kindOf(node),
        paramCount,
        params: node.params.map((param) => describeParam(param).label),
      });
    });
  }
  findings.sort(
    (a, b) =>
      b.paramCount - a.paramCount ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line,
  );
  return {
    findings,
    stats: {
      filesScanned: entries.length,
      functionsScanned,
      parseErrors,
    },
  };
}

/**
 * Roll scan results up to a summary. `stats` comes from
 * `scanLongParams(...).stats`.
 */
export function summarizeLongParams(findings, stats, { threshold } = {}) {
  return {
    threshold,
    filesScanned: stats.filesScanned,
    functionsScanned: stats.functionsScanned,
    offenders: findings.length,
    parseErrors: stats.parseErrors,
    maxParamCount: findings.length
      ? Math.max(...findings.map((finding) => finding.paramCount))
      : 0,
  };
}

/** Human-readable report, worst offenders first, capped at `limit`. */
export function formatLongParamsReport(findings, summary, { limit } = {}) {
  const shown = typeof limit === 'number' ? findings.slice(0, limit) : findings;
  const lines = [
    `Long-parameter-list scoreboard (flags > ${summary.threshold} params)`,
    `${summary.offenders} function(s) over threshold across ${summary.filesScanned} scanned file(s); ${summary.functionsScanned} functions scanned${summary.parseErrors ? `, ${summary.parseErrors} parse error(s)` : ''}.`,
    '',
  ];
  if (shown.length === 0) {
    lines.push('No functions over the threshold. Nothing to review.');
  } else {
    for (const finding of shown) {
      lines.push(
        `  ${finding.file}:${finding.line} — ${finding.name} (${finding.kind}) — ${finding.paramCount} params (${finding.params.join(', ')})`,
      );
    }
    if (findings.length > shown.length) {
      lines.push(
        `  … and ${findings.length - shown.length} more (use --limit N or --json for the full list)`,
      );
    }
  }
  return lines.join('\n');
}
