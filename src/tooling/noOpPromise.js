// No-op-promise scoreboard: thin re-export of the analyzer that lives
// in scripts/noOpPromise.mjs (keeps node:fs/node:path tooling out of
// src/). Report-only static audit of no-op promise handlers across
// src/: `.catch(() => {})`, `.catch(noop)`, `.then(() => {})`.
export * from '../../scripts/noOpPromise.mjs';
