// LG.store — localStorage 持久化（key 'lg.v1'）。見 docs/04-data-model.md
// localStorage 不可用時改用記憶體（LG.store.persistent === false），由 50-app 提示「進度不會保存」。
(() => {
  const LG = globalThis.LG;
  const KEY = 'lg.v1';
  const START_BANK = 1000;
  const JACKPOT_SEEDS = {
    'slot-progressive': { mini: 20, minor: 50, major: 500, grand: 10000 },
    'slot-holdspin': { major: 500, grand: 5000 },
    'caribbean-stud': { pool: 100000 },
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function defaults() {
    return {
      version: 1,
      createdAt: Date.now(),
      bank: START_BANK,
      settings: { speak: false, hints: true, reducedMotion: false },
      progress: {},
      stats: {},
      sessions: [],
      jackpots: clone(JACKPOT_SEEDS),
      lastBets: {},
    };
  }

  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

  /** 缺欄位用預設補齊（型別不符也以預設覆蓋） */
  function fill(target, def) {
    for (const k of Object.keys(def)) {
      if (!(k in target) || target[k] === null || typeof target[k] !== typeof def[k]
        || Array.isArray(def[k]) !== Array.isArray(target[k])) {
        target[k] = clone(def[k]);
      } else if (isObj(def[k])) {
        fill(target[k], def[k]);
      }
    }
    return target;
  }

  function migrate(raw) {
    const d = defaults();
    if (!isObj(raw)) return d;
    // 目前只有 v1；未來版本在此轉換
    const s = fill(raw, d);
    s.version = 1;
    s.bank = LG.money ? LG.money.round2(s.bank) : s.bank;
    if (!Number.isFinite(s.bank) || s.bank < 0) s.bank = START_BANK;
    if (s.sessions.length > 20) s.sessions = s.sessions.slice(-20);
    return s;
  }

  // ---- 儲存後端 ----
  let ls = null;
  try {
    const t = globalThis.localStorage;
    if (t) { t.setItem('lg.__test', '1'); t.removeItem('lg.__test'); ls = t; }
  } catch { ls = null; }

  let state;

  function load() {
    let raw = null;
    if (ls) {
      try { raw = JSON.parse(ls.getItem(KEY) || 'null'); } catch { raw = null; }
    }
    state = migrate(raw);
    return state;
  }

  function save() {
    if (!ls) return false;
    try { ls.setItem(KEY, JSON.stringify(state)); return true; }
    catch { return false; }
  }

  load();

  LG.store = {
    KEY,
    START_BANK,
    JACKPOT_SEEDS: clone(JACKPOT_SEEDS),
    /** localStorage 是否可用 */
    get persistent() { return !!ls; },
    /** 整份 state 的唯讀複本 */
    get() { return clone(state); },
    /** 核心內部快速讀取（不要修改回傳物件） */
    peek() { return state; },
    /** fn(draft) 內直接修改；結束後立即同步寫入。回傳 fn 的回傳值 */
    update(fn) {
      const r = fn(state);
      save();
      return r;
    },
    /** 清除全部回到初始（bank=1000、jackpots 回種子值） */
    reset() {
      state = defaults();
      save();
      LG.events && LG.events.emit('store:reset', {});
      LG.events && LG.events.emit('bank:change', { balance: state.bank, delta: 0 });
      return clone(state);
    },
    /** 從 localStorage 重新讀取（測試/多分頁用） */
    load() { load(); return clone(state); },
    migrate,
    defaults,
  };
})();
