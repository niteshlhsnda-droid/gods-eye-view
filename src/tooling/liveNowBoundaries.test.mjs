import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkImportDirections } from '../../scripts/check-import-directions.mjs';
import { checkPackageBoundaries } from '../../scripts/check-package-boundaries.mjs';

/**
 * Live Now module-boundary contract (spec §4.4, §6.6):
 *  - src/livenow/* is browser code: it must never import server code
 *    (server/providers/livenow/* included) or Node builtins.
 *  - server/providers/livenow/* is server code: it must never leak into the
 *    client bundle — the browser boundary group owns only client modules, so
 *    any server file in the browser build graph is an unowned-module error.
 *
 * The fixture tests below pin the checker behavior on this contract; the final
 * test pins the real registration once the lanes land their modules.
 */

const REPO = fileURLToPath(new URL('../../', import.meta.url));

function directionsFixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gev-livenow-dir-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const write = (name, source = '') => {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), source);
  };
  write(
    'package.json',
    JSON.stringify({ name: '@gods-eye-view/core', exports: {} }),
  );
  write('src/data/feedState.js');
  return { root, write };
}

function boundaryFixture(t, { pkg, groups, files }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gev-livenow-pb-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'livenow-fixture', type: 'module', ...pkg }),
  );
  writeFileSync(
    path.join(root, 'scripts/package-boundaries.json'),
    JSON.stringify(groups),
  );
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), source);
  }
  return root;
}

test('browser Live Now code cannot import server Live Now code', (t) => {
  const { root, write } = directionsFixture(t);
  write(
    'src/livenow/panel.js',
    "import { fetchEvents } from '../../server/providers/livenow/ingest.js';\nexport const panel = fetchEvents;\n",
  );
  write(
    'server/providers/livenow/ingest.js',
    'export const fetchEvents = async () => [];\n',
  );
  assert.throws(
    () => checkImportDirections(root),
    /src\/livenow\/panel\.js: Browser imports server: server\/providers\/livenow\/ingest\.js/,
  );
});

test('browser Live Now code cannot use Node builtins', (t) => {
  const { root, write } = directionsFixture(t);
  write(
    'src/livenow/cache.js',
    "import fs from 'node:fs';\nexport const cache = fs;\n",
  );
  assert.throws(
    () => checkImportDirections(root),
    /src\/livenow\/cache\.js: Node builtin in browser module: node:fs/,
  );
});

test('clean browser Live Now code passes import directions', (t) => {
  const { root, write } = directionsFixture(t);
  write(
    'src/livenow/panel.js',
    "import { card } from './card.js';\nexport const panel = card;\n",
  );
  write('src/livenow/card.js', 'export const card = {};\n');
  write(
    'server/providers/livenow/ingest.js',
    "import http from 'node:http';\nexport const fetchEvents = async () => http;\n",
  );
  const report = checkImportDirections(root);
  assert.equal(report.modules, 4);
});

test('a browser boundary build rejects server Live Now modules as unowned', async (t) => {
  const root = boundaryFixture(t, {
    pkg: {
      exports: {
        './livenow': './src/livenow/index.js',
        './server/providers/livenow': {
          node: './server/providers/livenow/ingest.js',
        },
      },
    },
    groups: {
      livenow: {
        exports: ['./livenow'],
        modules: ['src/livenow/index.js', 'src/livenow/card.js'],
        external: [],
      },
      'livenow-server': {
        runtime: 'node',
        exports: ['./server/providers/livenow'],
        modules: ['server/providers/livenow/ingest.js'],
        external: [],
      },
    },
    files: {
      // The client entry smuggles server code in: the browser build must fail.
      'src/livenow/index.js':
        "export { fetchEvents } from '../../server/providers/livenow/ingest.js';\n",
      'src/livenow/card.js': 'export const card = {};\n',
      'server/providers/livenow/ingest.js':
        'export const fetchEvents = async () => [];\n',
    },
  });
  await assert.rejects(
    checkPackageBoundaries(root),
    /Package boundary livenow imports an unowned module: .*server\/providers\/livenow\/ingest\.js/,
  );
});

test('a server boundary build rejects client rendering modules as unowned', async (t) => {
  const root = boundaryFixture(t, {
    pkg: {
      exports: {
        './livenow': './src/livenow/index.js',
        './server/providers/livenow': {
          node: './server/providers/livenow/ingest.js',
        },
      },
    },
    groups: {
      livenow: {
        exports: ['./livenow'],
        modules: ['src/livenow/index.js'],
        external: [],
      },
      'livenow-server': {
        runtime: 'node',
        exports: ['./server/providers/livenow'],
        modules: ['server/providers/livenow/ingest.js'],
        external: [],
      },
    },
    files: {
      'src/livenow/index.js': 'export const panel = {};\n',
      // The provider pulls a client module in: the node build must fail.
      'server/providers/livenow/ingest.js':
        "export { panel } from '../../../src/livenow/index.js';\n",
    },
  });
  await assert.rejects(
    checkPackageBoundaries(root),
    /Package boundary livenow-server imports an unowned module: .*src\/livenow\/index\.js/,
  );
});

test('node-only server Live Now export with shared portable modules builds', async (t) => {
  const root = boundaryFixture(t, {
    pkg: {
      exports: {
        './server/providers/livenow': {
          node: './server/providers/livenow/ingest.js',
        },
      },
    },
    groups: {
      'livenow-server': {
        runtime: 'node',
        exports: ['./server/providers/livenow'],
        modules: [
          'server/providers/livenow/ingest.js',
          'src/sources/httpBody.js',
        ],
        external: [],
      },
    },
    files: {
      'server/providers/livenow/ingest.js':
        "export { body } from '../../../src/sources/httpBody.js';\n",
      'src/sources/httpBody.js': 'export const body = {};\n',
    },
  });
  const report = await checkPackageBoundaries(root);
  assert.deepEqual(report, [
    { name: 'livenow-server', exports: 1, modules: 2 },
  ]);
});

test('livenow modules are registered in the boundary system once they land', (t) => {
  const clientEntry = path.join(REPO, 'src/livenow/index.js');
  const serverEntry = path.join(REPO, 'server/providers/livenow/ingest.js');
  if (!existsSync(clientEntry) || !existsSync(serverEntry)) {
    t.skip(
      'livenow modules not landed yet (DeepSeek/Gemini lanes pending) — registration contract: package.json exports "./livenow" (browser) and "./server/providers/livenow" (node-only), groups "livenow" and "livenow-server" in scripts/package-boundaries.json',
    );
    return;
  }
  const pkg = JSON.parse(
    readFileSync(path.join(REPO, 'package.json'), 'utf8'),
  );
  const groups = JSON.parse(
    readFileSync(path.join(REPO, 'scripts/package-boundaries.json'), 'utf8'),
  );
  assert.equal(
    pkg.exports['./livenow'],
    './src/livenow/index.js',
    'client entry must be a browser package export',
  );
  assert.deepEqual(
    pkg.exports['./server/providers/livenow'],
    { node: './server/providers/livenow/ingest.js' },
    'server entry must be a node-only package export',
  );
  assert.ok(
    groups['livenow'] && groups['livenow'].runtime !== 'node',
    'browser boundary group "livenow" must be registered',
  );
  assert.equal(
    groups['livenow-server']?.runtime,
    'node',
    'node boundary group "livenow-server" must be registered',
  );
});
