// LG.router — hash 路由。#/ 首頁；#/game/<id>/<mode>[/<variant>]。見 docs/02-architecture.md §6
(() => {
  const LG = globalThis.LG;
  const MODES = ['tutorial', 'practice', 'real'];
  let current = null;
  let started = false;

  function parse(hash) {
    const h = String(hash || '').replace(/^#\/?/, '');
    const parts = h.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] === 'game' && parts[1]) {
      return { name: 'game', id: parts[1], mode: MODES.includes(parts[2]) ? parts[2] : 'practice', variant: parts[3] || null };
    }
    return { name: 'home' };
  }

  function href(id, mode, variant) {
    if (!id) return '#/';
    return `#/game/${encodeURIComponent(id)}/${mode || 'practice'}${variant ? '/' + encodeURIComponent(variant) : ''}`;
  }

  function render() {
    const route = parse(globalThis.location.hash);
    const app = document.getElementById('app');
    if (route.name === 'game') {
      const def = LG.games[route.id];
      if (!def) {
        LG.ui.toast(`找不到遊戲：${LG.ui.esc(route.id)}`);
        go('#/');
        return;
      }
      const vs = def.variants || [];
      if (vs.length && !vs.some((v) => v.id === route.variant)) route.variant = vs[0].id;
      if (!vs.length) route.variant = null;
      current = route;
      LG.home && LG.home.unmount && LG.home.unmount();
      LG.modes.open(route.id, route.mode, route.variant, app);
    } else {
      current = route;
      LG.modes.close();
      LG.home.render(app);
    }
    LG.events.emit('route:change', { route });
  }

  /** 導向 hash（字串）或 {id, mode, variant} */
  function go(to, mode, variant) {
    const h = typeof to === 'string' && (to.startsWith('#') || to === '') ? (to || '#/') : href(to, mode, variant);
    if (globalThis.location.hash === h) render();
    else globalThis.location.hash = h;
  }

  LG.router = {
    MODES,
    parse,
    href,
    go,
    current: () => current,
    start() {
      if (started) return;
      started = true;
      globalThis.addEventListener('hashchange', render);
      render();
    },
    render,
  };
})();
