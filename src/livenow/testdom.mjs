/**
 * Minimal fake DOM for Live Now unit tests (node --test, no browser).
 * Covers exactly what src/livenow/* touches: createElement, classList,
 * dataset, attributes, listeners, append/remove, querySelector, focus.
 */

function makeClassList() {
  const set = new Set();
  return {
    add: (...names) => names.forEach((n) => set.add(n)),
    remove: (...names) => names.forEach((n) => set.delete(n)),
    contains: (n) => set.has(n),
    toggle: (n, force) => {
      const on = force === undefined ? !set.has(n) : Boolean(force);
      if (on) set.add(n);
      else set.delete(n);
      return on;
    },
    toString: () => [...set].join(' '),
  };
}

export function makeElement(tag = 'div') {
  const classes = makeClassList();
  const listeners = new Map();
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    dataset: {},
    attributes: {},
    classList: classes,
    textContent: '',
    tabIndex: -1,
    hidden: false,
    parent: null,
    focused: false,
    id: '',
    addEventListener(name, cb) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(cb);
    },
    removeEventListener(name, cb) {
      listeners.get(name)?.delete(cb);
    },
    fire(name, event = {}) {
      for (const cb of [...(listeners.get(name) || [])]) cb(event);
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    appendChild(child) {
      this.children.push(child);
      child.parent = this;
      return child;
    },
    append(...children) {
      for (const child of children)
        if (child && typeof child === 'object') this.appendChild(child);
    },
    remove() {
      if (this.parent)
        this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    },
    querySelector(selector) {
      const all = this.querySelectorAll(selector);
      return all[0] ?? null;
    },
    querySelectorAll(selector) {
      const matches = (el) => {
        if (selector.startsWith('.'))
          return el.classList.contains(selector.slice(1));
        if (selector.startsWith('#')) return el.id === selector.slice(1);
        return el.tagName === selector.toUpperCase();
      };
      const out = [];
      const walk = (el) => {
        for (const child of el.children) {
          if (matches(child)) out.push(child);
          walk(child);
        }
      };
      walk(this);
      return out;
    },
    focus() {
      this.focused = true;
    },
  };
  // Real DOM keeps className and classList in sync; mirror that here.
  Object.defineProperty(node, 'className', {
    get: () => classes.toString(),
    set: (value) => {
      for (const name of classes.toString().split(' ').filter(Boolean))
        classes.remove(name);
      String(value || '')
        .split(/\s+/)
        .filter(Boolean)
        .forEach((name) => classes.add(name));
    },
    enumerable: true,
    configurable: true,
  });
  node.className = '';
  return node;
}

export function makeDocument() {
  const listeners = new Map();
  const head = makeElement('head');
  const body = makeElement('body');
  const root = makeElement('html');
  root.append(head, body);
  const doc = {
    head,
    body,
    documentElement: root,
    defaultView: {
      addEventListener() {},
      removeEventListener() {},
    },
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => {
      const walk = (el) => {
        if (el.id === id) return el;
        for (const child of el.children) {
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(root);
    },
    getElementsByTagName: (tag) => (tag.toLowerCase() === 'head' ? [head] : []),
    addEventListener(name, cb) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(cb);
    },
    removeEventListener(name, cb) {
      listeners.get(name)?.delete(cb);
    },
    fire(name, event = {}) {
      for (const cb of [...(listeners.get(name) || [])]) cb(event);
    },
    listenerCount(name) {
      return listeners.get(name)?.size ?? 0;
    },
  };
  return doc;
}

/** In-memory storage stub (sessionStorage shape). */
export function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}
