// PLANTED FIXTURE for the no-op-promise scoreboard tests.
// Not production code: every statement below is a deliberate,
// documented no-op promise handler the test expects the analyzer to
// flag. Keep the count in sync with src/tooling/noOpPromise.test.mjs.
//
// Known findings: 6
//   line 18 -> noop-catch-anonymous   (.catch(() => {}))
//   line 19 -> noop-catch-anonymous   (.then(ok, (e) => null))
//   line 20 -> noop-catch-named       (.catch(noop))
//   line 21 -> noop-then-fulfillment  (.then(() => undefined))
//   line 22 -> noop-catch-named       (.then(ok, ignoreErrors))
//   line 23 -> noop-then-fulfillment  (.then(noop))

export const noop = () => {};
export const ignoreErrors = () => {};

export function plantedNoOps(promise, ok) {
  promise.catch(() => {});
  promise.then(ok, (e) => null);
  promise.catch(noop);
  promise.then(() => undefined);
  promise.then(ok, ignoreErrors);
  promise.then(noop);
}
