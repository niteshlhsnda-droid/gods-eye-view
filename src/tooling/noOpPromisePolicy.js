// No-op-promise strict-policy engine: thin re-export of the policy
// evaluator that lives in scripts/noOpPromisePolicy.mjs (keeps
// node:fs/node:path tooling out of src/). Pure functions over parsed
// policy + findings — safe to import from browser-side dashboards.
export * from '../../scripts/noOpPromisePolicy.mjs';
