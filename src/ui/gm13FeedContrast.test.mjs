import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// GM-13: off-state feed-state buttons must declare an explicit contrast-safe
// color instead of inheriting --text-dim (2.45:1 on the foundation panel,
// 4.10:1 cyber — both below WCAG AA 4.5:1). Approved colors are the
// node-computed WCAG ratios on the glass button composite from the Cycle-42
// fix spec: #e8eaed 14.0:1 · #ffd27a 11.9:1 · #ffad72 9.2:1 · #ff8585 7.2:1.
const css = readFileSync(new URL('./styles/radio.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

const EXPECTED = {
  loading: ['#e8eaed'],
  degraded: ['#ffad72'],
  stale: ['#ffd27a'],
  partial: ['#ffd27a'],
  fallback: ['#ffd27a'],
  unavailable: ['#ff8585'],
};

for (const [state, colors] of Object.entries(EXPECTED)) {
  test(`GM-13: off-state .feed-${state} declares an explicit contrast-safe color`, () => {
    const blocks = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // Strip :not(...) groups so the :not(.active) scoping of the fix is
      // not mistaken for an .active requirement.
      const sel = m[1].replace(/:not\([^)]*\)/g, '');
      if (new RegExp(`\\.data-toggle-btn\\.feed-${state}\\b`).test(sel) && !/\.active/.test(sel)) {
        blocks.push(m[2]);
      }
    }
    assert.ok(blocks.length > 0, `no off-state .feed-${state} rule found`);
    const declared = blocks
      .map((b) => (b.match(/(?:^|;)\s*color\s*:\s*([^;]+)/) || [])[1])
      .filter(Boolean)
      .map((c) => c.trim().toLowerCase());
    // FAIL-OLD: on the fault CSS the only non-.active feed rule declares
    // min-width + letter-spacing and NO color (inherits --text-dim, 2.45:1).
    assert.ok(
      declared.length > 0,
      `.feed-${state} off-state declares no color — inherits failing --text-dim`,
    );
    assert.ok(
      !declared.some((c) => c.includes('--text-dim')),
      `.feed-${state} still inherits the failing --text-dim`,
    );
    assert.ok(
      declared.some((c) => colors.some((ok) => c.includes(ok))),
      `.feed-${state} color ${declared} not one of the contrast-verified ${colors}`,
    );
  });
}
