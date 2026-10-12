/**
 * Gaussian-splat digital twin viewer.
 *
 * Integrates the GaussianSplats3D viewer (@mkkellogg/gaussian-splats-3d, MIT)
 * as an in-app "digital twin" panel: a user captures their city/block, hosts
 * the resulting .ply/.splat/.ksplat file, and explores it in the browser.
 *
 * The viewer library is injected (never imported) so this module is testable
 * without the dependency installed; the app passes the real module. When no
 * scene URL is configured the session stays in the 'empty' state and the app
 * renders the placeholder loader — see docs/digital-twin-pipeline.md for the
 * capture pipeline.
 */

export const TWIN_STATES = Object.freeze([
  'empty',
  'loading',
  'ready',
  'error',
]);

export const SUPPORTED_SCENE_FORMATS = Object.freeze([
  '.ply',
  '.splat',
  '.ksplat',
]);

/**
 * Normalize a user-supplied twin scene configuration. Pure.
 * @param {Object} config {sceneUrl, position?, rotation?, scale?, splatAlphaRemovalThreshold?}
 */
export function resolveSceneConfig(config = {}) {
  const { sceneUrl } = config;
  if (sceneUrl == null) return { sceneUrl: null };
  if (typeof sceneUrl !== 'string' || !sceneUrl.trim())
    throw new Error('sceneUrl must be a non-empty string');
  let url;
  try {
    url = new URL(sceneUrl, globalThis.location?.href ?? 'https://localhost/');
  } catch {
    throw new Error('sceneUrl must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('sceneUrl must use http or https');
  const lower = url.pathname.toLowerCase();
  if (!SUPPORTED_SCENE_FORMATS.some((ext) => lower.endsWith(ext)))
    throw new Error(
      `unsupported scene format (expected ${SUPPORTED_SCENE_FORMATS.join(', ')})`,
    );
  return {
    sceneUrl: url.toString(),
    position: config.position ?? [0, 1, 0],
    rotation: config.rotation ?? [0, 0, 0, 1],
    scale: config.scale ?? [1.5, 1.5, 1.5],
    splatAlphaRemovalThreshold: config.splatAlphaRemovalThreshold ?? 5,
    showLoadingUI: config.showLoadingUI ?? true,
  };
}

/**
 * Create a digital-twin viewer session with an explicit lifecycle.
 *
 * @param {Object} options
 * @param {function(Object):Object} options.viewerFactory Builds a GaussianSplats3D
 *   viewer-like object: {addSplatScene(url, opts): Promise, start(): void, dispose(): void}.
 * @param {Object} options.container DOM element the viewer attaches to.
 * @param {function({state:string, sceneUrl:string|null, error?:string}):void} [options.onState]
 * @returns {{state():Object, mount(config:Object):Promise<void>, unmount():void}}
 */
export function createTwinSession({ viewerFactory, container, onState } = {}) {
  if (typeof viewerFactory !== 'function')
    throw new Error('viewerFactory is required');
  if (!container) throw new Error('container is required');

  const session = { state: 'empty', sceneUrl: null, error: null };
  let viewer = null;

  const emit = () =>
    onState?.({
      state: session.state,
      sceneUrl: session.sceneUrl,
      error: session.error,
    });

  return {
    state() {
      return { ...session };
    },
    async mount(config = {}) {
      this.unmount();
      const resolved = resolveSceneConfig(config);
      if (!resolved.sceneUrl) {
        session.state = 'empty';
        session.sceneUrl = null;
        session.error = null;
        emit();
        return;
      }
      session.state = 'loading';
      session.sceneUrl = resolved.sceneUrl;
      session.error = null;
      emit();
      try {
        viewer = viewerFactory({
          container,
          cameraUp: [0, -1, -0.6],
          initialCameraPosition: [-1, -4, 6],
          initialCameraLookAt: [0, 4, 0],
        });
        await viewer.addSplatScene(resolved.sceneUrl, {
          splatAlphaRemovalThreshold: resolved.splatAlphaRemovalThreshold,
          showLoadingUI: resolved.showLoadingUI,
          position: resolved.position,
          rotation: resolved.rotation,
          scale: resolved.scale,
        });
        viewer.start();
        session.state = 'ready';
        session.error = null;
      } catch (error) {
        session.state = 'error';
        session.error = error?.message ?? String(error);
        try {
          viewer?.dispose?.();
        } catch {
          /* best effort */
        }
        viewer = null;
      }
      emit();
    },
    unmount() {
      try {
        viewer?.dispose?.();
      } catch {
        /* best effort */
      }
      viewer = null;
      session.state = 'empty';
      session.sceneUrl = null;
      session.error = null;
      emit();
    },
  };
}

/**
 * Build the GaussianSplats3D viewer factory from the real module.
 * The app calls this once @mkkellogg/gaussian-splats-3d is installed.
 */
export function viewerFactoryFromModule(Splats) {
  if (!Splats || typeof Splats.Viewer !== 'function')
    throw new Error('expected the GaussianSplats3D module (Splats.Viewer)');
  return (options) => new Splats.Viewer(options);
}

/** Placeholder copy for the empty state — kept here so UI text is consistent. */
export function twinPlaceholderCopy() {
  return {
    title: 'Digital twin',
    body: 'Point the app at a Gaussian splat capture of your city to walk through a photorealistic digital twin.',
    cta: 'Load a splat scene',
  };
}
