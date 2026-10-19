// No-op-promise scoreboard CLI: report where src/ promise handlers
// silently swallow errors or discard results — `.catch(() => {})`,
// `.catch(noop)`, `.then(() => {})`, and friends. The strict-policy
// companion to the error-swallowing scoreboard: every class is
// error-severity, so `--strict` exits 1 on any finding. Report-only:
// exit 0 otherwise; no file writes.
//
// Usage:
//   node scripts/scoreboard-no-op-promise.mjs [--json] [--limit N] [--strict] [file ...]
//
// With no file arguments the whole `src/` tree is reported. With file
// arguments, only those files are shown (paths are root-relative,
// e.g. `src/data/foo.js`). `--limit N` caps the finding list (0 means
// all; default 10).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_LIMIT,
  STRICT_CLASSES,
  analyzeFiles,
  discoverSourceFiles,
  filterFindingsByFiles,
  formatNoOpPromiseReport,
  parseCliArgs,
  summarizeResults,
} from './noOpPromise.mjs';
import {
  evaluatePolicy,
  formatPolicyReport,
  parsePolicy,
  policyFailsStrict,
} from './noOpPromisePolicy.mjs';

export const DEFAULT_POLICY_FILENAME = 'noOpPromise.policy.json';

const USAGE = `Usage:
  node scripts/scoreboard-no-op-promise.mjs [--json] [--limit N] [--strict] [--policy PATH | --no-policy] [file ...]

Static no-op-promise scoreboard for src/. Report-only: exit 0 even
when findings exist. --strict exits 1 on any finding
(noop-catch-anonymous, noop-catch-named, noop-then-fulfillment) unless
the strict policy (scripts/noOpPromise.policy.json by default)
allow-lists it with a live, unexpired entry; stale allowlist entries
also fail --strict. --no-policy restores the raw pre-policy behavior.
--limit N caps the finding list (0 means all; default ${DEFAULT_LIMIT}).
With file arguments, only those files are shown.`;

export async function runNoOpPromiseScoreboard(root, argv = process.argv) {
  const args = parseCliArgs(argv.slice(2));
  if (args.error) {
    console.error(`scoreboard-no-op-promise: ${args.error}`);
    console.error(USAGE);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const files = await discoverSourceFiles(root);
  let analysis;
  try {
    analysis = await analyzeFiles(files, {
      readFile: (file) => readFile(path.join(root, file), 'utf8'),
    });
  } catch (error) {
    console.error(`scoreboard-no-op-promise: cannot read source: ${error}`);
    return 2;
  }
  const { findings, stats } = analysis;

  let shown = findings;
  if (args.positional.length) {
    const wanted = args.positional.map((file) => {
      const absolute = path.isAbsolute(file) ? file : path.join(root, file);
      return path.relative(root, absolute);
    });
    shown = filterFindingsByFiles(findings, wanted);
  }

  // Strict-policy evaluation (Phase 1 rollout). The policy file is
  // loaded unless --no-policy; a missing default policy keeps the old
  // raw behavior, while an explicit --policy path must exist.
  let policy = null;
  let evaluation = null;
  if (!args.noPolicy) {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const policyPath = args.policy
      ? path.resolve(args.policy)
      : path.join(scriptDir, DEFAULT_POLICY_FILENAME);
    let policyText = null;
    try {
      policyText = await readFile(policyPath, 'utf8');
    } catch (error) {
      if (args.policy) {
        console.error(
          `scoreboard-no-op-promise: cannot read policy: ${error.message}`,
        );
        return 2;
      }
    }
    if (policyText !== null) {
      try {
        policy = parsePolicy(policyText);
      } catch (error) {
        console.error(`scoreboard-no-op-promise: ${error.message}`);
        return 2;
      }
      evaluation = evaluatePolicy(policy, shown);
      // Staleness is judged against the whole tree, not the shown
      // subset: a scoped run (`--strict src/foo.js`) must not fail
      // because bar.js's entries are out of scope. Violations are
      // judged against the shown subset so the gate stays scoped.
      const fullEvaluation = evaluatePolicy(policy, findings);
      evaluation = {
        allowlisted: evaluation.allowlisted,
        violations: evaluation.violations,
        staleEntries: fullEvaluation.staleEntries,
        driftNotes: fullEvaluation.driftNotes,
      };
    }
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          summary: summarizeResults(stats, shown),
          findings: shown,
          policy: evaluation
            ? {
                allowlisted: evaluation.allowlisted.length,
                violations: evaluation.violations,
                staleEntries: evaluation.staleEntries,
                driftNotes: evaluation.driftNotes,
              }
            : null,
        },
        null,
        2,
      ),
    );
  } else {
    const report = formatNoOpPromiseReport(
      { stats, findings: shown },
      args.limit,
    );
    console.log(
      evaluation ? `${report}\n\n${formatPolicyReport(evaluation)}` : report,
    );
  }

  if (args.strict) {
    if (evaluation) {
      if (policyFailsStrict(evaluation)) {
        console.error(
          'scoreboard-no-op-promise: --strict failed the policy gate:',
        );
        console.error(formatPolicyReport(evaluation));
        return 1;
      }
      return 0;
    }
    const strictHits = shown.filter((finding) =>
      STRICT_CLASSES.has(finding.class),
    );
    if (strictHits.length) {
      console.error(
        `scoreboard-no-op-promise: --strict failed on ` +
          `${strictHits.length} error-severity finding(s)`,
      );
      return 1;
    }
  }
  return 0;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = await runNoOpPromiseScoreboard(root, process.argv);
}
