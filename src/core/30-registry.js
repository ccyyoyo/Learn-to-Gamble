// LG.registerGame / LG.games / LG.categories。見 docs/02-architecture.md §4
(() => {
  const LG = globalThis.LG;

  LG.categories = [
    { id: 'table', name: { zh: '桌遊', en: 'Table Games' } },
    { id: 'poker-table', name: { zh: '撲克桌遊', en: 'Poker Table Games' } },
    { id: 'slots', name: { zh: '老虎機', en: 'Slots' } },
    { id: 'poker-room', name: { zh: '撲克室', en: 'Poker Room' } },
  ];
  /** id → def */
  LG.games = {};

  const DEFAULT_DENOMS = [10, 25, 50, 100, 500, 1000];

  /**
   * 註冊遊戲。必填：id, category, name{zh,en}, create(ctx)。
   * 選填擴充：countdown（真實模式倒數秒數，預設 15，用於進場說明）、demo（示範遊戲）。
   */
  LG.registerGame = function registerGame(def) {
    if (!def || !def.id || typeof def.create !== 'function') throw Error('registerGame: 需要 id 與 create(ctx)');
    if (!LG.categories.some((c) => c.id === def.category)) throw Error(`registerGame(${def.id}): 未知分類 ${def.category}`);
    if (LG.games[def.id]) LG.debug('registerGame: 覆寫', def.id);
    const d = {
      order: 99, summary: '', houseEdge: [], variants: [],
      limits: { real: { min: 50, max: 5000 }, practice: { min: 10, max: 100000 } },
      ...def,
    };
    if (!d.denoms && d.category !== 'slots') d.denoms = DEFAULT_DENOMS;
    LG.games[d.id] = d;
    return d;
  };

  /** 依分類（可省略）取遊戲清單，依 order、id 排序 */
  LG.gameList = function gameList(category) {
    return Object.values(LG.games)
      .filter((g) => !category || g.category === category)
      .sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
  };

  /** def.houseEdge 中 best:true 的一筆；沒有就取 edge 最小值 */
  LG.bestEdge = function bestEdge(def) {
    const list = (def && def.houseEdge) || [];
    if (!list.length) return null;
    return list.find((x) => x.best) || [...list].sort((a, b) => a.edge - b.edge)[0];
  };

  /** 依模式與變體算出限注 {min,max}（variant.limits 覆寫 def.limits） */
  LG.limitsFor = function limitsFor(def, mode, variantId) {
    const key = mode === 'real' ? 'real' : 'practice';
    const base = (def.limits && def.limits[key]) || { min: 10, max: 100000 };
    const v = (def.variants || []).find((x) => x.id === variantId);
    const over = v && v.limits && v.limits[key];
    return { ...base, ...(over || {}) };
  };
})();
