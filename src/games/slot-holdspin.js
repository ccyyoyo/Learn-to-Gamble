// ============================================================================
// Hold & Spin 機（Dragon Link 風）（id: slot-holdspin）— 規格 docs/05-game-rules/slot-holdspin.md
//
// 5×3、20 線（規格允許以 LINES_20 簡化，實作備註見 docs/change-requests/slot-holdspin.md）。
// 基礎符號沿用 slot-video 的賠付表（主題色改成深海藍），另加「金球 ORB」：
//   - 每顆金球帶面額（總注 ×1 / ×2 / ×3 / ×5 / ×10 / ×25 / ×50，或 MINOR / MAJOR）。
//   - 金球在基礎遊戲不賠線；6 顆以上 → Hold & Spin：鎖球、其餘格獨立再轉，
//     3 次再轉，有新球落下就重置為 3；3 次都沒新球 → 結束，所有金球面額加總；15 格全滿再加 GRAND。
// 累積獎金：MINOR = 總注 × 50（固定）；MAJOR 種子 RM 500、每轉 +總注 0.5%；GRAND 種子 RM 5,000、每轉 +總注 1%。
//   存在 LG.store.jackpots['slot-holdspin'] = {major, grand}；中獎後回種子。
// RTP 94.5%：以總注 RM 2（預設注）、獎池種子值計算（含特色），見 tests/unit/slot-holdspin.test.mjs [slow]。
// ============================================================================
(() => {
  const { ui, money, slots, slotView } = LG;
  const { el, term } = ui;
  const { fmt, round2 } = money;
  const ID = 'slot-holdspin';
  const cents = (n) => fmt(n, { cents: true });

  // ---------------------------------------------------------------- 文案
  const T = {
    name: { zh: 'Hold & Spin 機', en: 'Hold & Spin' },
    summary: '6 顆金球觸發 Hold & Spin：鎖球再轉，面額全部加總。',
    spin: term('旋轉', 'SPIN'),
    spinning: ['轉動中', 'Spinning'],
    paying: ['派彩', 'Paying out'],
    ready: ['按「旋轉」開始', 'Press SPIN'],
    feature: ['Hold & Spin！', 'Hold & Spin'],
    grand: ['15 格全滿！GRAND', 'GRAND jackpot'],
    noMoney: '餘額不足：請調低每線注',
    respins: term('再轉', 'Respins'),
    win: term('贏分', 'WIN'),
    orbs: term('金球', 'Orbs'),
    jp: { minor: 'MINOR', major: 'MAJOR', grand: 'GRAND' },
    rtpNote: 'RTP 94.5%（獎池以種子值計）',
  };

  // ---------------------------------------------------------------- 規則常數
  const LINES = slots.LINES_20;
  const NLINES = LINES.length;           // 20
  const TRIGGER = 6;                      // 6 顆以上觸發
  const RESPINS = 3;                      // 再轉次數（有新球重置為 3）
  const CELLS = 15;                       // 5×3 全滿 → GRAND
  const RESPIN_ORB_P = 0.08;              // 特色中每格每次落球機率
  const MINOR_MULT = 50;                  // MINOR = 總注 × 50
  const SEEDS = { major: 500, grand: 5000 };
  const GROWTH = { major: 0.005, grand: 0.01 };   // 每轉總注 ×
  const REF_BET = 2;                      // RTP 參考總注（預設：每線 RM 0.10 × 20）
  const LINE_BETS = [0.1, 0.2, 0.5, 1, 2, 5];
  const GRAND_ONE_IN = 15025;             // 平均幾轉全滿一次（exactRTP().pFull 的倒數；單元測試核對）

  /** 面額分佈（%）：數字 = 總注倍數 */
  const ORB_DIST = [[1, 40], [2, 25], [3, 15], [5, 10], [10, 6], [25, 2.5], [50, 1], ['MINOR', 0.4], ['MAJOR', 0.1]];

  /** 符號（由高到低）；賠付倍數乘「每線注」。同 slot-video 賠付表。 */
  const SYMS = {
    WILD: { zh: '龍', en: 'WILD', label: '龍', color: '#fff6c8', bg: 'linear-gradient(160deg,#1a8aa8,#0b3a55)' },
    GOD: { zh: '財神', en: 'Fortune God', label: '財神', color: '#b3261e', bg: 'linear-gradient(180deg,#fff4d6,#f2cf7a)' },
    INGOT: { zh: '金元寶', en: 'Gold Ingot', label: '元寶', color: '#8a5a00', bg: 'linear-gradient(180deg,#fff7df,#f4dc97)' },
    RED: { zh: '紅包', en: 'Red Packet', label: '紅包', color: '#fff', bg: 'linear-gradient(180deg,#e0453a,#a3150f)' },
    CARP: { zh: '鯉魚', en: 'Koi', label: '鯉', color: '#e0621b', bg: 'linear-gradient(180deg,#f3fbff,#cfe8f5)' },
    A: { zh: 'A', en: 'Ace', label: 'A', color: '#0d5d8c' },
    K: { zh: 'K', en: 'King', label: 'K', color: '#1b7d4a' },
    Q: { zh: 'Q', en: 'Queen', label: 'Q', color: '#7a2f9c' },
    J: { zh: 'J', en: 'Jack', label: 'J', color: '#b3531e' },
    T: { zh: '10', en: 'Ten', label: '10', color: '#2a5b9a' },
    N: { zh: '9', en: 'Nine', label: '9', color: '#6b6b6b' },
    ORB: { zh: '金球', en: 'Orb', label: '●', svg: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#b8860b"/><circle cx="10" cy="10" r="7.4" fill="#f5c542"/><circle cx="7.4" cy="7" r="2.6" fill="#fff5c7" opacity=".85"/></svg>', bg: 'radial-gradient(circle,#3a2a05,#120d02)' },
    EMPTY: { zh: '空格', en: 'Blank', label: ' ', bg: 'linear-gradient(180deg,#0e2533,#081620)' },
  };
  const PAYTABLE = {
    WILD: { 5: 1000 },
    GOD: { 3: 50, 4: 200, 5: 1000 },
    INGOT: { 3: 25, 4: 100, 5: 400 },
    RED: { 3: 20, 4: 60, 5: 200 },
    CARP: { 3: 15, 4: 40, 5: 120 },
    A: { 3: 10, 4: 25, 5: 75 },
    K: { 3: 10, 4: 25, 5: 75 },
    Q: { 3: 5, 4: 15, 5: 50 },
    J: { 3: 5, 4: 15, 5: 50 },
    T: { 3: 5, 4: 10, 5: 40 },
    N: { 3: 5, 4: 10, 5: 40 },
  };
  const PAY_ORDER = ['WILD', 'GOD', 'INGOT', 'RED', 'CARP', 'A', 'K', 'Q', 'J', 'T', 'N'];

  // ---------------------------------------------------------------- 轉軸帶
  /** 平滑加權輪替：把 [符號, 停點數] 均勻交錯成一條帶 */
  function interleave(items) {
    const list = items.filter(([, c]) => c > 0).map(([u, c]) => ({ u, w: c, cur: 0 }));
    const total = list.reduce((s, x) => s + x.w, 0);
    const out = [];
    for (let k = 0; k < total; k++) {
      let best = null;
      for (const x of list) { x.cur += x.w; if (!best || x.cur > best.cur) best = x; }
      best.cur -= total;
      out.push(best.u);
    }
    return out;
  }
  /**
   * 一軸：spec = {syms:[[符號, 停點數]], orbs:[方塊大小…]}。
   * 金球以「疊放方塊」均勻插進帶子（彼此間隔很遠、不會黏在一起），這樣一軸最多同時露出方塊大小顆。
   */
  function buildStrip(spec) {
    const out = interleave(spec.syms);
    const blocks = spec.orbs || [];
    const F = out.length;
    for (let k = blocks.length - 1; k >= 0; k--) {
      const at = Math.floor(((k + 0.5) * F) / blocks.length);
      out.splice(at, 0, ...new Array(blocks[k]).fill('ORB'));
    }
    return out;
  }
  // 各軸停點數（以 exactRTP 精確調到 RTP 94.5%；見單元測試）
  const MID_SYMS = [['WILD', 5], ['GOD', 3], ['INGOT', 3], ['RED', 3], ['CARP', 3], ['A', 4], ['K', 4], ['Q', 4], ['J', 4], ['T', 4], ['N', 4]];
  const OUT_SYMS = [['GOD', 3], ['INGOT', 2], ['RED', 3], ['CARP', 3], ['A', 4], ['K', 4], ['Q', 4], ['J', 4], ['T', 4], ['N', 3]];
  // 龍 WILD 只在第 2–4 軸；每軸金球：一個 2 連方塊 + 兩顆單球
  const STRIP_SPEC = [0, 1, 2, 3, 4].map((r) => ({ syms: r >= 1 && r <= 3 ? MID_SYMS : OUT_SYMS, orbs: [2, 1, 1] }));
  const STRIPS = STRIP_SPEC.map(buildStrip);
  /** 特色中轉動動畫用的帶（只有空格與金球） */
  const FEATURE_STRIPS = STRIPS.map(() => ['EMPTY', 'EMPTY', 'EMPTY', 'ORB', 'EMPTY', 'EMPTY', 'EMPTY', 'EMPTY']);

  // ---------------------------------------------------------------- 純邏輯
  const key = (c) => `${c[0]},${c[1]}`;
  const cellOrder = (a, b) => (a.cell[0] - b.cell[0]) || (a.cell[1] - b.cell[1]);

  /** 依分佈抽一顆金球面額 */
  function drawOrbValue(rand = LG.rng.random) {
    let r = rand() * 100;
    for (const [v, p] of ORB_DIST) { if (r < p) return v; r -= p; }
    return ORB_DIST[0][0];
  }

  /** 基礎遊戲轉一次 → grid[reel][row]；grid.vals[reel][row] = 金球面額或 null（不可列舉） */
  function spinBase(strips = STRIPS) {
    const grid = slots.spin(strips, 3);
    const vals = grid.map((col) => col.map((s) => (s === 'ORB' ? drawOrbValue() : null)));
    Object.defineProperty(grid, 'vals', { value: vals, enumerable: false, writable: true });
    return grid;
  }

  /** 盤面上的金球清單 [{cell:[reel,row], value}] */
  function orbList(grid, vals) {
    const out = [];
    grid.forEach((col, r) => col.forEach((s, y) => { if (s === 'ORB') out.push({ cell: [r, y], value: vals && vals[r] ? vals[r][y] : 1 }); }));
    return out;
  }
  const isTrigger = (orbCount) => orbCount >= TRIGGER;

  /** 線獎（倍數 × 每線注）。金球不賠線、Wild 不替代金球。 */
  function evalBase(grid, lineBet) {
    const r = slots.evalLines(grid, LINES, PAYTABLE, { wild: 'WILD' });
    return { wins: r.wins, mult: r.total, win: round2(r.total * lineBet) };
  }

  /**
   * Hold & Spin。orbs = 觸發時的金球；draw(cell) → 新球面額或 null（預設：8% 機率落球）。
   * 每次再轉：所有未鎖格各自獨立判定；有新球 → 剩餘次數重置為 3，否則 −1。
   * 3 次都沒新球或 15 格全滿即結束。
   * @returns {{rounds:Array<{landed:Array<{cell,value}>, left:number, reset:boolean}>, orbs:Array<{cell,value}>, full:boolean}}
   */
  function runHoldSpin(orbs, draw) {
    const d = draw || (() => (LG.rng.random() < RESPIN_ORB_P ? drawOrbValue() : null));
    const held = new Map(orbs.map((o) => [key(o.cell), { cell: [o.cell[0], o.cell[1]], value: o.value }]));
    const rounds = [];
    let left = RESPINS;
    while (left > 0 && held.size < CELLS) {
      const landed = [];
      for (let r = 0; r < 5; r++) for (let y = 0; y < 3; y++) {
        if (held.has(`${r},${y}`)) continue;
        const v = d([r, y]);
        if (v !== null && v !== undefined) landed.push({ cell: [r, y], value: v });
      }
      landed.forEach((o) => held.set(key(o.cell), o));
      const reset = landed.length > 0;
      left = reset ? RESPINS : left - 1;
      rounds.push({ landed, left, reset });
    }
    return { rounds, orbs: [...held.values()].sort(cellOrder), full: held.size >= CELLS };
  }

  /** 一顆金球的金額（MAJOR 用傳入的當下獎池） */
  function orbAmount(value, bet, majorPool) {
    if (value === 'MINOR') return round2(bet * MINOR_MULT);
    if (value === 'MAJOR') return round2(majorPool);
    return round2(bet * value);
  }
  const orbLabel = (value, bet) => (typeof value === 'number' ? cents(bet * value) : value);

  /**
   * 特色總贏：所有金球面額加總 + 全滿 GRAND。jp = {major, grand}（此總注下的當下金額，見 jackpots.at）。
   * 同一局第二顆 MAJOR 以種子值計（第一顆領走後已回種子）。
   * @returns {{total, parts:[{cell,value,amount}], grand:number, claims:string[]}}
   */
  function featureTotal(orbs, full, bet, jp) {
    let major = jp.major;
    const majorSeed = round2(SEEDS.major * (bet / REF_BET));
    const claims = [];
    const parts = orbs.map((o) => {
      const amount = orbAmount(o.value, bet, major);
      if (o.value === 'MAJOR') { claims.push('major'); major = majorSeed; }
      return { cell: o.cell, value: o.value, amount };
    });
    const grand = full ? round2(jp.grand) : 0;
    if (full) claims.push('grand');
    const total = round2(parts.reduce((s, p) => s + p.amount, 0) + grand);
    return { total, parts, grand, claims };
  }

  /** 完整一轉（純邏輯）：grid 可指定（教學/測試），否則隨機。jp 為當下獎池 */
  function playSpin({ bet, lineBet, jp, grid }) {
    const g = grid || spinBase();
    const vals = g.vals || g.map((col) => col.map((s) => (s === 'ORB' ? 1 : null)));
    const base = evalBase(g, lineBet);
    const orbs = orbList(g, vals);
    let feature = null;
    if (isTrigger(orbs.length)) {
      const hs = runHoldSpin(orbs);
      feature = { ...hs, ...featureTotal(hs.orbs, hs.full, bet, jp) };
    }
    const win = round2(base.win + (feature ? feature.total : 0));
    return { grid: g, vals, base, orbs, feature, win, bet, lineBet };
  }

  // ---- 精確分析（不靠亂數）：特色是「已鎖 k 顆、剩 l 次」的馬可夫鏈；各格落球獨立同分佈
  const binom = (n, k) => { let c = 1; for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i; return c; };
  const memo = new Map();
  /** 由 k 顆鎖定、剩 left 次開始 → 最終金球數分佈 dist[0..15]（dist[15] = 全滿機率） */
  function finalDist(k, left = RESPINS, p = RESPIN_ORB_P) {
    if (k >= CELLS) { const d = new Array(CELLS + 1).fill(0); d[CELLS] = 1; return d; }
    if (left <= 0) { const d = new Array(CELLS + 1).fill(0); d[k] = 1; return d; }
    const mk = `${k},${left},${p}`;
    if (memo.has(mk)) return memo.get(mk);
    const m = CELLS - k;
    const out = new Array(CELLS + 1).fill(0);
    for (let j = 0; j <= m; j++) {
      const pj = binom(m, j) * p ** j * (1 - p) ** (m - j);
      const sub = j === 0 ? finalDist(k, left - 1, p) : finalDist(k + j, RESPINS, p);
      sub.forEach((x, i) => { out[i] += pj * x; });
    }
    memo.set(mk, out);
    return out;
  }
  /** 一顆金球的期望金額（總注倍數；MAJOR 以種子計＝總注 × 500 ÷ 2） */
  function orbMean() {
    return ORB_DIST.reduce((s, [v, p]) => s + (p / 100) * (v === 'MINOR' ? MINOR_MULT : v === 'MAJOR' ? SEEDS.major / REF_BET : v), 0);
  }
  /** 基礎盤面金球數分佈 P(n)，n = 0..15（由轉軸帶精確計算） */
  function orbCountDist(strips = STRIPS) {
    let dist = [1];
    for (const st of strips) {
      const d = [0, 0, 0, 0];
      for (let i = 0; i < st.length; i++) {
        let c = 0;
        for (let y = 0; y < 3; y++) if (st[(i + y) % st.length] === 'ORB') c++;
        d[c] += 1 / st.length;
      }
      const nd = new Array(dist.length + 3).fill(0);
      dist.forEach((a, i) => d.forEach((b, j) => { nd[i + j] += a * b; }));
      dist = nd;
    }
    return dist;
  }
  /** 線獎期望（總注倍數）：各線邊際分佈相同 → 一條線的期望倍數 */
  function lineRTP(strips = STRIPS) {
    const freqs = strips.map((st) => {
      const m = {};
      st.forEach((x) => { m[x] = (m[x] || 0) + 1; });
      return Object.entries(m).map(([k, v]) => [k, v / st.length]);
    });
    let ev = 0;
    const g = [];
    const rec = (r, p) => {
      if (r === 5) { ev += p * slots.evalLines(g, [[0, 0, 0, 0, 0]], PAYTABLE, { wild: 'WILD' }).total; return; }
      for (const [x, f] of freqs[r]) { g[r] = [x]; rec(r + 1, p * f); }
    };
    rec(0, 1);
    return ev; // 20 線 × 每線注 × ev ÷ 總注(20 × 每線注) = ev
  }
  /** 精確 RTP 分解（獎池取種子值；獎金按總注等比，所以與注額無關）→ {lines, feature, grand, total, trigger, pFull} */
  function exactRTP({ strips = STRIPS } = {}) {
    const nd = orbCountDist(strips);
    const mu = orbMean();
    let feature = 0, grand = 0, trigger = 0, pFull = 0;
    for (let n = TRIGGER; n < nd.length; n++) {
      if (!nd[n]) continue;
      trigger += nd[n];
      const fd = finalDist(n);
      const eK = fd.reduce((s, x, i) => s + x * i, 0);
      feature += nd[n] * eK * mu;
      grand += nd[n] * fd[CELLS] * (SEEDS.grand / REF_BET);
      pFull += nd[n] * fd[CELLS];
    }
    const lines = lineRTP(strips);
    return { lines, feature, grand, total: lines + feature + grand, trigger, pFull };
  }

  // ---- 累積獎金（LG.store）
  // 存的是「總注 RM 2 時」的金額（種子 MAJOR 500 / GRAND 5,000）；顯示與派彩按總注等比換算（同 MINOR 以總注換算），
  // 所以每種注額的 RTP 都一樣。每轉成長＝該注額下看到的金額 +總注 × 0.5%（MAJOR）/ × 1%（GRAND）。
  const scale = (bet) => bet / REF_BET;
  const jackpots = {
    /** 儲存值（總注 RM 2 基準） */
    get() {
      const j = (LG.store.peek().jackpots || {})[ID] || {};
      return { major: Number.isFinite(j.major) ? j.major : SEEDS.major, grand: Number.isFinite(j.grand) ? j.grand : SEEDS.grand };
    },
    /** 此總注下的三級金額（RM） */
    at(bet) {
      const j = jackpots.get();
      return { minor: round2(bet * MINOR_MULT), major: round2(j.major * scale(bet)), grand: round2(j.grand * scale(bet)) };
    },
    /** 每轉成長：此注額下 MAJOR +總注 × 0.5%、GRAND +總注 × 1% */
    grow(bet) {
      LG.store.update((s) => {
        const cur = s.jackpots[ID] || { ...SEEDS };
        const add = (lv) => Math.round(((Number(cur[lv]) || SEEDS[lv]) + (bet * GROWTH[lv]) / scale(bet)) * 1e6) / 1e6;
        s.jackpots[ID] = { major: add('major'), grand: add('grand') };
      });
      return jackpots.at(bet);
    },
    /** 中獎後回種子 */
    claim(level) {
      LG.store.update((s) => { s.jackpots[ID] = { ...jackpots.get(), [level]: SEEDS[level] }; });
      return jackpots.get();
    },
    reset() { LG.store.update((s) => { s.jackpots[ID] = { ...SEEDS }; }); },
  };

  /**
   * simulateRTP 設定：基礎盤面、線獎、Hold & Spin 再轉與數字球 / MINOR 面額都實際模擬；
   * MAJOR / GRAND 以種子期望計（MAJOR：每顆球 0.1% × 種子；GRAND：此起始球數的全滿機率 × 種子），
   * 避免幾萬轉才一次的 GRAND 讓 20 萬轉的模擬結果大幅跳動。jackpotMode:'random' 則完全照抽。
   */
  function rtpConfig({ bet = REF_BET, strips = STRIPS, jackpotMode = 'expected' } = {}) {
    const lineBet = bet / NLINES;
    const seedAt = { major: SEEDS.major * (bet / REF_BET), grand: SEEDS.grand * (bet / REF_BET) };
    const pMajor = (ORB_DIST.find(([v]) => v === 'MAJOR') || [0, 0])[1] / 100;
    return {
      bet,
      spin: () => spinBase(strips),
      evaluate(grid) {
        let w = evalBase(grid, 1).mult * lineBet;
        const orbs = orbList(grid, grid.vals);
        if (isTrigger(orbs.length)) {
          const hs = runHoldSpin(orbs);
          if (jackpotMode === 'random') {
            w += featureTotal(hs.orbs, hs.full, bet, seedAt).total;
          } else {
            for (const o of hs.orbs) if (o.value !== 'MAJOR') w += orbAmount(o.value, bet, 0);
            w += hs.orbs.length * pMajor * seedAt.major + finalDist(orbs.length)[CELLS] * seedAt.grand;
          }
        }
        return w;
      },
    };
  }

  // ---------------------------------------------------------------- 教學示範盤面
  const DEMO_BASE = [['A', 'GOD', 'K'], ['Q', 'RED', 'J'], ['CARP', 'T', 'A'], ['K', 'N', 'INGOT'], ['J', 'Q', 'T']];
  const DEMO_ORB_CELLS = [[0, 1], [1, 0], [1, 2], [2, 1], [3, 0], [4, 2], [2, 2], [3, 1], [0, 0], [4, 0]];
  const DEMO_VALUES = [1, 2, 5, 1, 3, 2, 10, 1, 'MINOR', 3];
  /** 由示範底盤放 n 顆金球 → grid（附 vals） */
  function demoGrid(n, values = DEMO_VALUES) {
    const grid = DEMO_BASE.map((c) => c.slice());
    const vals = grid.map((c) => c.map(() => null));
    DEMO_ORB_CELLS.slice(0, n).forEach(([r, y], i) => { grid[r][y] = 'ORB'; vals[r][y] = values[i % values.length]; });
    Object.defineProperty(grid, 'vals', { value: vals, enumerable: false, writable: true });
    return grid;
  }

  // ---------------------------------------------------------------- 註冊
  LG.registerGame({
    id: ID,
    category: 'slots',
    order: 3,
    name: T.name,
    summary: T.summary,
    houseEdge: [{ bet: { zh: '總體（RTP 94.5%）', en: 'Overall' }, edge: 5.5, best: true }],
    limits: { real: { min: 2, max: 100 }, practice: { min: 2, max: 100 } },
    logic: {
      SYMS, PAYTABLE, STRIPS, STRIP_SPEC, LINES, ORB_DIST, SEEDS, GROWTH, TRIGGER, RESPINS, RESPIN_ORB_P, MINOR_MULT, REF_BET,
      buildStrip, interleave, drawOrbValue, spinBase, orbList, isTrigger, evalBase, runHoldSpin, orbAmount, featureTotal, playSpin,
      jackpots, rtpConfig, demoGrid, GRAND_ONE_IN, finalDist, orbMean, orbCountDist, lineRTP, exactRTP,
    },

    create(ctx) {
      const state = { rounds: 0, features: 0, busy: false, ready: false, last: null, pending: null, forced: null, paytableOpened: false, lastOrbs: 0 };
      let root, machine, view, panel, spinBtn, hintEl, winEl, orbEl, respinEl, statusEl, jpEls = {}, alive = true;

      // ---- 畫面
      function buildTable() {
        jpEls = {};
        const plaques = ['grand', 'major', 'minor'].map((lv) => {
          const v = el('b.hs-jp__v', { dataset: { role: `jp-${lv}` } });
          jpEls[lv] = v;
          return el(`div.hs-jp.hs-jp--${lv}`, { dataset: { jp: lv } }, [el('span.hs-jp__k', { text: T.jp[lv] }), v]);
        });
        const reels = el('div.hs-reels');
        respinEl = el('div.hs-respins', { dataset: { left: '' }, 'aria-live': 'polite' });
        statusEl = el('div.hs-status', [el('span.hs-status__t', { html: `6 顆以上${term('金球', 'Orb')} → Hold &amp; Spin` }), respinEl]);
        winEl = el('b.hs-meter__win', { dataset: { role: 'win' }, text: cents(0) });
        orbEl = el('b.hs-meter__orbs', { dataset: { role: 'orbs' }, text: '0' });
        machine = el('div.lg-table.hs-machine', [
          el('div.hs-jackpots', plaques),
          statusEl,
          reels,
          el('div.hs-meter', [el('span', { html: `${T.win} ` }), winEl, el('span.hs-meter__sep', { text: '·' }), el('span', { html: `${T.orbs} ` }), orbEl, el('span', { text: ' / 6' })]),
        ]);
        hintEl = el('div.lg-hint.hs-hint', { hidden: true });
        const actions = el('div.lg-actions.hs-actions');
        const betHost = el('div.hs-bet');
        root.append(machine, hintEl, actions, betHost);

        view = slotView.create(reels, { reels: 5, rows: 3, symbols: SYMS, strips: STRIPS });
        view.setGrid(DEMO_BASE);
        const pt = slotView.paytableButton(actions, { render: renderPaytable });
        pt.addEventListener('click', () => { state.paytableOpened = true; });
        spinBtn = el('button', { type: 'button', class: 'lg-btn lg-btn--primary hs-spin', dataset: { action: 'spin' }, html: T.spin });
        spinBtn.addEventListener('click', () => { doSpin(); });
        actions.appendChild(spinBtn);
        panel = slotView.betPanel(betHost, { lines: [NLINES], lineBets: LINE_BETS, lineBet: 0.1, onChange: () => { paintJackpots(); paintHints(); } });
        paintJackpots();
        paintRespins(null);
      }

      function paintJackpots() {
        const j = jackpots.at(panel.bet());
        jpEls.minor.textContent = cents(j.minor);
        jpEls.major.textContent = cents(j.major);
        jpEls.grand.textContent = cents(j.grand);
      }
      function paintRespins(left, { pulse = false } = {}) {
        respinEl.dataset.left = left === null ? '' : String(left);
        respinEl.innerHTML = left === null ? '' : `${T.respins} <b>${left}</b>`;
        if (pulse) { respinEl.classList.remove('is-reset'); void respinEl.offsetWidth; respinEl.classList.add('is-reset'); }
      }
      const setWin = (n) => { winEl.textContent = cents(n); };
      const setBusy = (b) => {
        state.busy = b;
        spinBtn.disabled = b || !state.ready;
        panel.setEnabled(!b);
      };

      function paintHints() {
        if (!hintEl) return;
        hintEl.hidden = !ctx.hints;
        const bet = panel ? panel.bet() : REF_BET;
        hintEl.innerHTML = `提示：上一轉金球 ${state.lastOrbs} / 6 顆。Hold &amp; Spin 是 RTP 94.5% 的一部分，不是額外的錢。`
          + `總注 ${cents(bet)} × 200 轉 = ${cents(bet * 200)}，先確認預算撐得住。`;
      }

      function renderPaytable() {
        const bet = panel.bet(), lb = panel.lineBet();
        const rows = PAY_ORDER.map((s) => {
          const p = PAYTABLE[s];
          const nm = `${SYMS[s].zh} <i class="en">${SYMS[s].en}</i>`;
          return `<tr><td>${nm}</td><td>${p[3] ?? '—'}</td><td>${p[4] ?? '—'}</td><td>${p[5] ?? '—'}</td></tr>`;
        }).join('');
        const dist = ORB_DIST.map(([v, p]) => `<tr><td>${typeof v === 'number' ? `總注 ×${v}（${cents(bet * v)}）` : v}</td><td>${p}%</td></tr>`).join('');
        const j = jackpots.at(bet);
        return `<p>線獎倍數乘<b>每線注</b>（目前 ${cents(lb)}），不是總注。20 條固定線，由左至右連續。龍 <i class="en">WILD</i> 只在第 2–4 軸，替代金球以外的符號。</p>
          <table class="lg-datatable"><thead><tr><th>符號</th><th>3 連</th><th>4 連</th><th>5 連</th></tr></thead><tbody>${rows}</tbody></table>
          <h3>Hold &amp; Spin 特色 <i class="en">Feature</i></h3>
          <ul class="lg-list"><li>金球 <i class="en">Orb</i> 在基礎遊戲<b>不賠線</b>，只算觸發。</li>
          <li><b>6 顆以上</b>金球 → 觸發：金球鎖定 <i class="en">Hold</i>，其餘格獨立再轉 <i class="en">Respins</i>。</li>
          <li>給 3 次再轉；有新球落下就鎖定並<b>重置為 3 次</b>。</li>
          <li>3 次都沒新球 → 結束：所有金球面額加總。15 格全滿 → 另加 <b>GRAND</b>。</li>
          <li>特色中每格每次約 8% 落球。</li></ul>
          <table class="lg-datatable"><thead><tr><th>金球面額</th><th>機率</th></tr></thead><tbody>${dist}</tbody></table>
          <h3>累積獎金 <i class="en">Jackpots</i></h3>
          <table class="lg-datatable"><thead><tr><th>級別</th><th>目前</th><th>種子 / 成長</th></tr></thead><tbody>
          <tr><td>MINOR</td><td>${cents(j.minor)}</td><td>總注 × 50（固定）</td></tr>
          <tr><td>MAJOR</td><td>${cents(j.major)}</td><td>種子 RM 500；每轉 +總注 × 0.5%</td></tr>
          <tr><td>GRAND</td><td>${cents(j.grand)}</td><td>種子 RM 5,000；每轉 +總注 × 1%；15 格全滿才中</td></tr></tbody></table>
          <p class="lg-muted">獎金牌以總注 RM 2 為基準（MAJOR 種子 RM 500、GRAND 種子 RM 5,000），換注額時按比例換算，就像 MINOR = 總注 × 50。所以每種注額的 RTP 都是 94.5%（莊家優勢 5.5%，獎池以種子值計）。中獎後該級回種子。</p>`;
      }

      // ---- 一轉
      async function doSpin() {
        if (state.busy || !state.ready || !alive) return;
        const bet = panel.bet(), lineBet = panel.lineBet();
        if (!ctx.bank.canAfford(bet)) { ui.toast(T.noMoney, { type: 'warn' }); ctx.checkBroke(); return; }
        setBusy(true);
        ctx.bank.debit(bet);
        const jp = jackpots.grow(bet);
        paintJackpots();
        const grid = state.forced ? state.forced : undefined;
        state.forced = null;
        const out = playSpin({ bet, lineBet, jp, grid });
        state.pending = { win: out.win, claims: out.feature ? out.feature.claims : [], bet };
        ctx.dealer.say(...T.spinning);
        setWin(0);
        paintRespins(null);
        machine.classList.remove('is-feature', 'is-grand');
        view.reset();
        view.setStrips(STRIPS);
        await view.spin(out.grid);
        if (!alive) return;
        out.orbs.forEach((o) => view.setSymbolValue(o.cell, orbLabel(o.value, bet)));
        orbEl.textContent = String(out.orbs.length);
        state.lastOrbs = out.orbs.length;
        if (out.base.wins.length) {
          out.base.wins.forEach((w) => { view.showLine(LINES[w.line]); view.highlight(w.cells); });
          setWin(out.base.win);
          await ctx.wait(out.feature ? 900 : 300);
          if (!alive) return;
        }
        if (out.feature) {
          await playFeature(out);
          if (!alive) return;
        }
        settle(out);
      }

      async function playFeature(out) {
        const f = out.feature, bet = out.bet;
        state.features += 1;
        machine.classList.add('is-feature');
        ctx.dealer.say(...T.feature);
        view.clear();
        await ctx.wait(500);
        if (!alive) return;
        // 鎖球；其餘格變空格，成為獨立轉軸
        const held = new Set(out.orbs.map((o) => key(o.cell)));
        const cur = out.grid.map((col, r) => col.map((s, y) => (held.has(`${r},${y}`) ? 'ORB' : 'EMPTY')));
        view.setGrid(cur);
        view.lock(out.orbs.map((o) => o.cell));
        view.setStrips(FEATURE_STRIPS);
        paintRespins(RESPINS);
        for (const round of f.rounds) {
          await ctx.wait(450);
          if (!alive) return;
          round.landed.forEach((o) => { cur[o.cell[0]][o.cell[1]] = 'ORB'; });
          await view.spin(cur);
          if (!alive) return;
          round.landed.forEach((o) => view.setSymbolValue(o.cell, orbLabel(o.value, bet)));
          view.lock(round.landed.map((o) => o.cell));
          orbEl.textContent = String(held.size + round.landed.length);
          round.landed.forEach((o) => held.add(key(o.cell)));
          paintRespins(round.left, { pulse: round.reset });
          if (round.landed.length) view.highlight(round.landed.map((o) => o.cell));
        }
        view.setStrips(STRIPS);
        if (f.full) { machine.classList.add('is-grand'); ctx.dealer.say(...T.grand); }
        // 逐球加總
        await ctx.wait(400);
        view.clear();
        let acc = out.base.win;
        for (const p of f.parts) {
          if (!alive) return;
          view.highlight([p.cell]);
          acc = round2(acc + p.amount);
          setWin(acc);
          await ctx.wait(220);
        }
        if (f.grand) { acc = round2(acc + f.grand); setWin(acc); await ctx.wait(400); }
      }

      /** 入帳 + 獎池回種子（動畫結束或中途離開都要做） */
      function finalize() {
        const p = state.pending;
        if (!p) return null;
        state.pending = null;
        if (p.win > 0) ctx.bank.credit(p.win);
        p.claims.forEach((lv) => jackpots.claim(lv));
        return p;
      }

      function settle(out) {
        finalize();
        paintJackpots();
        setWin(out.win);
        paintRespins(null);
        const net = round2(out.win - out.bet);
        state.last = { bet: out.bet, win: out.win, net, orbs: out.orbs.length, feature: !!out.feature };
        state.rounds += 1;
        if (out.win > 0) ctx.dealer.say(...T.paying); else ctx.dealer.say(...T.ready);
        ctx.recordRound({ wagered: out.bet, net, outcome: net > 0 ? 'win' : net < 0 ? 'lose' : 'push' });
        ctx.explain(explainOf(out));
        setBusy(false);
        paintHints();
        ctx.checkBroke();
      }

      function explainOf(out) {
        const { bet, lineBet } = out;
        const lineTxt = out.base.wins.map((w) => `第 ${w.lineNo} 線：${SYMS[w.sym].zh} ×${w.count}`);
        const hand = `${T.orbs} ${out.orbs.length} 顆${out.orbs.length >= TRIGGER ? '（觸發 Hold &amp; Spin）' : '（需 6 顆觸發）'}`
          + (lineTxt.length ? `<br>${lineTxt.join('；')}` : '<br>沒有連線');
        const result = out.win > 0 ? `中獎 <i class="en">WIN</i> ${cents(out.win)}` : `未中獎，本次投入 ${cents(bet)}`;
        const f = [];
        out.base.wins.forEach((w) => f.push(`第 ${w.lineNo} 線 ${SYMS[w.sym].zh}×${w.count}：${w.mult} × ${cents(lineBet)} = ${cents(w.mult * lineBet)}`));
        if (out.feature) {
          const parts = out.feature.parts.map((p) => (typeof p.value === 'number' ? cents(p.amount) : `${p.value} ${cents(p.amount)}`));
          f.push(`Hold &amp; Spin ${out.feature.parts.length} 顆：${parts.join(' + ')} = ${cents(round2(out.feature.total - out.feature.grand))}`);
          if (out.feature.grand) f.push(`15 格全滿 GRAND：+${cents(out.feature.grand)}`);
        }
        f.push(`總贏 ${cents(out.win)} − 總注 ${cents(bet)} = 淨 <b>${money.fmtSigned(round2(out.win - bet))}</b>`);
        let why;
        if (out.feature) {
          const r = out.feature.rounds;
          const resets = r.filter((x) => x.reset).length;
          why = `${out.orbs.length} 顆金球觸發，鎖定後再轉 ${r.length} 次，其中 ${resets} 次有新球（次數重置為 3）。`
            + (out.feature.full ? '15 格全滿，所以另加 GRAND。' : '最後連續 3 次沒新球而結束，所有金球面額加總。')
            + '這筆特色贏分本來就算在 RTP 94.5% 裡。';
        } else if (out.base.wins.length) {
          why = `線獎 = 賠付表倍數 × 每線注 ${cents(lineBet)}（不是總注）。金球 ${out.orbs.length} 顆，不到 6 顆不觸發，也不賠線。`;
        } else {
          why = `沒有任何一條線由左起連成 3 個相同符號；金球 ${out.orbs.length} 顆不到 6 顆。大多數轉都是這樣——長期每 RM 100 平均拿回 RM 94.5。`;
        }
        return { hand, result, formula: f.join('<br>'), why };
      }

      // ---- 教學示範
      const demo = {
        /** 顯示 n 顆金球的示範盤面（不扣款）；lock=鎖球；left=再轉次數 */
        show(n, { lock = false, left = null, values } = {}) {
          if (state.busy) return;
          const g = demoGrid(n, values);
          const bet = panel.bet();
          view.reset();
          machine.classList.toggle('is-feature', lock);
          machine.classList.remove('is-grand');
          const shown = lock ? g.map((col) => col.map((s) => (s === 'ORB' ? 'ORB' : 'EMPTY'))) : g;
          view.setGrid(shown);
          orbList(g, g.vals).forEach((o) => view.setSymbolValue(o.cell, orbLabel(o.value, bet)));
          if (lock) view.lock(orbList(g, g.vals).map((o) => o.cell));
          orbEl.textContent = String(n);
          paintRespins(left);
        },
        /** 下一轉固定出現 n 顆金球（觸發 Hold & Spin）；再轉部分仍隨機 */
        forceTrigger(n = 6) { state.forced = demoGrid(n); },
        forceGrid(grid) { state.forced = grid; },
        setLineBet(v) { panel.set({ lineBet: v }); },
        showBanner(zh, en) { ctx.dealer.say(zh, en); },
        spin: () => doSpin(),
        /** 教學：把下方元素捲到畫面中間（避免被教學面板蓋住） */
        reveal(sel) {
          ctx.later(() => {
            const x = root && (root.querySelector(sel) || document.querySelector(sel));
            if (x && x.scrollIntoView) x.scrollIntoView({ block: 'center', behavior: 'auto' });
          }, 250);
        },
      };

      function tutorialSteps() {
        return [
          // ===== layout
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：機台畫面',
            body: '<p>上面是獎金牌，中間 5 軸 × 3 列的轉軸，下面是注額面板與旋轉鍵。</p>',
            highlight: ['.hs-machine'], setup: () => demo.show(0) },
          { id: 'layout-orb', section: 'layout', title: `金球 <i class="en">Orb</i>`,
            body: '<p>金色圓球就是金球。每顆帶一個面額，例如 RM 2、RM 10，或 MINOR / MAJOR。</p><p>金球在基礎遊戲<b>不賠線</b>，只用來觸發特色。</p>',
            highlight: ['.hs-reels .lg-slot__cell[data-sym="ORB"]'], setup: () => demo.show(4) },
          { id: 'layout-jackpots', section: 'layout', title: `獎金牌 <i class="en">Jackpots</i>`,
            body: '<p>MINOR = 總注 × 50；MAJOR 從 RM 500 起、GRAND 從 RM 5,000 起，每轉都會長一點。</p>',
            highlight: ['.hs-jackpots'] },
          { id: 'layout-lines', section: 'layout', title: `每線注 <i class="en">Bet per line</i>`,
            body: '<p>20 條固定線。<b>總注 = 20 × 每線注</b>：每線 RM 0.10 → 總注 RM 2。</p>',
            highlight: ['.lg-betpanel'], setup: () => demo.reveal('.lg-betpanel'),
            action: { label: '按「+」把每線注調到 RM 0.20', check: () => panel.lineBet() === 0.2 || `目前每線 ${cents(panel.lineBet())}` } },
          { id: 'layout-paytable', section: 'layout', title: `賠付表 <i class="en">Pay Table</i>`,
            body: '<p>賠付表的倍數乘<b>每線注</b>，不是總注。裡面也寫了特色規則與面額機率。</p>',
            highlight: ['.lg-paytable-btn'], setup: () => demo.reveal('.lg-paytable-btn'),
            action: { label: '打開「賠付表 Pay Table」看一下', check: () => state.paytableOpened || '按一下賠付表按鈕' } },
          // ===== flow
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：一轉怎麼進行',
            body: '<p>按旋轉 → 扣總注 → 轉軸逐軸停 → 算線獎 → 數金球。</p>',
            highlight: ['.hs-spin'] },
          { id: 'flow-spin', section: 'flow', title: `旋轉 <i class="en">SPIN</i>`,
            body: '<p>每按一次就扣一次總注。停下後亮起的線就是中獎線。</p>',
            highlight: ['.hs-spin', '.hs-reels'], setup: () => demo.reveal('.hs-spin'),
            action: { label: '按「旋轉 SPIN」轉一次', check: () => state.rounds > 0 || '按下旋轉鍵，等轉軸停下' } },
          { id: 'flow-locked', section: 'flow', title: '轉動中不能改注',
            body: '<p>按下旋轉後，這一轉的注額就定了：轉動中不能改注、也不能取消。</p>',
            highlight: ['.lg-betpanel'], setup: () => demo.reveal('.lg-betpanel') },
          { id: 'flow-trigger', section: 'flow', title: '6 顆金球 → 觸發',
            body: '<p>同一畫面出現 <b>6 顆以上</b>金球（任意位置）就觸發 Hold &amp; Spin。5 顆不算。</p>',
            highlight: ['.hs-reels .lg-slot__cell[data-sym="ORB"]', '.hs-meter'], setup: () => demo.show(6) },
          { id: 'flow-lock', section: 'flow', title: `鎖球 <i class="en">Hold</i>`,
            body: '<p>觸發時金球全部鎖定（金框 HOLD），其餘 9 格各自變成獨立轉軸。</p>',
            highlight: ['.hs-reels .lg-slot__cell.is-locked'], setup: () => demo.show(6, { lock: true, left: 3 }) },
          { id: 'flow-respins', section: 'flow', title: `再轉 3 次 <i class="en">Respins</i>`,
            body: '<p>一開始給 3 次再轉。一次沒新球 → 3 變 2；再沒有 → 1。</p>',
            highlight: ['.hs-respins'], setup: () => demo.show(6, { lock: true, left: 2 }) },
          { id: 'flow-reset', section: 'flow', title: '新球落下 → 重置為 3',
            body: '<p>只要有新球落下，它也被鎖住，而且次數<b>重置回 3</b>。3 次都沒新球才結束。</p>',
            highlight: ['.hs-respins'], setup: () => demo.show(7, { lock: true, left: 3 }) },
          { id: 'flow-try', section: 'flow', title: '玩一次 Hold & Spin',
            body: '<p>這次已安排 6 顆金球落下，看看鎖球、再轉、重置與最後加總。</p>',
            highlight: ['.hs-spin', '.hs-machine'],
            setup: () => { if (!state.busy) demo.forceTrigger(6); demo.reveal('.hs-spin'); },
            action: { label: '按「旋轉 SPIN」看完整特色', check: () => (state.features > 0 && !state.busy) || '按旋轉，等加總結束' } },
          // ===== payout
          { id: 'payout-intro', section: 'payout', title: '這段你會學到：特色怎麼算錢',
            body: '<p>結束時把<b>所有金球的面額加總</b>，就是特色贏分。</p>',
            highlight: ['.hs-meter'] },
          { id: 'payout-sum', section: 'payout', title: '8 顆金球加總',
            body: '<p>總注 RM 2，8 顆球 ×1 ×2 ×5 ×1 ×3 ×2 ×10 ×1：<br><b>(1+2+5+1+3+2+10+1) × RM 2 = 25 × RM 2 = RM 50</b></p>',
            highlight: ['.hs-reels'],
            setup: () => { if (!state.busy) { demo.setLineBet(0.1); demo.show(8, { lock: true, left: 0 }); } } },
          { id: 'payout-grand', section: 'payout', title: '15 格全滿 = GRAND',
            body: '<p>15 格全部是金球：所有面額加總，<b>再加 GRAND</b>（至少 RM 5,000）。這非常罕見。</p>',
            highlight: ['[data-jp="grand"]'] },
          { id: 'payout-line', section: 'payout', title: '線獎照賠付表',
            body: '<p>基礎遊戲的線獎：一線 3 個財神 = <b>50 × RM 0.10 = RM 5</b>（倍數 × 每線注）。</p>',
            highlight: ['.lg-paytable-btn'] },
          // ===== strategy
          { id: 'strategy-intro', section: 'strategy', title: '這段你會學到：RTP 與預算',
            body: '<table class="lg-datatable"><tr><th>項目</th><th>數值</th></tr><tr><td>RTP</td><td>94.5%</td></tr><tr><td>莊家優勢</td><td>5.5%</td></tr></table><p>長期每押 RM 100 平均拿回 RM 94.5。</p>',
            highlight: null },
          { id: 'strategy-rtp', section: 'strategy', title: 'Hold & Spin 是 RTP 的一部分',
            body: '<p>特色不是「送的錢」：94.5% 已經把特色算進去。平常轉輸掉的，就是在付特色的錢。</p>',
            highlight: ['.hs-machine'] },
          { id: 'strategy-grand', section: 'strategy', title: 'GRAND 機率極低',
            body: `<p>15 格全滿平均約 ${GRAND_ONE_IN.toLocaleString('en-US')} 轉才一次（總注 RM 2 要先押約 ${fmt(GRAND_ONE_IN * REF_BET)}）。別把 GRAND 當目標；獎池大也不代表「快開了」。</p>`,
            highlight: ['[data-jp="grand"]'] },
          { id: 'strategy-do', section: 'strategy', title: '該做 / 別做',
            body: '<p>該做：選一個能轉 200 次以上的每線注。<br>別做：輸了加注追回來——機台沒有記憶，這只是紀錄，不能預測。</p>',
            highlight: ['.lg-betpanel'], setup: () => demo.reveal('.lg-betpanel') },
          { id: 'strategy-budget', section: 'strategy', title: '預算',
            body: '<p>今晚只帶 RM 500，輸完就走。總注 RM 2 大約 250 轉，RM 10 只有 50 轉。</p>',
            highlight: ['.lg-topbar .lg-balance'] },
        ];
      }

      return {
        state,
        demo,
        view: () => view,
        panel: () => panel,
        mount(el0) {
          root = el0;
          root.classList.add('hs-root');
          buildTable();
          paintHints();
          ctx.on('hints:change', paintHints);
          if (ctx.isPractice) {
            ctx.strategyPanel(ui.table([
              ['項目', '數值'], ['RTP', '94.5%'], ['莊家優勢', '5.5%'], ['觸發', '6 顆金球'], ['GRAND', '15 格全滿'],
            ], { caption: 'Hold & Spin 已算在 RTP 裡' }));
          }
          setBusy(false);
          spinBtn.disabled = true;
          ctx.ready.then(() => {
            if (!alive) return;
            state.ready = true;
            setBusy(false);
            ctx.dealer.say(...T.ready);
          });
          root.dataset.ready = '1';
        },
        unmount() {
          alive = false;
          finalize();          // 結果在按下旋轉時已決定：中途離開照樣入帳
          if (view) view.destroy();
        },
        tutorialSteps,
      };
    },
  });
})();
