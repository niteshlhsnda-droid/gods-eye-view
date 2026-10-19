import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DRIFT_WINDOW,
  POLICY_SCHEMA_VERSION,
  evaluatePolicy,
  formatPolicyReport,
  parsePolicy,
  policyFailsStrict,
} from '../../scripts/noOpPromisePolicy.mjs';
import { parseCliArgs } from '../../scripts/noOpPromise.mjs';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

const TODAY = '2026-10-19';

function finding(file, line, findingClass = 'noop-catch-anonymous') {
  return {
    file,
    line,
    class: findingClass,
    severity: 'error',
    detail: 'no-op rejection handler discards the error',
  };
}

function entry(file, line, overrides = {}) {
  return {
    file,
    class: 'noop-catch-anonymous',
    line,
    reason: 'test justification',
    review: '2027-01-19',
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    version: POLICY_SCHEMA_VERSION,
    enforcedClasses: ['noop-catch-anonymous'],
    allowlist: [],
    ...overrides,
  };
}

test('parsePolicy accepts the shipped v1 policy (positive control)', async () => {
  const text = await readFile(
    path.join(ROOT, 'scripts', 'noOpPromise.policy.json'),
    'utf8',
  );
  const parsed = parsePolicy(text);
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.enforcedClasses, [
    'noop-catch-anonymous',
    'noop-catch-named',
    'noop-then-fulfillment',
  ]);
  assert.equal(parsed.allowlist.length, 82);
  assert.equal(parsed.rules.length, 5);
  assert.ok(
    parsed.allowlist.every((entry) => typeof entry.reason === 'string'),
  );
});

test('parsePolicy accepts a minimal valid policy', () => {
  const parsed = parsePolicy(
    JSON.stringify(policy({ allowlist: [entry('src/a.js', 1)] })),
  );
  assert.equal(parsed.allowlist.length, 1);
  assert.equal(parsed.allowlist[0].line, 1);
});

test('parsePolicy rejects malformed policies', () => {
  assert.throws(() => parsePolicy('not json'), /invalid JSON/);
  assert.throws(
    () => parsePolicy(JSON.stringify(policy({ version: 99 }))),
    /unsupported version 99/,
  );
  assert.throws(
    () => parsePolicy(JSON.stringify(policy({ enforcedClasses: [] }))),
    /non-empty array/,
  );
  assert.throws(
    () => parsePolicy(JSON.stringify(policy({ enforcedClasses: ['nope'] }))),
    /must be one of/,
  );
  assert.throws(
    () =>
      parsePolicy(
        JSON.stringify(
          policy({ allowlist: [entry('src/a.js', 1, { class: 'nope' })] }),
        ),
      ),
    /must be one of/,
  );
  assert.throws(
    () =>
      parsePolicy(
        JSON.stringify(
          policy({ allowlist: [entry('src/a.js', 1, { reason: '  ' })] }),
        ),
      ),
    /non-empty string/,
  );
  assert.throws(
    () =>
      parsePolicy(
        JSON.stringify(
          policy({
            allowlist: [entry('src/a.js', 1, { review: '19-10-2026' })],
          }),
        ),
      ),
    /YYYY-MM-DD/,
  );
  assert.throws(
    () =>
      parsePolicy(
        JSON.stringify(
          policy({
            allowlist: [entry('src/a.js', 1, { review: '2026-02-30' })],
          }),
        ),
      ),
    /valid YYYY-MM-DD/,
  );
  assert.throws(
    () =>
      parsePolicy(
        JSON.stringify(policy({ allowlist: [entry('src/a.js', 0)] })),
      ),
    /positive integer/,
  );
  assert.throws(
    () =>
      parsePolicy(
        JSON.stringify(
          policy({ allowlist: [entry('src/a.js', 1), entry('src/a.js', 1)] }),
        ),
      ),
    /duplicates an earlier entry/,
  );
});

test('evaluatePolicy allowlists exact file+class+line matches', () => {
  const parsed = parsePolicy(
    JSON.stringify(policy({ allowlist: [entry('src/a.js', 10)] })),
  );
  const result = evaluatePolicy(parsed, [finding('src/a.js', 10)], {
    today: TODAY,
  });
  assert.equal(result.allowlisted.length, 1);
  assert.equal(result.violations.length, 0);
  assert.equal(result.staleEntries.length, 0);
  assert.equal(policyFailsStrict(result), false);
});

test('evaluatePolicy flags line drift as violation + stale + advisory note', () => {
  const parsed = parsePolicy(
    JSON.stringify(policy({ allowlist: [entry('src/a.js', 10)] })),
  );
  const movedLine = 10 + DRIFT_WINDOW - 1;
  const result = evaluatePolicy(parsed, [finding('src/a.js', movedLine)], {
    today: TODAY,
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].reason, 'not-allowlisted');
  assert.equal(result.staleEntries.length, 1);
  assert.equal(result.driftNotes.length, 1);
  assert.match(result.driftNotes[0], new RegExp(`line ${movedLine}`));
  assert.equal(policyFailsStrict(result), true);
});

test('evaluatePolicy flags expired entries as violations (not stale)', () => {
  const parsed = parsePolicy(
    JSON.stringify(
      policy({ allowlist: [entry('src/a.js', 10, { review: '2026-01-01' })] }),
    ),
  );
  const result = evaluatePolicy(parsed, [finding('src/a.js', 10)], {
    today: TODAY,
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].reason, 'allowlist-expired');
  assert.equal(result.staleEntries.length, 0);
  assert.equal(result.allowlisted.length, 0);
  assert.equal(policyFailsStrict(result), true);
});

test('evaluatePolicy treats a null line as a whole-file class waiver', () => {
  const parsed = parsePolicy(
    JSON.stringify(policy({ allowlist: [entry('src/a.js', null)] })),
  );
  const result = evaluatePolicy(
    parsed,
    [finding('src/a.js', 3), finding('src/a.js', 400)],
    { today: TODAY },
  );
  assert.equal(result.allowlisted.length, 2);
  assert.equal(result.violations.length, 0);
  // An entry covers every finding it matches: two identical findings on
  // one exact line are both covered by the same entry.
  const single = parsePolicy(
    JSON.stringify(policy({ allowlist: [entry('src/b.js', 7)] })),
  );
  const doubled = evaluatePolicy(
    single,
    [finding('src/b.js', 7), finding('src/b.js', 7)],
    { today: TODAY },
  );
  assert.equal(doubled.allowlisted.length, 2);
  assert.equal(doubled.violations.length, 0);
  assert.equal(doubled.staleEntries.length, 0);
});

test('evaluatePolicy ignores findings outside enforced classes', () => {
  const parsed = parsePolicy(JSON.stringify(policy({ allowlist: [] })));
  const result = evaluatePolicy(
    parsed,
    [finding('src/a.js', 1, 'noop-catch-named')],
    { today: TODAY },
  );
  assert.equal(result.violations.length, 0);
  assert.equal(result.allowlisted.length, 0);
});

test('evaluatePolicy reports stale entries even with zero findings', () => {
  const parsed = parsePolicy(
    JSON.stringify(policy({ allowlist: [entry('src/a.js', 10)] })),
  );
  const result = evaluatePolicy(parsed, [], { today: TODAY });
  assert.equal(result.staleEntries.length, 1);
  assert.equal(result.driftNotes.length, 0);
  assert.equal(policyFailsStrict(result), true);
});

test('formatPolicyReport renders counts, violations, stale entries, drift', () => {
  const parsed = parsePolicy(
    JSON.stringify(policy({ allowlist: [entry('src/a.js', 10)] })),
  );
  const result = evaluatePolicy(parsed, [finding('src/a.js', 12)], {
    today: TODAY,
  });
  const report = formatPolicyReport(result);
  assert.match(
    report,
    /0 finding\(s\) allowlisted, 1 violation\(s\), 1 stale entr/,
  );
  assert.match(report, /VIOLATION \[not-allowlisted\]/);
  assert.match(report, /STALE src\/a\.js:10/);
  assert.match(report, /DRIFT\?/);
});

test('parseCliArgs parses --policy and --no-policy', () => {
  const withPolicy = parseCliArgs(['--policy', 'custom.json', '--strict']);
  assert.equal(withPolicy.policy, 'custom.json');
  assert.equal(withPolicy.noPolicy, false);
  assert.equal(withPolicy.strict, true);

  const equalsForm = parseCliArgs(['--policy=other.json']);
  assert.equal(equalsForm.policy, 'other.json');

  const noPolicy = parseCliArgs(['--no-policy']);
  assert.equal(noPolicy.noPolicy, true);

  const missing = parseCliArgs(['--policy']);
  assert.match(missing.error, /--policy requires a value/);
});
