// Parse `node --test --test-reporter=tap` output and rank test files by
// execution time, so the suite's slowest files are visible. Report-only:
// this module never runs tests, and never throws on unparseable input —
// unrecognised lines are skipped and counted.
//
// TAP shape notes (Node 24):
// - A whole-suite run aggregates every file into one flat stream with no
//   per-file markers, so per-file timing needs one TAP stream per file
//   (see --run in scripts/slowest-tests.mjs) or a --label for the stream.
// - A single file's stream ends with a `# duration_ms` summary: the file
//   total. Individual `ok`/`not ok` entries carry their own duration_ms
//   in a YAML block; entries with `type: 'suite'` are describe-blocks,
//   not tests, and are excluded from the per-test ranking.
// - A top-level `# Subtest: <test-file>` wrapper (nested TAP) marks one
//   file's section; its closing result line carries the file duration.

const TAP_VERSION_RE = /^TAP version \d+/;
const RESULT_RE =
  /^( *)(ok|not ok) (\d+)(?: - (.*?))?(?: # (SKIP|TODO)(?: (.*))?)?$/;
const SUBTEST_RE = /^( *)# Subtest: (.*)$/;
const PLAN_RE = /^ *\d+\.\.\d+$/;
const SUMMARY_DURATION_RE = /^( *)# duration_ms (\S+)\s*$/;
const COMMENT_RE = /^#/;
const YAML_KEY_RE = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/;
const FILE_LIKE_RE = /(?:\.(?:test|spec)\.[cm]?js|\/[^/]+\.[cm]?js)$/;

function leadingSpaces(line) {
  const match = /^[ ]*/.exec(line);
  return match ? match[0].length : 0;
}

function stripQuotes(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"')))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function applyYamlKey(target, key, rawValue) {
  const value = stripQuotes(rawValue.trim());
  if (key === 'duration_ms') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) target.durationMs = parsed;
  } else if (key === 'type') {
    if (value === 'test' || value === 'suite') target.type = value;
  } else if (key === 'location') {
    target.location = value;
    target.locationFile = value.replace(/:\d+:\d+$/, '');
  }
}

function newFileRecord(file, isWrapper) {
  return {
    file,
    durationMs: null,
    explicitDurationMs: null,
    wrapperSummaryMs: null,
    tests: [],
    suiteCount: 0,
    isWrapper,
  };
}

function parseStream(lines, defaultLabel) {
  const filesByLabel = new Map();
  let currentWrapper = null;
  let pendingEntry = null;
  let pendingYamlTarget = null;
  let inYaml = false;
  let yamlIndent = 0;
  let nameStack = [];
  let streamSummaryMs = null;
  let unparseableLines = 0;

  const getRecord = (label, isWrapper) => {
    if (!filesByLabel.has(label)) {
      filesByLabel.set(label, newFileRecord(label, isWrapper));
    }
    return filesByLabel.get(label);
  };

  const commitPending = () => {
    if (!pendingEntry) return;
    const { entry, record } = pendingEntry;
    pendingEntry = null;
    if (entry.type === 'suite') {
      record.suiteCount += 1;
      return;
    }
    record.tests.push(entry);
  };

  const applyWrapperDuration = () => {
    if (
      pendingYamlTarget &&
      pendingYamlTarget.wrapper &&
      pendingYamlTarget.durationMs != null
    ) {
      pendingYamlTarget.wrapper.explicitDurationMs =
        pendingYamlTarget.durationMs;
    }
  };

  for (const line of lines) {
    if (inYaml) {
      const indent = leadingSpaces(line);
      if (line.trim() === '...' && indent === yamlIndent) {
        inYaml = false;
        applyWrapperDuration();
        pendingYamlTarget = null;
        commitPending();
        continue;
      }
      // YAML keys sit at the same indent as their `---` opener; deeper
      // lines are block-scalar content (error/stack) and are ignored.
      if (pendingYamlTarget && indent === yamlIndent) {
        const match = YAML_KEY_RE.exec(line.trim());
        if (match) applyYamlKey(pendingYamlTarget, match[1], match[2]);
      }
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (trimmed === '---') {
      inYaml = true;
      yamlIndent = leadingSpaces(line);
      continue;
    }

    // Any other line ends the previous entry's YAML (if it had one).
    commitPending();
    pendingYamlTarget = null;

    const resultMatch = RESULT_RE.exec(line);
    if (resultMatch) {
      const indent = resultMatch[1].length;
      const ok = resultMatch[2] === 'ok';
      const index = Number(resultMatch[3]);
      const name = resultMatch[4] ?? `test ${index}`;
      const directive = resultMatch[5];
      const skipped = directive === 'SKIP';
      const todo = directive === 'TODO';
      if (indent === 0 && currentWrapper && name === currentWrapper.label) {
        pendingYamlTarget = {
          wrapper: currentWrapper.record,
          durationMs: null,
          type: null,
          location: null,
          locationFile: null,
        };
        currentWrapper = null;
        nameStack = [];
        continue;
      }
      const parents = nameStack
        .filter((entry) => entry.indent < indent)
        .map((entry) => entry.name);
      const fullName = [...parents, name].join(' > ');
      nameStack = nameStack.filter((entry) => entry.indent < indent);
      const record =
        currentWrapper && indent > 0
          ? currentWrapper.record
          : getRecord(defaultLabel, false);
      const entry = {
        name: fullName,
        file: record.file,
        durationMs: 0,
        // Skipped tests neither pass nor fail; a TODO `not ok` is an
        // expected failure, so it counts as passed.
        passed: !skipped && (ok || todo),
        skipped,
        todo,
        type: null,
        location: null,
        locationFile: null,
      };
      pendingEntry = { entry, record };
      pendingYamlTarget = entry;
      continue;
    }

    const subtestMatch = SUBTEST_RE.exec(line);
    if (subtestMatch) {
      const indent = subtestMatch[1].length;
      const subtestName = subtestMatch[2];
      nameStack = nameStack.filter((entry) => entry.indent < indent);
      if (indent === 0 && FILE_LIKE_RE.test(subtestName)) {
        currentWrapper = {
          label: subtestName,
          record: getRecord(subtestName, true),
        };
      } else {
        nameStack.push({ indent, name: subtestName });
      }
      continue;
    }

    if (PLAN_RE.test(line)) continue;

    const summaryMatch = SUMMARY_DURATION_RE.exec(line);
    if (summaryMatch) {
      const parsed = Number(summaryMatch[2]);
      if (Number.isFinite(parsed)) {
        if (summaryMatch[1].length === 0) {
          streamSummaryMs = parsed;
        } else if (currentWrapper) {
          currentWrapper.record.wrapperSummaryMs = parsed;
        }
      }
      continue;
    }

    if (TAP_VERSION_RE.test(line) || COMMENT_RE.test(line)) continue;

    // Never throw on an unparseable line: skip it and count it.
    unparseableLines += 1;
  }

  // A truncated stream (missing `...`) still keeps what was parsed.
  if (inYaml) applyWrapperDuration();
  pendingYamlTarget = null;
  commitPending();

  if (filesByLabel.size === 0 && streamSummaryMs != null) {
    getRecord(defaultLabel, false);
  }

  const records = [...filesByLabel.values()];
  for (const record of records) {
    record.testCount = record.tests.length;
    record.passedCount = record.tests.filter((test) => test.passed).length;
    record.skippedCount = record.tests.filter((test) => test.skipped).length;
    record.failedCount = record.tests.filter(
      (test) => !test.passed && !test.skipped,
    ).length;
    if (record.durationMs == null) {
      if (record.explicitDurationMs != null) {
        record.durationMs = record.explicitDurationMs;
      } else if (records.length === 1 && streamSummaryMs != null) {
        record.durationMs = streamSummaryMs;
      } else if (record.wrapperSummaryMs != null) {
        record.durationMs = record.wrapperSummaryMs;
      } else {
        record.durationMs = record.tests.reduce(
          (sum, test) => sum + test.durationMs,
          0,
        );
      }
    }
    delete record.explicitDurationMs;
    delete record.wrapperSummaryMs;
    delete record.isWrapper;
  }

  return { files: records, unparseableLines };
}

/** Parse TAP text into per-file timing. `options.label` names the file a
 * flat (unwrapped) stream belongs to; concatenated streams without wrappers
 * are labelled `<label>-<n>`. */
export function parseTap(tapText, options = {}) {
  const baseLabel =
    typeof options.label === 'string' && options.label
      ? options.label
      : 'stdin';
  const text = typeof tapText === 'string' ? tapText : String(tapText ?? '');
  const lines = text.split(/\r?\n/);
  const segments = [];
  let current = [];
  for (const line of lines) {
    if (TAP_VERSION_RE.test(line)) {
      segments.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  segments.push(current);
  // A leading header yields an empty first segment; a trailing header
  // yields an empty last one. Drop empties only when other segments exist.
  const nonEmpty = segments.filter((segment) =>
    segment.some((line) => line.trim() !== ''),
  );
  const effective = nonEmpty.length > 0 ? nonEmpty : segments.slice(0, 1);
  const files = [];
  let unparseableLines = 0;
  effective.forEach((segment, index) => {
    const label =
      effective.length === 1 ? baseLabel : `${baseLabel}-${index + 1}`;
    const parsed = parseStream(segment, label);
    files.push(...parsed.files);
    unparseableLines += parsed.unparseableLines;
  });
  return {
    files,
    totalTests: files.reduce((sum, file) => sum + file.testCount, 0),
    totalDurationMs: files.reduce((sum, file) => sum + file.durationMs, 0),
    unparseableLines,
    streams: effective.length,
  };
}

/** Merge per-file parse results (e.g. one per `--run` subprocess). */
export function mergeParsedResults(results) {
  const files = results.flatMap((result) => result.files ?? []);
  return {
    files,
    totalTests: files.reduce((sum, file) => sum + file.testCount, 0),
    totalDurationMs: files.reduce((sum, file) => sum + file.durationMs, 0),
    unparseableLines: results.reduce(
      (sum, result) => sum + (result.unparseableLines ?? 0),
      0,
    ),
    streams: results.reduce((sum, result) => sum + (result.streams ?? 0), 0),
  };
}

/** A file record for a run that produced no TAP (crashed subprocess). */
export function makeEmptyFileResult(file, options = {}) {
  return {
    file,
    durationMs: 0,
    tests: [],
    testCount: 0,
    passedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    suiteCount: 0,
    ...(options.crashed ? { crashed: true } : {}),
  };
}

function applyLimit(list, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return list;
  return list.slice(0, Math.floor(limit));
}

/** Files slowest-first; ties break by file name. `limit <= 0` means all. */
export function rankSlowestFiles(files, limit = 10) {
  return applyLimit(
    [...files].sort(
      (a, b) => b.durationMs - a.durationMs || (a.file < b.file ? -1 : 1),
    ),
    limit,
  );
}

/** Individual tests slowest-first across files; ties break by file, name. */
export function rankSlowestTests(files, limit = 10) {
  const all = files.flatMap((file) =>
    file.tests.map((test) => ({ ...test, file: file.file })),
  );
  return applyLimit(
    all.sort(
      (a, b) =>
        b.durationMs - a.durationMs ||
        (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    ),
    limit,
  );
}

/** `123.4ms` below a second, `1.23s` at/above it. */
export function formatDurationMs(ms) {
  const value = Number.isFinite(ms) && ms >= 0 ? ms : 0;
  if (value < 1000) return `${value.toFixed(1)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

/** Human-readable scoreboard. `limit` applies to both ranked lists. */
export function formatSlowestTestsReport(parsed, limit = 10) {
  const files = rankSlowestFiles(parsed.files, limit);
  const tests = rankSlowestTests(parsed.files, limit);
  const lines = [
    `Slowest-test scoreboard: ${parsed.files.length} files / ` +
      `${parsed.totalTests} tests / ` +
      `${formatDurationMs(parsed.totalDurationMs)} total`,
  ];
  if (files.length === 0) {
    lines.push('No tests found in TAP input.');
  } else {
    lines.push(`Slowest files (top ${files.length}):`);
    for (const file of files) {
      lines.push(
        `  ${file.file} ${formatDurationMs(file.durationMs)} ` +
          `(${file.testCount} tests, ${file.failedCount} failed, ` +
          `${file.skippedCount} skipped)` +
          `${file.crashed ? ' (crashed: no TAP output)' : ''}`,
      );
    }
    if (tests.length > 0) {
      lines.push(`Slowest individual tests (top ${tests.length}):`);
      for (const test of tests) {
        lines.push(
          `  ${test.file} :: ${test.name} ` +
            `${formatDurationMs(test.durationMs)}`,
        );
      }
    }
  }
  if (parsed.unparseableLines > 0) {
    lines.push(`Unparseable lines skipped: ${parsed.unparseableLines}`);
  }
  return lines.join('\n');
}

/** Parse CLI flags. `error` is set (and parsing stops) on bad input. */
export function parseCliArgs(args = []) {
  const result = {
    json: false,
    limit: 10,
    label: null,
    run: false,
    help: false,
    positional: [],
    error: null,
  };
  const takeValue = (arg, name, index) => {
    const eq = arg.indexOf('=');
    if (eq >= 0) return arg.slice(eq + 1);
    if (index + 1 >= args.length) {
      result.error = `Missing value for ${name}`;
      return null;
    }
    return args[index + 1];
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') {
      result.json = true;
    } else if (arg === '--run') {
      result.run = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--limit' || arg.startsWith('--limit=')) {
      const value = takeValue(arg, '--limit', i);
      if (value === null) return result;
      if (arg === '--limit') i += 1;
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) {
        result.error = `Invalid --limit: ${value}`;
        return result;
      }
      result.limit = parsed;
    } else if (arg === '--label' || arg.startsWith('--label=')) {
      const value = takeValue(arg, '--label', i);
      if (value === null) return result;
      if (arg === '--label') i += 1;
      result.label = value;
    } else if (arg.startsWith('-')) {
      result.error = `Unknown option: ${arg}`;
      return result;
    } else {
      result.positional.push(arg);
    }
  }
  return result;
}
