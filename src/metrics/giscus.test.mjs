import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GISCUS_CLIENT_SRC,
  GISCUS_CONFIG_DEFAULT,
  isGiscusConfigured,
  mountGiscus,
  resolveGiscusConfig,
} from './giscus.js';

test('default config is disabled and placeholder-based', () => {
  assert.equal(GISCUS_CONFIG_DEFAULT.enabled, false);
  assert.equal(isGiscusConfigured(GISCUS_CONFIG_DEFAULT), false);
  assert.equal(isGiscusConfigured(), false);
  assert.equal(isGiscusConfigured(null), false);
});

test('isGiscusConfigured requires real identifiers', () => {
  assert.equal(
    isGiscusConfigured({
      enabled: true,
      repo: 'niteshlhsnda-droid/gods-eye-view',
      repoId: 'R_kgD0',
      categoryId: 'DIC_kwD0',
    }),
    true,
  );
  // Enabled but placeholders left in place → not configured.
  assert.equal(
    isGiscusConfigured({
      enabled: true,
      repo: 'OWNER/REPO',
      repoId: 'R_kgD0',
      categoryId: 'DIC_kwD0',
    }),
    false,
  );
  assert.equal(
    isGiscusConfigured({
      enabled: true,
      repo: 'niteshlhsnda-droid/gods-eye-view',
      repoId: '',
      categoryId: 'DIC_kwD0',
    }),
    false,
  );
  // Identifiers present but explicitly disabled → not configured.
  assert.equal(
    isGiscusConfigured({
      enabled: false,
      repo: 'niteshlhsnda-droid/gods-eye-view',
      repoId: 'R_kgD0',
      categoryId: 'DIC_kwD0',
    }),
    false,
  );
});

test('resolveGiscusConfig merges overrides over frozen defaults', () => {
  const config = resolveGiscusConfig({ enabled: true, theme: 'light' });
  assert.equal(config.enabled, true);
  assert.equal(config.theme, 'light');
  assert.equal(config.mapping, GISCUS_CONFIG_DEFAULT.mapping);
  assert.ok(Object.isFrozen(config));
  assert.equal(GISCUS_CONFIG_DEFAULT.enabled, false);
});

test('mountGiscus no-ops until configured', () => {
  assert.deepEqual(mountGiscus(null, {}), {
    ok: false,
    reason: 'not-configured',
  });
  assert.deepEqual(mountGiscus(null, { enabled: true }), {
    ok: false,
    reason: 'not-configured',
  });
});

function makeHost() {
  const appended = [];
  const script = {
    src: '',
    async: false,
    attributes: {},
    setAttribute(key, value) {
      script.attributes[key] = value;
    },
  };
  return {
    appended,
    script,
    ownerDocument: { createElement: () => script },
    appendChild: (node) => appended.push(node),
  };
}

test('mountGiscus injects the giscus client when configured', () => {
  const host = makeHost();
  const result = mountGiscus(host, {
    enabled: true,
    repo: 'niteshlhsnda-droid/gods-eye-view',
    repoId: 'R_kgD0PLACEHOLDER',
    categoryId: 'DIC_kwD0PLACEHOLDER',
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(host.appended.length, 1);
  assert.equal(host.script.src, GISCUS_CLIENT_SRC);
  assert.equal(host.script.async, true);
  assert.equal(
    host.script.attributes['data-repo'],
    'niteshlhsnda-droid/gods-eye-view',
  );
  assert.equal(host.script.attributes['data-repo-id'], 'R_kgD0PLACEHOLDER');
});
