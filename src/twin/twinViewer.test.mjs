import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTwinSession,
  resolveSceneConfig,
  viewerFactoryFromModule,
  twinPlaceholderCopy,
  TWIN_STATES,
} from './twinViewer.js';

const goodScene = () => ({ sceneUrl: 'https://example.com/city/patna.ksplat' });

const stubFactory = ({ fail = false } = {}) => (options) => ({
  options,
  started: false,
  disposed: false,
  async addSplatScene(url, sceneOptions) {
    this.url = url;
    this.sceneOptions = sceneOptions;
    if (fail) throw new Error('fetch failed');
  },
  start() {
    this.started = true;
  },
  dispose() {
    this.disposed = true;
  },
});

test('resolveSceneConfig accepts ply/splat/ksplat http(s) URLs', () => {
  for (const ext of ['.ply', '.splat', '.ksplat']) {
    const resolved = resolveSceneConfig({ sceneUrl: `https://example.com/a${ext}` });
    assert.ok(resolved.sceneUrl.startsWith('https://example.com/a'));
    assert.deepEqual(resolved.position, [0, 1, 0]);
  }
});

test('resolveSceneConfig rejects bad URLs and formats', () => {
  assert.throws(() => resolveSceneConfig({ sceneUrl: 'ftp://x/y.ply' }), /http/);
  assert.throws(() => resolveSceneConfig({ sceneUrl: 'https://x/model.obj' }), /unsupported scene format/);
  assert.throws(() => resolveSceneConfig({ sceneUrl: 'https://[invalid' }), /valid URL/);
  assert.deepEqual(resolveSceneConfig({}), { sceneUrl: null });
});

test('createTwinSession moves empty → loading → ready on success', async () => {
  const seen = [];
  const created = [];
  const session = createTwinSession({
    viewerFactory: (options) => {
      const viewer = stubFactory()(options);
      created.push(viewer);
      return viewer;
    },
    container: {},
    onState: (state) => seen.push(state.state),
  });
  await session.mount(goodScene());
  assert.deepEqual(session.state(), {
    state: 'ready',
    sceneUrl: 'https://example.com/city/patna.ksplat',
    error: null,
  });
  assert.deepEqual(seen, ['empty', 'loading', 'ready']);
  assert.equal(created[0].started, true);
  assert.equal(created[0].url, 'https://example.com/city/patna.ksplat');
  session.unmount();
  assert.equal(session.state().state, 'empty');
  assert.equal(created[0].disposed, true);
});

test('createTwinSession surfaces load failures as error state', async () => {
  const seen = [];
  const session = createTwinSession({
    viewerFactory: stubFactory({ fail: true }),
    container: {},
    onState: (state) => seen.push(state),
  });
  await session.mount(goodScene());
  assert.equal(session.state().state, 'error');
  assert.match(session.state().error, /fetch failed/);
  assert.equal(seen.at(-1).state, 'error');
});

test('createTwinSession with no scene URL stays in empty state', async () => {
  let calls = 0;
  const session = createTwinSession({
    viewerFactory: () => {
      calls++;
      return stubFactory()();
    },
    container: {},
  });
  await session.mount({});
  assert.equal(session.state().state, 'empty');
  assert.equal(calls, 0);
});

test('viewerFactoryFromModule requires the GaussianSplats3D module shape', () => {
  assert.throws(() => viewerFactoryFromModule({}), /GaussianSplats3D/);
  const factory = viewerFactoryFromModule({
    Viewer: class {
      constructor(options) {
        this.options = options;
      }
    },
  });
  const viewer = factory({ container: {} });
  assert.ok(viewer.options.container);
});

test('TWIN_STATES documents the full lifecycle', () => {
  assert.deepEqual([...TWIN_STATES], ['empty', 'loading', 'ready', 'error']);
});

test('twinPlaceholderCopy provides consistent UI text', () => {
  const copy = twinPlaceholderCopy();
  assert.ok(copy.title.length > 0 && copy.body.length > 0 && copy.cta.length > 0);
});
