// 全域命名空間。所有模組只透過 LG.* 溝通。見 docs/02-architecture.md
(() => {
  const g = typeof globalThis !== 'undefined' ? globalThis : window;
  g.LG = g.LG || {};
  g.LG.VERSION = '0.1.0';
  // 測試/自動化時把動畫時長縮短：LG.speed 乘上毫秒數
  g.LG.speed = g.LG_TEST ? 0.1 : 1;
  g.LG.ms = (n) => Math.max(0, Math.round(n * g.LG.speed));
  g.LG.debug = (...a) => { if (g.LG_DEBUG) console.log('[LG]', ...a); };
})();
