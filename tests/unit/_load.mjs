// 將 src/core/*.js（+ 指定 games）載入到 globalThis.LG，供 node --test 使用。
// 用法：import { loadLG } from './_load.mjs'; const LG = loadLG({ games: ['baccarat'] });
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function domStub() {
  const mk = (tag = 'div') => {
    const el = {
      tagName: String(tag).toUpperCase(), children: [], childNodes: [], style: {}, dataset: {},
      className: '', innerHTML: '', textContent: '', attributes: {}, listeners: {},
      classList: {
        _s: new Set(),
        add(...c) { c.forEach(x => this._s.add(x)); el.className = [...this._s].join(' '); },
        remove(...c) { c.forEach(x => this._s.delete(x)); el.className = [...this._s].join(' '); },
        toggle(c, f) { (f ?? !this._s.has(c)) ? this.add(c) : this.remove(c); },
        contains(c) { return this._s.has(c); },
      },
      appendChild(c) { el.children.push(c); el.childNodes.push(c); if (c) c.parentNode = el; return c; },
      append(...cs) { cs.forEach(c => el.appendChild(typeof c === 'string' ? { textContent: c } : c)); },
      prepend(...cs) { cs.forEach(c => { el.children.unshift(c); el.childNodes.unshift(c); }); },
      removeChild(c) { el.children = el.children.filter(x => x !== c); el.childNodes = el.children; return c; },
      remove() { if (el.parentNode) el.parentNode.removeChild(el); },
      replaceChildren(...cs) { el.children = []; el.childNodes = []; el.append(...cs); },
      insertBefore(c) { el.children.unshift(c); el.childNodes = el.children; return c; },
      setAttribute(k, v) { el.attributes[k] = String(v); if (k === 'class') el.className = String(v); },
      getAttribute(k) { return el.attributes[k] ?? null; },
      removeAttribute(k) { delete el.attributes[k]; },
      hasAttribute(k) { return k in el.attributes; },
      addEventListener(t, fn) { (el.listeners[t] ||= []).push(fn); },
      removeEventListener(t, fn) { el.listeners[t] = (el.listeners[t] || []).filter(f => f !== fn); },
      dispatchEvent(ev) { (el.listeners[ev.type] || []).forEach(f => f(ev)); return true; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      closest() { return null; }, contains() { return false; },
      getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
      focus() {}, blur() {}, click() { el.dispatchEvent({ type: 'click', target: el }); },
      scrollIntoView() {}, animate() { return { finished: Promise.resolve(), cancel() {} }; },
      get firstChild() { return el.children[0] || null; },
      get lastChild() { return el.children[el.children.length - 1] || null; },
      get parentElement() { return el.parentNode || null; },
    };
    return el;
  };
  const document = {
    createElement: mk, createElementNS: (_, t) => mk(t), createTextNode: t => ({ textContent: t }),
    createDocumentFragment: () => mk('fragment'),
    body: mk('body'), head: mk('head'), documentElement: mk('html'),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, hidden: false,
  };
  let store = {};
  const localStorage = {
    getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }, clear: () => { store = {}; }, get length() { return Object.keys(store).length; },
  };
  return {
    document, localStorage, sessionStorage: { ...localStorage },
    location: { hash: '', href: 'file:///index.html' }, history: { pushState() {}, replaceState() {} },
    navigator: { userAgent: 'node', language: 'zh-TW' },
    requestAnimationFrame: fn => setTimeout(() => fn(Date.now()), 0), cancelAnimationFrame: id => clearTimeout(id),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    speechSynthesis: { speak() {}, cancel() {} }, SpeechSynthesisUtterance: function () {},
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 2, scrollTo() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Event: class { constructor(type) { this.type = type; } },
  };
}

const list = (dir, ext) => {
  try { return readdirSync(join(root, dir)).filter(f => f.endsWith(ext)).sort().map(f => join(root, dir, f)); }
  catch { return []; }
};

/**
 * @param {{games?: string[], core?: 'all'|'libs'|string[], test?: boolean}} opts
 *  core:'libs' 只載入 00 + 10–16（純邏輯）；'all' 全部；陣列 = 檔名前綴清單
 */
export function loadLG(opts = {}) {
  const { games = [], core = 'all', test = true } = opts;
  const stub = domStub();
  const all = { window: globalThis, LG_TEST: test, ...stub };
  for (const [k, v] of Object.entries(all)) {
    try { globalThis[k] = v; }
    catch { try { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } catch { /* 忽略不可覆寫的全域（navigator 等） */ } }
  }
  globalThis.LG = {};
  let files = list('src/core', '.js');
  if (core === 'libs') files = files.filter(f => /\/(00|1\d)-/.test(f));
  else if (Array.isArray(core)) files = files.filter(f => core.some(p => f.includes(`/${p}`)));
  for (const g of games) files.push(join(root, 'src/games', `${g}.js`));
  for (const f of files) {
    const code = readFileSync(f, 'utf8');
    vm.runInThisContext(code, { filename: f });
  }
  return globalThis.LG;
}
