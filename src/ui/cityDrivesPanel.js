/**
 * City Drives panel — virtual drive-throughs + live local radio from the globe.
 *
 * Self-contained widget: renders a city list, a two-tab card (Drive / Live Radio)
 * and a credit footer. Wired by applicationShell._initCityDrivesPanel() into the
 * right panel stack like the street-level panel.
 *
 * Honest-label rule: the drive footage on driveandlisten.app is RECORDED dashcam
 * clips, not live. The Drive tab is always labeled "Recorded drive-through (not
 * live)". Only the radio tab is labeled "Live".
 */
import {
  CITY_DRIVES,
  SOURCE_CREDITS,
  driveUrlFor,
  cityDriveById,
} from '../data/cityDrives.js';
import { resolveCityStream } from '../data/cityDriveRadio.js';

const PANEL_ID = 'city-drives-panel';

function el(doc, tag, attrs = {}, children = []) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === 'className') node.className = value;
    else if (key === 'textContent') node.textContent = value;
    else if (key === 'htmlFor') node.htmlFor = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child != null) node.appendChild(child);
  }
  return node;
}

function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

/** City Drives card; the caller owns panel chrome (collapse/dock) around it. */
export class CityDrivesPanel {
  constructor({
    document: doc = globalThis.document,
    root,
    cities = CITY_DRIVES,
    credits = SOURCE_CREDITS,
    flyTo = null,
    resolveStream = resolveCityStream,
    openExternal = (url) => window.open(url, '_blank', 'noopener'),
  } = {}) {
    this._doc = doc;
    this._root = root || null;
    this._cities = cities;
    this._credits = credits;
    this._flyTo = flyTo;
    this._resolveStream = resolveStream;
    this._openExternal = openExternal;
    this._disposed = false;
    this._selectedId = null;
    this._activeTab = 'drive';
    this._radioState = new Map(); // cityId -> 'idle' | 'resolving' | 'ready' | 'failed'
    this._audio = null;
    this._nodes = {};
    this._onCityButton = (event) => {
      const id = event?.currentTarget?.dataset?.cityDriveId;
      if (id) this.selectCity(id);
    };
  }

  get selectedId() {
    return this._selectedId;
  }

  get panelId() {
    return PANEL_ID;
  }

  connect() {
    if (this._disposed || !this._root || this._connected) return;
    this._connected = true;
    this._render();
  }

  destroy() {
    this._disposed = true;
    this._stopAudio();
    if (this._inner?.parentNode) {
      try {
        this._inner.parentNode.removeChild(this._inner);
      } catch {
        /* best effort */
      }
    }
    this._inner = null;
    this._root = null;
    this._nodes = {};
  }

  open() {
    this._root?.classList?.remove('collapsed');
  }

  close() {
    this._stopAudio();
    this._root?.classList?.add('collapsed');
  }

  /**
   * Direct-drive mode: search → tap 🚗 → the drive starts, no city list.
   * Selects the city (fly + Drive tab) and switches the panel to player
   * mode, where the card leads and the browse list is hidden.
   */
  playCity(id) {
    const ok = this.selectCity(id);
    if (!ok) return false;
    this._root?.classList?.add('city-drives-player-mode');
    const card = this._nodes?.card;
    if (card && typeof card.scrollIntoView === 'function') {
      try {
        card.scrollIntoView({ block: 'nearest' });
      } catch {
        /* best effort */
      }
    }
    return true;
  }

  /** Back to the browse list (fallback when no drive matches). */
  browseMode() {
    this._root?.classList?.remove('city-drives-player-mode');
  }

  /** Pick a city: fly the camera, reset audio, show the Drive tab. */
  selectCity(id) {
    const city = cityDriveById(id) ?? this._cities.find((c) => c.id === id);
    if (!city || this._disposed) return false;
    this._stopAudio();
    this._selectedId = city.id;
    this._activeTab = 'drive';
    // Mark the selected button so it stays visible against 179 siblings.
    const { cityButtons } = this._nodes;
    if (cityButtons) {
      for (const button of cityButtons) {
        button.setAttribute(
          'aria-pressed',
          button.dataset.cityDriveId === city.id ? 'true' : 'false',
        );
      }
    }
    if (typeof this._flyTo === 'function') {
      try {
        this._flyTo(city.lat, city.lon, city);
      } catch {
        /* camera failures must not break the card */
      }
    }
    this._renderCard();
    return true;
  }

  _stopAudio() {
    const audio = this._audio;
    this._audio = null;
    if (!audio) return;
    try {
      audio.pause();
    } catch {
      /* no-op */
    }
    try {
      audio.removeAttribute('src');
    } catch {
      /* no-op */
    }
  }

  _render() {
    const doc = this._doc;
    const root = this._root;
    const inner = el(doc, 'div', { className: 'city-drives-panel-inner' });
    const header = el(doc, 'div', { className: 'panel-header' }, [
      el(doc, 'span', { className: 'panel-title', textContent: 'CITY DRIVES' }),
      el(doc, 'span', { className: 'panel-divider' }),
      el(doc, 'button', {
        className: 'panel-collapse-btn',
        type: 'button',
        'data-collapse-target': PANEL_ID,
        title: 'Collapse panel',
        textContent: '+',
      }),
    ]);
    const body = el(doc, 'div', {
      className: 'city-drives-body',
      'data-rail-scroller': '',
    });
    const search = el(doc, 'input', {
      className: 'city-drives-search',
      type: 'search',
      placeholder: `Search ${this._cities.length} cities…`,
      'aria-label': 'Search drive-through cities',
    });
    const count = el(doc, 'div', {
      className: 'city-drives-count',
      textContent: `${this._cities.length} cities`,
    });
    const list = el(doc, 'div', {
      className: 'city-drives-list',
      role: 'listbox',
      'aria-label': 'Drive-through cities',
    });
    const cityButtons = [];
    for (const city of this._cities) {
      const button = el(doc, 'button', {
        className: 'city-drives-city data-toggle-chip chip-idle',
        type: 'button',
        role: 'option',
        'aria-pressed': 'false',
        textContent: `${city.name} · ${city.country}`,
      });
      button.dataset.cityDriveId = city.id;
      button.dataset.cityDriveSearch =
        `${city.name} ${city.country}`.toLowerCase();
      button.addEventListener('click', this._onCityButton);
      list.appendChild(button);
      cityButtons.push(button);
    }
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      let visible = 0;
      for (const button of cityButtons) {
        const match = q === '' || button.dataset.cityDriveSearch.includes(q);
        button.style.display = match ? '' : 'none';
        if (match) visible += 1;
      }
      count.textContent =
        q === ''
          ? `${this._cities.length} cities`
          : `${visible} of ${this._cities.length} cities`;
    });
    const card = el(doc, 'div', { className: 'city-drives-card', hidden: '' });
    const footer = this._renderFooter();
    body.appendChild(search);
    body.appendChild(count);
    body.appendChild(list);
    body.appendChild(card);
    body.appendChild(footer);
    inner.appendChild(header);
    inner.appendChild(body);
    root.appendChild(inner);
    this._nodes = { list, card, footer, body, search, count, cityButtons };
    this._inner = inner;
    this._renderCard();
  }

  _renderFooter() {
    const doc = this._doc;
    const footer = el(doc, 'div', { className: 'city-drives-credits' });
    footer.appendChild(el(doc, 'span', { textContent: 'Drive footage: ' }));
    this._credits.forEach((credit, index) => {
      if (index > 0)
        footer.appendChild(el(doc, 'span', { textContent: ' · ' }));
      const link = el(doc, 'a', {
        href: credit.url,
        target: '_blank',
        rel: 'noopener',
        title: credit.note,
        textContent: credit.name,
      });
      footer.appendChild(link);
    });
    return footer;
  }

  _renderCard() {
    const { card } = this._nodes;
    if (!card) return;
    while (card.firstChild) card.removeChild(card.firstChild);
    const city = this._selectedId
      ? (cityDriveById(this._selectedId) ??
        this._cities.find((c) => c.id === this._selectedId))
      : null;
    if (!city) {
      card.setAttribute('hidden', '');
      return;
    }
    card.removeAttribute('hidden');
    const doc = this._doc;
    const title = el(doc, 'div', {
      className: 'city-drives-card-title',
      textContent: `${city.name}, ${city.country}`,
    });
    const tabs = el(doc, 'div', {
      className: 'city-drives-tabs',
      role: 'tablist',
    });
    const driveTab = el(doc, 'button', {
      className: `city-drives-tab${this._activeTab === 'drive' ? ' active' : ''}`,
      type: 'button',
      role: 'tab',
      textContent: 'Drive',
    });
    const radioTab = el(doc, 'button', {
      className: `city-drives-tab${this._activeTab === 'radio' ? ' active' : ''}`,
      type: 'button',
      role: 'tab',
      textContent: 'Live Radio',
    });
    driveTab.addEventListener('click', () => this._setTab('drive'));
    radioTab.addEventListener('click', () => this._setTab('radio'));
    tabs.appendChild(driveTab);
    tabs.appendChild(radioTab);
    const pane = el(doc, 'div', { className: 'city-drives-pane' });
    card.appendChild(title);
    card.appendChild(tabs);
    card.appendChild(pane);
    this._nodes.pane = pane;
    this._renderPane(city);
  }

  _setTab(tab) {
    if (this._activeTab === tab || this._disposed) return;
    this._activeTab = tab;
    if (tab === 'drive') this._stopAudio();
    this._renderCard();
  }

  _renderPane(city) {
    const pane = this._nodes.pane;
    if (!pane) return;
    if (this._activeTab === 'drive') this._renderDrivePane(pane, city);
    else this._renderRadioPane(pane, city);
  }

  _renderDrivePane(pane, city) {
    const doc = this._doc;
    const label = el(doc, 'div', {
      className: 'city-drives-honesty-label',
      textContent: 'Recorded drive-through (not live)',
    });
    const frame = el(doc, 'iframe', {
      class: 'city-drives-frame',
      src: driveUrlFor(city),
      title: `Recorded drive-through of ${city.name} (Drive & Listen)`,
      loading: 'lazy',
      allow: 'autoplay; fullscreen',
    });
    frame.className = 'city-drives-frame';
    const openLink = el(doc, 'a', {
      className: 'city-drives-open-external',
      href: driveUrlFor(city),
      target: '_blank',
      rel: 'noopener',
      textContent: `Open on driveandlisten.app ↗`,
    });
    openLink.addEventListener('click', (event) => {
      // Let modifier-clicks behave natively; plain clicks use the opener hook.
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      this._openExternal(driveUrlFor(city));
    });
    pane.appendChild(label);
    pane.appendChild(frame);
    pane.appendChild(openLink);
  }

  _renderRadioPane(pane, city) {
    const doc = this._doc;
    const label = el(doc, 'div', {
      className: 'city-drives-honesty-label city-drives-live-label',
      textContent: 'Live',
    });
    const status = el(doc, 'div', { className: 'city-drives-radio-status' });
    pane.appendChild(label);
    pane.appendChild(status);
    const state = this._radioState.get(city.id) ?? 'idle';
    if (state === 'ready' && this._audio) {
      setText(status, '');
      status.appendChild(this._stationLine(city));
      status.appendChild(this._audio);
      return;
    }
    if (state === 'failed') {
      setText(
        status,
        `No live stream found for ${city.name}. Try another city.`,
      );
      return;
    }
    setText(status, 'Resolving a live station…');
    this._radioState.set(city.id, 'resolving');
    const token = { cancelled: false };
    this._radioToken = token;
    Promise.resolve()
      .then(() => this._resolveStream(city.name))
      .then((result) => {
        if (token.cancelled || this._disposed || this._selectedId !== city.id)
          return;
        if (!result?.streamUrl) {
          this._radioState.set(city.id, 'failed');
          this._renderCard();
          return;
        }
        const audio = doc.createElement('audio');
        audio.setAttribute('controls', '');
        audio.setAttribute('preload', 'none');
        audio.src = result.streamUrl;
        audio.dataset.stationName = result.stationName || city.name;
        this._audio = audio;
        this._radioState.set(city.id, 'ready');
        this._renderCard();
      })
      .catch(() => {
        if (token.cancelled || this._disposed) return;
        this._radioState.set(city.id, 'failed');
        this._renderCard();
      });
  }

  _stationLine(city) {
    const doc = this._doc;
    const name = this._audio?.dataset?.stationName || city.name;
    return el(doc, 'div', {
      className: 'city-drives-station',
      textContent: `Now tuned: ${name}`,
    });
  }
}

export { PANEL_ID as CITY_DRIVES_PANEL_ID };
