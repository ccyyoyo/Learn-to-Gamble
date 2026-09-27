// 啟動：偵測 reduced motion、localStorage 提示、啟動路由。見 docs/02-architecture.md §1
(() => {
  const LG = globalThis.LG;
  const doc = globalThis.document;

  function boot() {
    const app = doc.getElementById('app');
    if (!app || LG.booted) return;
    LG.booted = true;
    try {
      const mq = globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)');
      LG.reducedMotion = !!(mq && mq.matches) || !!LG.store.peek().settings.reducedMotion;
    } catch { LG.reducedMotion = false; }
    if (!LG.store.persistent) setTimeout(() => LG.ui.toast('此瀏覽器無法使用 localStorage：進度不會保存', { ms: 4000 }), 300);
    LG.router.start();
  }

  if (!doc || globalThis.LG_NO_AUTOSTART) return;
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
  LG.boot = boot;
})();
