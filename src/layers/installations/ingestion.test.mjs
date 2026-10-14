import test from 'node:test';
import assert from 'node:assert/strict';

import { createIngestion } from './ingestion.js';
import { needsDesktopServerError } from '../../sources/needsDesktopServer.js';

const box = { south: 30.1, west: -97.9, north: 30.3, east: -97.6 };

/** Minimal harness for the Google text-search half of a load. */
function setup({ searchNearby }) {
  const layerState = {
    enabled: true,
    viewer: {},
    abort: null,
    loading: false,
    googleSearchRequested: true,
    records: [],
    status: null,
    error: null,
  };
  const parts = {
    viewport: {
      loadArea: () => ({ box, coverage: { kind: 'viewport' } }),
      clearUnavailableRetry: () => {},
      scheduleUnavailableRetry: () => {},
    },
    model: {
      installationWithinViewport: () => true,
      classifyGoogleMilitaryPlace: () => 'military_land',
    },
    rendering: {
      renderRecords: () => {},
      warmInstallationFloors: () => {},
    },
  };
  const services = {
    render: { governorRequestRender: () => {} },
    ground: { resolveGroundFloorCellsBounded: async () => ({}) },
  };
  const source = {
    getMappedSites: async () => ({
      records: [],
      status: 'ready',
      saturated: false,
    }),
    searchNearby,
  };
  const { loadInstallations } = createIngestion({
    state: layerState,
    services,
    parts,
    source,
  });
  return { layerState, loadInstallations };
}

test('static hosting: Google text search failure names the desktop server, mapped sites still render', async () => {
  const { layerState, loadInstallations } = setup({
    searchNearby: async () => {
      throw needsDesktopServerError('Google Places text search');
    },
  });
  await loadInstallations();
  // The Overpass half still resolved: the layer is empty-but-ready, not broken.
  assert.equal(layerState.status, 'empty');
  assert.match(
    layerState.error,
    /Google Places text search needs the desktop server; showing mapped sites/,
  );
});

test('ordinary Google search failures keep the transient message', async () => {
  const { layerState, loadInstallations } = setup({
    searchNearby: async () => {
      throw new Error('Google Places HTTP 500');
    },
  });
  await loadInstallations();
  assert.equal(layerState.status, 'empty');
  assert.equal(
    layerState.error,
    'Google Places search unavailable; showing mapped sites',
  );
});
