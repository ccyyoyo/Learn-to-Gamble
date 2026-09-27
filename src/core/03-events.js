// LG.events — 極簡事件匯流排。見 docs/02-architecture.md §2.3
// 內建事件：'bank:change' {balance, delta}, 'route:change' {route}, 'mode:change' {gameId, mode},
//           'store:reset', 'progress:change' {gameId}, 'stats:change' {gameId}, 'hints:change' {gameId, hints}
(() => {
  const LG = globalThis.LG;
  const map = new Map();

  function on(name, fn) {
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(fn);
    return () => off(name, fn);
  }
  function off(name, fn) {
    const s = map.get(name);
    if (s) s.delete(fn);
  }
  function once(name, fn) {
    const offFn = on(name, (p) => { offFn(); fn(p); });
    return offFn;
  }
  function emit(name, payload) {
    const s = map.get(name);
    if (!s) return;
    for (const fn of [...s]) {
      try { fn(payload); } catch (e) { console.error('[LG.events]', name, e); }
    }
  }
  LG.events = { on, off, once, emit };
})();
