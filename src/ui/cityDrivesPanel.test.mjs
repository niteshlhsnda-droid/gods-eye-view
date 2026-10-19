import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CityDrivesPanel } from './cityDrivesPanel.js';
import { CITY_DRIVES } from '../data/cityDrives.js';

function fakeElement(tag) {
  const children = [];
  const el = {
    tagName: String(tag).toUpperCase(),
    children,
    dataset: {},
    parentNode: null,
    _attrs: {},
    _classSet: new Set(),
    _listeners: {},
    textContent: '',
    value: '',
    style: {},
    src: '',
    paused: false,
    setAttribute(key, value) {
      this._attrs[key] = String(value);
    },
    getAttribute(key) {
      return this._attrs[key] ?? null;
    },
    removeAttribute(key) {
      delete this._attrs[key];
    },
    appendChild(child) {
      children.push(child);
      child.parentNode = el;
      return child;
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      return child;
    },
    addEventListener(type, fn) {
      (this._listeners[type] ??= []).push(fn);
    },
    click() {
      for (const fn of this._listeners.click ?? [])
        fn({ currentTarget: el });
    },
    pause() {
      this.paused = true;
    },
    get firstChild() {
      return children[0] ?? null;
    },
    classList: {
      add: (...names) => names.forEach((n) => el._classSet.add(n)),
      remove: (...names) => names.forEach((n) => el._classSet.delete(n)),
      contains: (n) => el._classSet.has(n),
    },
  };
  Object.defineProperty(el, 'className', {
    get: () => [...el._classSet].join(' '),
    set: (value) =>
      (el._classSet = new Set(
        String(value).split(/\s+/).filter(Boolean),
      )),
  });
  return el;
}

const fakeDocument = { createElement: (tag) => fakeElement(tag) };

function findButtons(root, classFragment) {
  const found = [];
  const walk = (node) => {
    if (
      node.tagName === 'BUTTON' &&
      node.className.split(' ').some((c) => c.includes(classFragment))
    ) {
      found.push(node);
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return found;
}

function findLinks(root) {
  const found = [];
  const walk = (node) => {
    if (node.tagName === 'A') found.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return found;
}

function findIframes(root) {
  const found = [];
  const walk = (node) => {
    if (node.tagName === 'IFRAME') found.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return found;
}

function findAudios(root) {
  const found = [];
  const walk = (node) => {
    if (node.tagName === 'AUDIO') found.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return found;
}

function textOf(root) {
  let text = root.textContent || '';
  for (const child of root.children ?? []) text += ' ' + textOf(child);
  return text;
}

const flush = async (rounds = 5) => {
  for (let i = 0; i < rounds; i += 1) await new Promise(setImmediate);
};

function makePanel(overrides = {}) {
  const root = fakeElement('div');
  const calls = { flyTo: [] };
  const panel = new CityDrivesPanel({
    document: fakeDocument,
    root,
    flyTo: (...args) => calls.flyTo.push(args),
    resolveStream: overrides.resolveStream ?? (async () => null),
    openExternal: (...args) => (calls.openExternal ??= []).push(args),
    ...overrides,
  });
  panel.connect();
  return { panel, root, calls };
}

test('renders one button per city and a four-link credit footer', () => {
  const { root } = makePanel();
  const buttons = findButtons(root, 'city-drives-city');
  assert.equal(buttons.length, CITY_DRIVES.length);
  assert.equal(buttons[0].textContent, 'Delhi · India');
  const links = findLinks(root);
  const hrefs = links.map((l) => l.getAttribute('href'));
  assert.ok(hrefs.includes('https://driveandlisten.app/'));
  assert.ok(hrefs.includes('https://drivefromhome.com/'));
  assert.ok(hrefs.includes('https://radio.garden/'));
  assert.ok(hrefs.includes('https://www.radio-browser.info/'));
});

test('search filters the city list and updates the count', () => {
  const { root } = makePanel();
  const search = [];
  const walk = (node) => {
    if (node.className.split(' ').includes('city-drives-search'))
      search.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  assert.equal(search.length, 1);
  const input = search[0];
  input.value = 'japan';
  for (const fn of input._listeners.input ?? []) fn();
  const buttons = findButtons(root, 'city-drives-city');
  const visible = buttons.filter((b) => b.style.display !== 'none');
  assert.ok(visible.length >= 1, 'expected at least one Japan match');
  assert.ok(
    visible.every((b) =>
      b.dataset.cityDriveSearch.includes('japan'),
    ),
    'every visible button must match the query',
  );
  assert.ok(buttons.length > visible.length, 'non-matches must hide');
});

test('selectCity flies the camera and shows an honestly-labeled drive pane', () => {
  const { panel, root, calls } = makePanel();
  assert.equal(panel.selectCity('delhi'), true);
  assert.deepEqual(calls.flyTo[0].slice(0, 2), [28.6139, 77.209]);
  const frames = findIframes(root);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].getAttribute('src'), 'https://driveandlisten.app/city/delhi');
  const text = textOf(root);
  assert.ok(text.includes('Recorded drive-through (not live)'));
  assert.ok(!text.includes('Live drive'), 'drives must never be labeled live');
  const external = findLinks(root).find((l) =>
    (l.getAttribute('href') || '').includes('driveandlisten.app/city/delhi'),
  );
  assert.ok(external, 'open-on-driveandlisten.app fallback link present');
});

test('clicking a city button selects that city', () => {
  const { panel, root } = makePanel();
  const tokyo = findButtons(root, 'city-drives-city').find(
    (b) => b.dataset.cityDriveId === 'tokyo',
  );
  tokyo.click();
  assert.equal(panel.selectedId, 'tokyo');
  assert.equal(findIframes(root)[0].getAttribute('src'), 'https://driveandlisten.app/city/tokyo');
});

test('selectCity returns false for unknown ids', () => {
  const { panel } = makePanel();
  assert.equal(panel.selectCity('atlantis'), false);
  assert.equal(panel.selectedId, null);
});

test('Live Radio tab resolves a stream and renders an audio element', async () => {
  const { root } = makePanel({
    resolveStream: async (name) => ({
      stationName: `${name} FM`,
      streamUrl: 'https://example.test/live.mp3',
    }),
  });
  // Select a city first so the card (and its tabs) exists.
  findButtons(root, 'city-drives-city')
    .find((b) => b.dataset.cityDriveId === 'paris')
    .click();
  const radioTab = findButtons(root, 'city-drives-tab').find(
    (b) => b.textContent === 'Live Radio',
  );
  radioTab.click();
  await flush();
  const audios = findAudios(root);
  assert.equal(audios.length, 1);
  assert.equal(audios[0].src, 'https://example.test/live.mp3');
  assert.ok(textOf(root).includes('Paris FM'));
  assert.ok(textOf(root).includes('Live'));
});

test('Live Radio tab reports when no stream is found', async () => {
  const { root } = makePanel({ resolveStream: async () => null });
  findButtons(root, 'city-drives-city')
    .find((b) => b.dataset.cityDriveId === 'paris')
    .click();
  findButtons(root, 'city-drives-tab')
    .find((b) => b.textContent === 'Live Radio')
    .click();
  await flush();
  assert.ok(textOf(root).includes('No live stream found for Paris'));
});

test('close() stops audio and switching cities drops the old audio', async () => {
  const { panel, root } = makePanel({
    resolveStream: async () => ({
      stationName: 'X',
      streamUrl: 'https://example.test/x.mp3',
    }),
  });
  findButtons(root, 'city-drives-city')
    .find((b) => b.dataset.cityDriveId === 'berlin')
    .click();
  findButtons(root, 'city-drives-tab')
    .find((b) => b.textContent === 'Live Radio')
    .click();
  await flush();
  const audio = findAudios(root)[0];
  assert.ok(audio, 'audio rendered');
  panel.close();
  assert.equal(audio.paused, true, 'audio paused on close');
  // Reopen, pick another city: old audio must not linger.
  panel.open();
  findButtons(root, 'city-drives-city')
    .find((b) => b.dataset.cityDriveId === 'seoul')
    .click();
  assert.equal(findAudios(root).length, 0, 'old audio removed on city switch');
});
