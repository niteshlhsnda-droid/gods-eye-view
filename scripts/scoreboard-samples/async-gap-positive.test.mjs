// Positive-control fixture for the async-gap scoreboard.
//
// NOT under src/, so the unit-test runner and the other scoreboards
// (which discover src/**/*.test.mjs) never see it. Every finding below
// is intentional: the scanner must report one of each async-gap kind.
// Do not "fix" these samples; they are the control.
import { test } from 'node:test';

test('no-await: async callback that never awaits', async () => {
  doSomethingSync();
});

test('fire-and-forget: floating promise', async () => {
  fetch('https://example.test/ping');
  await Promise.resolve();
});

test('unhandled-then: then without catch', async () => {
  await setupFixtures();
  getData().then((rows) => rows.length);
});

test('async-executor: async promise executor', async () => {
  await new Promise(async (resolve) => {
    resolve(await loadValue());
  });
});
