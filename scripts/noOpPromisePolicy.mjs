// No-op-promise strict-policy engine: pure, browser-boundary-safe
// evaluation of the `--strict` policy for the no-op-promise
// scoreboard. No node: imports here — the CLI
// (scripts/scoreboard-no-op-promise.mjs) does all filesystem work and
// passes parsed findings + policy text in.
//
// Policy model (scripts/noOpPromise.policy.json):
// - version: POLICY_SCHEMA_VERSION (currently 1)
// - enforcedClasses: finding classes that fail --strict when not allowlisted
// - rules: the human/machine-readable rule set (informational for the engine)
// - allowlist: entries { file, class, line|null, reason, review } where
//   `review` is a YYYY-MM-DD date. An entry whose review date has passed
//   fails --strict (R2: expiry), and an entry matching no live finding
//   fails --strict (R3: no stale entries).
//
// Matching is exact on (file, class, line). Line-exact matching is
// deliberate: moving code near a swallow re-triggers review instead of
// silently inheriting the old justification. Near-miss matches (same
// file+class, line within DRIFT_WINDOW) are reported as advisory drift
// notes, never as failures.

import { FINDING_CLASSES } from './noOpPromise.mjs';

export const POLICY_SCHEMA_VERSION = 1;

// Advisory only: a stale entry whose line is within this window of a
// live finding of the same file+class is probably a moved line.
export const DRIFT_WINDOW = 5;

const REVIEW_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(value) {
  if (!REVIEW_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// Compare two YYYY-MM-DD strings as calendar dates (string compare is
// chronological for this format). Returns true when `today` is past
// the review date.
function isExpired(review, today) {
  return today > review;
}

function todayString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function fail(message) {
  throw new Error(`no-op-promise policy: ${message}`);
}

function checkEntry(entry, index, seen) {
  const where = `allowlist[${index}]`;
  if (typeof entry !== 'object' || entry === null)
    fail(`${where} must be an object`);
  if (typeof entry.file !== 'string' || entry.file.length === 0)
    fail(`${where}.file must be a non-empty string`);
  if (!FINDING_CLASSES.includes(entry.class))
    fail(
      `${where}.class must be one of ${FINDING_CLASSES.join(', ')} (got ${JSON.stringify(entry.class)})`,
    );
  if (entry.line !== null && entry.line !== undefined) {
    if (!Number.isInteger(entry.line) || entry.line < 1)
      fail(
        `${where}.line must be a positive integer or null (got ${JSON.stringify(entry.line)})`,
      );
  }
  if (typeof entry.reason !== 'string' || entry.reason.trim().length === 0)
    fail(`${where}.reason must be a non-empty string`);
  if (!isValidDateString(entry.review))
    fail(
      `${where}.review must be a valid YYYY-MM-DD date (got ${JSON.stringify(entry.review)})`,
    );
  const key = `${entry.file}|${entry.class}|${entry.line ?? ''}`;
  if (seen.has(key))
    fail(
      `${where} duplicates an earlier entry for ${entry.file}:${entry.line ?? '?'} [${entry.class}]`,
    );
  seen.add(key);
  return {
    file: entry.file,
    class: entry.class,
    line: entry.line ?? null,
    reason: entry.reason.trim(),
    review: entry.review,
  };
}

// Parse + validate policy JSON text. Throws a descriptive Error on any
// schema violation; never returns a half-valid policy.
export function parsePolicy(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    fail(`invalid JSON: ${error.message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    fail('policy must be a JSON object');
  if (raw.version !== POLICY_SCHEMA_VERSION)
    fail(
      `unsupported version ${JSON.stringify(raw.version)} (expected ${POLICY_SCHEMA_VERSION})`,
    );
  if (!Array.isArray(raw.enforcedClasses) || raw.enforcedClasses.length === 0)
    fail('enforcedClasses must be a non-empty array');
  for (const name of raw.enforcedClasses) {
    if (!FINDING_CLASSES.includes(name))
      fail(
        `enforcedClasses entry must be one of ${FINDING_CLASSES.join(', ')} (got ${JSON.stringify(name)})`,
      );
  }
  if (!Array.isArray(raw.allowlist)) fail('allowlist must be an array');
  const seen = new Set();
  const allowlist = raw.allowlist.map((entry, index) =>
    checkEntry(entry, index, seen),
  );
  return {
    version: raw.version,
    enforcedClasses: [...raw.enforcedClasses],
    rules: Array.isArray(raw.rules) ? raw.rules : [],
    allowlist,
  };
}

function entryMatchesFinding(entry, finding) {
  return (
    entry.file === finding.file &&
    entry.class === finding.class &&
    (entry.line === null || entry.line === finding.line)
  );
}

// Evaluate live findings against the policy. `today` is injectable as
// YYYY-MM-DD (defaults to the real date) so tests stay deterministic.
// Returns { allowlisted, violations, staleEntries, driftNotes }:
// - allowlisted: findings matched by a live, unexpired entry
// - violations: findings in an enforced class with no live entry, or
//   whose entry expired — each carries a reason
// - staleEntries: allowlist entries matching no live finding
// - driftNotes: advisory near-misses for stale entries (never failures)
export function evaluatePolicy(
  policy,
  findings,
  { today = todayString() } = {},
) {
  const enforced = new Set(policy.enforcedClasses);
  const consumed = new Array(policy.allowlist.length).fill(false);
  const allowlisted = [];
  const violations = [];

  for (const finding of findings) {
    if (!enforced.has(finding.class)) continue;
    let matched = -1;
    for (let i = 0; i < policy.allowlist.length; i += 1) {
      if (entryMatchesFinding(policy.allowlist[i], finding)) {
        matched = i;
        break;
      }
    }
    if (matched === -1) {
      violations.push({
        finding,
        reason: 'not-allowlisted',
        detail: `no allowlist entry for ${finding.file}:${finding.line} [${finding.class}]`,
      });
      continue;
    }
    const entry = policy.allowlist[matched];
    // An entry covers every finding it matches: exact-line entries are
    // matched by at most the findings on that line, and a null-line
    // entry is an explicit whole-file class waiver. `consumed` only
    // tracks "covered at least one finding" for the stale check.
    consumed[matched] = true;
    if (isExpired(entry.review, today)) {
      violations.push({
        finding,
        reason: 'allowlist-expired',
        detail:
          `allowlist entry for ${entry.file}:${entry.line ?? '?'} [${entry.class}] ` +
          `expired on ${entry.review}: ${entry.reason}`,
      });
      continue;
    }
    allowlisted.push({ finding, entry });
  }

  const staleEntries = [];
  const driftNotes = [];
  for (let i = 0; i < policy.allowlist.length; i += 1) {
    if (consumed[i]) continue;
    const entry = policy.allowlist[i];
    staleEntries.push(entry);
    if (entry.line !== null) {
      const near = findings.find(
        (finding) =>
          finding.file === entry.file &&
          finding.class === entry.class &&
          Math.abs(finding.line - entry.line) <= DRIFT_WINDOW,
      );
      if (near) {
        driftNotes.push(
          `stale entry ${entry.file}:${entry.line} [${entry.class}] may have moved ` +
            `to line ${near.line}`,
        );
      }
    }
  }

  return { allowlisted, violations, staleEntries, driftNotes };
}

// True when --strict should fail: any violation, or any stale entry.
export function policyFailsStrict(evaluation) {
  return evaluation.violations.length > 0 || evaluation.staleEntries.length > 0;
}

export function formatPolicyReport(evaluation) {
  const lines = [
    `Policy: ${evaluation.allowlisted.length} finding(s) allowlisted, ` +
      `${evaluation.violations.length} violation(s), ` +
      `${evaluation.staleEntries.length} stale entr(ies).`,
  ];
  for (const violation of evaluation.violations) {
    lines.push(`  VIOLATION [${violation.reason}] ${violation.detail}`);
  }
  for (const entry of evaluation.staleEntries) {
    lines.push(
      `  STALE ${entry.file}:${entry.line ?? '?'} [${entry.class}] — ${entry.reason}`,
    );
  }
  for (const note of evaluation.driftNotes) {
    lines.push(`  DRIFT? ${note}`);
  }
  return lines.join('\n');
}
