// ============================================================================
// 輪盤 Roulette（歐式單零）— id: roulette。規格：docs/05-game-rules/roulette.md
//
// 結算邏輯在本檔（純函式，放在 def.logic 供單元測試）：
//   spotNumbers(spotId) → 號碼陣列（已排序、凍結）；payout(spotId) → 淨賠倍數（35、17、11…）
//   settle(entries, n)  → {number, wagered, returned, net, lines}
// 桌面：CSS grid。手機直式 12 行 × 3 列（0 在頂、三列 2to1 在底、打與紅黑單雙大小在左側）；
//       桌機（≥ 900px）橫式標準 layout（0 在左、號碼 3 行 × 12 列）。
//       號碼格線上鋪透明熱區 .rl-hs（24px）供分注/街注/角注/線注/三數/首四，座標用 --x/--y（直式格線單位）。
// 輪盤：SVG 37 格（順序照規格）+ 球（requestAnimationFrame，3 秒 × LG.speed）；dolly 標記；最近 12 個號碼。
// ============================================================================
(() => {
  const { ui, money } = LG;
  const { el, term } = ui;
  const { fmt, round2 } = money;

  // ---------------------------------------------------------------- 文案（集中）
  const T = {
    name: { zh: '輪盤', en: 'Roulette' },
    summary: '歐式單零輪盤：押號碼、顏色或區段，球停在哪格就開哪個號碼。',
    type: {
      straight: { zh: '直注', en: 'Straight' },
      split: { zh: '分注', en: 'Split' },
      street: { zh: '街注', en: 'Street' },
      trio: { zh: '三數', en: 'Trio' },
      corner: { zh: '角注', en: 'Corner' },
      first4: { zh: '首四', en: 'First four' },
      line: { zh: '線注', en: 'Six line' },
      column: { zh: '列', en: 'Column' },
      dozen: { zh: '打', en: 'Dozen' },
      even: { zh: '1:1 外注', en: 'Even money' },
    },
    outside: {
      red: { zh: '紅', en: 'Red' },
      black: { zh: '黑', en: 'Black' },
      odd: { zh: '單', en: 'Odd' },
      even: { zh: '雙', en: 'Even' },
      low: { zh: '小', en: '1–18', label: '1–18 LOW' },
      high: { zh: '大', en: '19–36', label: '19–36 HIGH' },
    },
    dozenEn: ['1st 12', '2nd 12', '3rd 12'],
    colEn: '2 to 1',
    spinBtn: '轉球 <i class="en">Spin</i>',
    wheel: '輪盤 <i class="en">Wheel</i>',
    last: '開出 <i class="en">Result</i>',
    history: '最近 12 個號碼 <i class="en">Last 12</i>',
    historyNote: '只是紀錄，不能預測',
    legend: '點號碼正中 = 直注 <i class="en">Straight</i> 35:1；點格線上的小圓點 = 分注 <i class="en">Split</i> 17:1、'
      + '街注 <i class="en">Street</i> 11:1、角注 <i class="en">Corner</i> 8:1、線注 <i class="en">Six line</i> 5:1、'
      + '三數 <i class="en">Trio</i> 11:1、首四 <i class="en">First four</i> 8:1。',
    dolly: '標記 Dolly',
    zeroOutside: '開 0：所有外注都輸（本桌沒有 La Partage）。',
    evNote: '每一注的期望值都是 −2.70%（= −1/37），差別只是命中率與賠率。',
    insideMin: (x) => `內注合計最低 RM 25（目前 ${fmt(x)}）`,
    hintEmpty: '點號碼或格線放籌碼。命中機率 = 號碼數 ÷ 37；每種注的莊家優勢都是 2.70%。',
  };

  // ---------------------------------------------------------------- 規則常數
  /** 輪盤順序（順時針，自 0 起） */
  const WHEEL = Object.freeze([0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]);
  const RED = Object.freeze([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const RED_SET = new Set(RED);
  const ODDS = { straight: 35, split: 17, street: 11, trio: 11, corner: 8, first4: 8, line: 5, column: 2, dozen: 2, even: 1 };
  const INSIDE = new Set(['straight', 'split', 'street', 'trio', 'corner', 'first4', 'line']);
  /** 真實模式限注（雲頂近似，見 00-common.md §3） */
  const REAL = { outsideMin: 25, outsideMax: 3000, insideMin: 10, insideTotalMin: 25, straightMax: 500, insideMax: 3000 };
  const COUNTDOWN = 20;       // 真實模式倒數秒數
  const BALL_AT = 10;         // 倒數剩 10 秒發球（球在轉時仍可下注）
  const NMB_AT = 5;           // 倒數剩 5 秒喊 No more bets
  const SPIN_MS = 3000;       // 球落格動畫（× LG.speed）
  const EDGE = 2.70;

  const rowOf = (n) => Math.ceil(n / 3);      // 1..12（直式由上到下）
  const colOf = (n) => (n - 1) % 3;           // 0..2（col-1 = 1,4,7…）
  const colorOf = (n) => (n === 0 ? 'green' : RED_SET.has(n) ? 'red' : 'black');

  // ---------------------------------------------------------------- 下注格定義
  /** id → {id, type, nums, odds, inside, x?, y?}；x/y = 熱區在直式號碼區的格線座標（x 0..3、y 0..14） */
  const SPOTS = new Map();
  function addSpot(id, type, nums, pos = {}) {
    SPOTS.set(id, Object.freeze({
      id, type, nums: Object.freeze([...nums].sort((a, b) => a - b)), odds: ODDS[type], inside: INSIDE.has(type), ...pos,
    }));
  }
  for (let n = 0; n <= 36; n++) addSpot(`n-${n}`, 'straight', [n]);
  [1, 2, 3].forEach((k) => addSpot(`split-0-${k}`, 'split', [0, k], { x: k - 0.5, y: 1 }));
  addSpot('trio-0-1-2', 'trio', [0, 1, 2], { x: 1, y: 1 });
  addSpot('trio-0-2-3', 'trio', [0, 2, 3], { x: 2, y: 1 });
  addSpot('corner-0', 'first4', [0, 1, 2, 3], { x: 0, y: 1 });
  for (let n = 1; n <= 36; n++) {
    const r = rowOf(n), c = colOf(n);
    if (c < 2) addSpot(`split-${n}-${n + 1}`, 'split', [n, n + 1], { x: c + 1, y: r + 0.5 });
    if (r < 12) addSpot(`split-${n}-${n + 3}`, 'split', [n, n + 3], { x: c + 0.5, y: r + 1 });
    if (c < 2 && r < 12) addSpot(`corner-${n}`, 'corner', [n, n + 1, n + 3, n + 4], { x: c + 1, y: r + 1 });
  }
  for (let r = 1; r <= 12; r++) {
    const s = 3 * r - 2;
    addSpot(`street-${s}`, 'street', [s, s + 1, s + 2], { x: 0, y: r + 0.5 });
    if (r < 12) addSpot(`line-${s}`, 'line', [s, s + 1, s + 2, s + 3, s + 4, s + 5], { x: 0, y: r + 1 });
  }
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const ALL = range(1, 36);
  addSpot('red', 'even', RED);
  addSpot('black', 'even', ALL.filter((n) => !RED_SET.has(n)));
  addSpot('odd', 'even', ALL.filter((n) => n % 2 === 1));
  addSpot('even', 'even', ALL.filter((n) => n % 2 === 0));
  addSpot('low', 'even', range(1, 18));
  addSpot('high', 'even', range(19, 36));
  [1, 2, 3].forEach((d) => addSpot(`dozen-${d}`, 'dozen', range(12 * d - 11, 12 * d)));
  [1, 2, 3].forEach((k) => addSpot(`col-${k}`, 'column', ALL.filter((n) => colOf(n) === k - 1)));
  const EVEN_ORDER = ['low', 'even', 'red', 'black', 'odd', 'high'];

  // ---------------------------------------------------------------- 純邏輯（Node 可測）
  /** spotId 的號碼集合（已排序陣列）；未知 spot → null */
  function spotNumbers(spotId) { const s = SPOTS.get(spotId); return s ? s.nums : null; }
  /** spotId 的賠率（淨賠倍數，35 = 35:1）；未知 spot → null */
  function payout(spotId) { const s = SPOTS.get(spotId); return s ? s.odds : null; }

  /** 下注格名稱 {zh, en} */
  function spotName(spotId) {
    const s = SPOTS.get(spotId);
    if (!s) return { zh: spotId, en: spotId };
    const t = T.type[s.type];
    const nums = s.nums;
    switch (s.type) {
      case 'straight': return { zh: `直注 ${nums[0]}`, en: `Straight ${nums[0]}` };
      case 'split': case 'trio': case 'corner': case 'first4':
        return { zh: `${t.zh} ${nums.join('-')}`, en: `${t.en} ${nums.join('-')}` };
      case 'street': return { zh: `街注 ${nums[0]}-${nums[2]}`, en: `Street ${nums[0]}-${nums[2]}` };
      case 'line': return { zh: `線注 ${nums[0]}-${nums[5]}`, en: `Six line ${nums[0]}-${nums[5]}` };
      case 'dozen': { const d = Number(spotId.split('-')[1]); return { zh: `第 ${d} 打`, en: T.dozenEn[d - 1] }; }
      case 'column': { const k = Number(spotId.split('-')[1]); return { zh: `第 ${k} 列`, en: `Column ${k}` }; }
      default: {
        const o = T.outside[spotId];
        return spotId === 'low' || spotId === 'high' ? { zh: `${o.zh} ${o.en}`, en: spotId === 'low' ? 'Low' : 'High' } : o;
      }
    }
  }
  const spotLabel = (id) => spotName(id).zh;

  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = { 20: 'twenty', 30: 'thirty' };
  function numberWord(n) {
    const w = n < 20 ? ONES[n] : TENS[n - (n % 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
    return w[0].toUpperCase() + w.slice(1);
  }
  /** 荷官報號：{zh:'17 黑 單', en:'Seventeen black odd'} */
  function announce(n) {
    if (n === 0) return { zh: '0 綠', en: 'Zero green' };
    const red = RED_SET.has(n), odd = n % 2 === 1;
    return { zh: `${n} ${red ? '紅' : '黑'} ${odd ? '單' : '雙'}`, en: `${numberWord(n)} ${red ? 'red' : 'black'} ${odd ? 'odd' : 'even'}` };
  }
  /** 號碼屬性（中文） */
  function describe(n) {
    if (n === 0) return '綠色 0：不屬於紅黑、單雙、大小、打、列';
    return [RED_SET.has(n) ? '紅' : '黑', n % 2 ? '單' : '雙', n <= 18 ? '小 1–18' : '大 19–36',
      `第 ${Math.ceil(n / 12)} 打`, `第 ${colOf(n) + 1} 列`].join(' · ');
  }

  /**
   * 結算。entries = [[spotId, stake]]
   * @returns {{number, wagered, returned, net, lines:[{spot, stake, win, odds, pay, returned, formula, why}]}}
   *  returned = 拿回（含本金）；lines 依「外注 → 內注」排序（派彩順序）
   */
  function settle(entries, n) {
    let wagered = 0, returned = 0;
    const lines = entries.map(([spot, stake]) => {
      const s = SPOTS.get(spot);
      if (!s) throw Error('roulette: unknown spot ' + spot);
      stake = round2(stake);
      wagered += stake;
      const win = s.nums.includes(n);
      const name = spotLabel(spot);
      const set = s.nums.length <= 6 ? `{${s.nums.join(', ')}}` : `${s.nums.length} 個號碼`;
      if (win) {
        const pay = round2(stake * s.odds);
        const back = round2(stake + pay);
        returned += back;
        return { spot, stake, win: true, odds: s.odds, pay, returned: back,
          formula: `${name} ${fmt(stake)} × ${s.odds} = +${fmt(pay)}（淨贏；拿回 ${fmt(back)} 含本金）`,
          why: `${name}：${set} 含 ${n} → 中` };
      }
      return { spot, stake, win: false, odds: s.odds, pay: -stake, returned: 0,
        formula: `${name} ${fmt(stake)} → −${fmt(stake)}`,
        why: `${name}：${set} 不含 ${n} → 輸` };
    });
    lines.sort((a, b) => Number(SPOTS.get(a.spot).inside) - Number(SPOTS.get(b.spot).inside));
    wagered = round2(wagered); returned = round2(returned);
    return { number: n, wagered, returned, net: round2(returned - wagered), lines };
  }

  /** 內注合計 */
  function insideTotal(entries) {
    return round2(entries.reduce((a, [spot, amt]) => a + (SPOTS.get(spot) && SPOTS.get(spot).inside ? amt : 0), 0));
  }

  /** 真實模式每格限額（spotRules） */
  function realSpotRules() {
    const rules = {};
    for (const [id, s] of SPOTS) {
      rules[id] = s.inside
        ? { min: REAL.insideMin, max: s.type === 'straight' ? REAL.straightMax : REAL.insideMax }
        : { min: REAL.outsideMin, max: REAL.outsideMax };
    }
    return rules;
  }

  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  /** 注別總表（提示面板 / 教學） */
  const TYPE_ROWS = [
    ['直注 Straight', 1, 35], ['分注 Split', 2, 17], ['街注 Street／三數 Trio', 3, 11], ['角注 Corner／首四 First four', 4, 8],
    ['線注 Six line', 6, 5], ['打 Dozen／列 Column', 12, 2], ['紅黑／單雙／大小', 18, 1],
  ];

  // ---------------------------------------------------------------- 註冊
  LG.registerGame({
    id: 'roulette',
    category: 'table',
    order: 3,
    name: T.name,
    summary: T.summary,
    houseEdge: [
      { bet: { zh: '所有注（單零）', en: 'All bets (single zero)' }, edge: EDGE, best: true },
      { bet: { zh: '直注 35:1', en: 'Straight' }, edge: EDGE },
      { bet: { zh: '紅黑／單雙／大小 1:1', en: 'Even money' }, edge: EDGE },
    ],
    limits: { real: { min: REAL.outsideMin, max: REAL.outsideMax }, practice: { min: 10, max: 100000 } },
    denoms: [10, 25, 50, 100, 500, 1000],
    countdown: COUNTDOWN,
    logic: {
      WHEEL, RED, SPOTS, ODDS, REAL, EDGE, spotNumbers, payout, settle, spotName, spotLabel, announce, numberWord,
      describe, colorOf, insideTotal, realSpotRules,
    },

    create(ctx) {
      const real = ctx.isReal;
      const state = {
        phase: 'idle', rounds: 0, spins: 0, staked: 0, result: null, history: [],
        spin: null, ballLaunched: false, forced: null,
      };
      const labels = {};
      for (const id of SPOTS.keys()) labels[id] = spotLabel(id);
      const bets = new LG.Bets(real
        ? { min: REAL.insideMin, max: Infinity, perSpotMin: REAL.insideMin, perSpotMax: REAL.outsideMax, spotRules: realSpotRules(), labels }
        : { min: ctx.limits.min, max: Infinity, perSpotMin: ctx.limits.min, perSpotMax: ctx.limits.max, labels });
      if (real) {
        // 自訂驗證：每格限額（spotRules）之外，加上「內注合計 ≥ RM 25」
        const base = bets.validate.bind(bets);
        bets.validate = () => {
          const v = base();
          if (v.errors.some((e) => e.reason === 'EMPTY')) return v;
          const inside = insideTotal(bets.entries());
          if (inside > 0 && inside < REAL.insideTotalMin - 1e-9) {
            v.errors.push({ spot: null, reason: 'BELOW_MIN', limit: REAL.insideTotalMin, zh: T.insideMin(inside) });
            v.ok = false;
            v.zh = v.errors.map((e) => e.zh).join('；');
          }
          return v;
        };
      }

      let root, tableEl, board, hintEl, tray, layer, bar, lastEl, historyEl, dollyEl = null;
      let wheelG, ballG, ball;
      const spotEls = new Map();
      const pocketEls = new Map();
      const anim = { wheel: 0, ball: 0, r: 69, raf: 0, mode: 'idle', token: 0 };

      // ---- 桌面 ------------------------------------------------------------
      const gridVars = (p, l) => `--pr:${p[0]};--pc:${p[1]};--prs:${p[2] || 1};--pcs:${p[3] || 1};`
        + `--lr:${l[0]};--lc:${l[1]};--lrs:${l[2] || 1};--lcs:${l[3] || 1}`;

      function cell(id, cls, style, zh, en, odds) {
        const s = SPOTS.get(id);
        const nm = spotName(id);
        const e = el('div', {
          class: ['lg-spot', 'rl-cell', ...cls], dataset: { bet: id }, style,
          title: `${nm.zh} ${nm.en} ${s.odds}:1`, 'aria-label': `${nm.zh} ${nm.en} ${s.odds}:1`,
        }, [
          el('span.lg-spot__zh', { text: zh }),
          en ? el('span.lg-spot__en', { text: en }) : null,
          el('span.lg-spot__odds', { text: odds || `${s.odds}:1` }),
        ]);
        spotEls.set(id, e);
        return e;
      }

      function buildBoard() {
        board = el('div.rl-board');
        board.appendChild(cell('n-0', ['rl-num', 'is-green'], gridVars([1, 3, 1, 3], [1, 1, 3, 1]), '0'));
        for (let n = 1; n <= 36; n++) {
          const r = rowOf(n), c = colOf(n);
          board.appendChild(cell(`n-${n}`, ['rl-num', `is-${colorOf(n)}`], gridVars([r + 1, 3 + c], [3 - c, r + 1]), String(n)));
        }
        [1, 2, 3].forEach((k) => board.appendChild(
          cell(`col-${k}`, ['rl-out', 'rl-col'], gridVars([14, 2 + k], [4 - k, 14]), `第${k}列`, T.colEn)));
        [1, 2, 3].forEach((d) => board.appendChild(
          cell(`dozen-${d}`, ['rl-out', 'rl-dozen'], gridVars([2 + 4 * (d - 1), 2, 4], [4, 2 + 4 * (d - 1), 1, 4]), `第${d}打`, T.dozenEn[d - 1])));
        EVEN_ORDER.forEach((id, i) => {
          const o = T.outside[id];
          board.appendChild(cell(id, ['rl-out', 'rl-even', `rl-even--${id}`], gridVars([2 + 2 * i, 1, 2], [5, 2 + 2 * i, 1, 2]), o.zh, o.label || o.en));
        });
        // 格線熱區
        const hot = el('div.rl-hot', { style: gridVars([1, 3, 14, 3], [1, 1, 3, 14]) });
        for (const s of SPOTS.values()) {
          if (s.x === undefined) continue;
          const nm = spotName(s.id);
          const h = el('div', {
            class: ['lg-spot', 'rl-hs', `rl-hs--${s.type}`], dataset: { bet: s.id },
            style: `--x:${s.x};--y:${s.y}`, title: `${nm.zh} ${nm.en} ${s.odds}:1`, 'aria-label': `${nm.zh} ${nm.en} ${s.odds}:1`,
          });
          spotEls.set(s.id, h);
          hot.appendChild(h);
        }
        board.appendChild(hot);
        return board;
      }

      function buildWheel() {
        const P = (r, a) => { const t = (a * Math.PI) / 180; return `${(r * Math.sin(t)).toFixed(2)},${(-r * Math.cos(t)).toFixed(2)}`; };
        const th = 360 / 37;
        const svg = el('svg', { viewBox: '-100 -100 200 200', class: 'rl-wheel', role: 'img', 'aria-label': '輪盤 Roulette wheel' });
        svg.appendChild(el('circle', { r: 99, class: 'rl-wheel__rim' }));
        svg.appendChild(el('circle', { r: 95, class: 'rl-wheel__track' }));
        wheelG = el('g', { class: 'rl-wheel__rot' });
        WHEEL.forEach((n, i) => {
          const a0 = (i - 0.5) * th, a1 = (i + 0.5) * th;
          const p = el('path', {
            class: ['rl-pocket', `is-${colorOf(n)}`], dataset: { n },
            d: `M${P(88, a0)} A88 88 0 0 1 ${P(88, a1)} L${P(60, a1)} A60 60 0 0 0 ${P(60, a0)} Z`,
          });
          pocketEls.set(n, p);
          wheelG.appendChild(p);
          wheelG.appendChild(el('text', { class: 'rl-pocket__n', x: 0, y: -79, transform: `rotate(${(i * th).toFixed(2)})`, text: String(n) }));
        });
        wheelG.appendChild(el('circle', { r: 60, class: 'rl-wheel__cone' }));
        wheelG.appendChild(el('circle', { r: 36, class: 'rl-wheel__hub' }));
        for (let k = 0; k < 4; k++) wheelG.appendChild(el('path', { class: 'rl-wheel__turret', d: 'M-3,0 L0,-30 L3,0 Z', transform: `rotate(${k * 90})` }));
        wheelG.appendChild(el('circle', { r: 7, class: 'rl-wheel__knob' }));
        svg.appendChild(wheelG);
        ballG = el('g', { class: 'rl-ball-rot' });
        ball = el('circle', { class: 'rl-ball', cx: 0, cy: -69, r: 4.6 });
        ballG.appendChild(ball);
        svg.appendChild(ballG);
        return svg;
      }

      function buildTable() {
        lastEl = el('div.rl-last', { dataset: { role: 'last' } });
        historyEl = el('div.rl-history', { 'aria-label': '最近 12 個號碼 Last 12' });
        const info = el('div.rl-info', [
          el('div.rl-info__k', { html: T.last }), lastEl,
          el('div.rl-history-wrap', [el('div.rl-info__k', { html: `${T.history}<br><small>${T.historyNote}</small>` }), historyEl]),
        ]);
        tableEl = el('div.lg-table.rl-table', [
          el('div.rl-wheelzone', [el('div.rl-wheelbox', [buildWheel()]), info]),
          el('p.rl-legend', { html: T.legend }),
          buildBoard(),
        ]);
        const actions = el('div.lg-actions', { dataset: { dealSlot: '' } });
        const chips = el('div');
        const barEl = el('div');
        hintEl = el('div.lg-hint.rl-hint', { hidden: true });
        root.append(tableEl, hintEl, actions, chips, barEl);
        tray = ui.chipTray(chips, { denoms: ctx.denoms, selected: real ? 25 : 10 });
        layer = ui.betLayer(tableEl, { bets, chipTray: tray, gameId: ctx.gameId });
        bar = ui.betBar(barEl, { bets, layer });
        paintLast();
        render();
      }

      // ---- 輪盤動畫 --------------------------------------------------------
      const reduced = () => { try { return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; } };
      const now = () => (globalThis.performance ? performance.now() : Date.now());
      const raf = (fn) => (globalThis.requestAnimationFrame ? requestAnimationFrame(fn) : setTimeout(() => fn(now()), 16));
      const caf = (id) => { if (globalThis.cancelAnimationFrame) cancelAnimationFrame(id); clearTimeout(id); };
      function render() {
        if (!wheelG) return;
        wheelG.setAttribute('transform', `rotate(${(anim.wheel % 360).toFixed(2)})`);
        ballG.setAttribute('transform', `rotate(${(anim.ball % 360).toFixed(2)})`);
        ball.setAttribute('cy', (-anim.r).toFixed(2));
      }
      /** 發球：球在外軌自由轉（下注仍開放） */
      function launchBall() {
        if (anim.mode !== 'idle' || !wheelG) return;
        anim.mode = 'orbit';
        anim.r = 92;
        pocketEls.forEach((p) => p.classList.remove('is-hit'));
        const tok = ++anim.token;
        let last = now();
        const tick = () => {
          if (anim.token !== tok || anim.mode !== 'orbit' || !ctx.alive()) return;
          const t = now(), dt = t - last; last = t;
          const k = dt / Math.max(0.05, LG.speed);
          anim.wheel += 0.04 * k;
          anim.ball -= 0.8 * k;
          render();
          anim.raf = raf(tick);
        };
        anim.raf = raf(tick);
      }
      /** 球落格：SPIN_MS（× LG.speed）減速停在號碼 n；回傳 Promise */
      function land(n, { record = true } = {}) {
        caf(anim.raf);
        const tok = ++anim.token;
        const dur = reduced() ? 0 : LG.ms(SPIN_MS);
        const w0 = anim.wheel, w1 = w0 + 140;
        const b0 = anim.ball, r0 = anim.mode === 'orbit' ? anim.r : 92;
        const want = b0 - 720;
        let b1 = w1 + WHEEL.indexOf(n) * (360 / 37);
        b1 -= 360 * Math.ceil((b1 - want) / 360);
        anim.mode = 'landing';
        pocketEls.forEach((p) => p.classList.remove('is-hit'));
        const t0 = now();
        const ease = (t) => 1 - Math.pow(1 - t, 3);
        const tick = () => {
          if (anim.token !== tok || !ctx.alive()) return;
          const t = dur ? Math.min(1, (now() - t0) / dur) : 1;
          const e = ease(t);
          anim.wheel = w0 + (w1 - w0) * e;
          anim.ball = b0 + (b1 - b0) * e;
          anim.r = r0 + (69 - r0) * Math.max(0, (t - 0.55) / 0.45);
          render();
          if (t < 1) anim.raf = raf(tick);
        };
        anim.raf = raf(tick);
        return ctx.wait(reduced() ? 150 : SPIN_MS).then(() => {
          if (anim.token !== tok) return;
          caf(anim.raf);
          anim.wheel = w1 % 360; anim.ball = b1 % 360; anim.r = 69; anim.mode = 'idle';
          render();
          const p = pocketEls.get(n);
          if (p && record) p.classList.add('is-hit');
        });
      }

      // ---- 桌面狀態 --------------------------------------------------------
      function paintLast() {
        const n = state.result;
        lastEl.innerHTML = '';
        if (n === null) { lastEl.appendChild(el('span.rl-last__n.is-empty', { text: '–' })); }
        else {
          const a = announce(n);
          lastEl.dataset.n = String(n);
          lastEl.append(
            el('span', { class: ['rl-last__n', `is-${colorOf(n)}`], text: String(n) }),
            el('span.rl-last__t', { html: `${a.zh}<br><i class="en">${a.en}</i>` }),
          );
        }
        historyEl.innerHTML = '';
        state.history.forEach((h, i) => historyEl.appendChild(el('span', { class: ['rl-hist', `is-${colorOf(h)}`, i === 0 && 'is-new'], text: String(h), dataset: { n: h } })));
      }
      function placeDolly(n) {
        removeDolly();
        const c = spotEls.get(`n-${n}`);
        if (!c) return;
        dollyEl = el('span.rl-dolly', { title: T.dolly, 'aria-label': T.dolly });
        c.appendChild(dollyEl);
      }
      function removeDolly() { if (dollyEl) { dollyEl.remove(); dollyEl = null; } }
      function clearMarks() {
        if (!tableEl) return;
        tableEl.querySelectorAll('.is-win, .is-lose').forEach((x) => x.classList.remove('is-win', 'is-lose'));
      }
      function markBets(r) {
        clearMarks();
        r.lines.forEach((l) => { const e = spotEls.get(l.spot); if (e) e.classList.add(l.win ? 'is-win' : 'is-lose'); });
      }

      // ---- 練習提示 --------------------------------------------------------
      function paintHints() {
        if (!hintEl) return;
        const on = ctx.isPractice && ctx.hints;
        hintEl.hidden = !on;
        if (!on) return;
        const es = bets.entries();
        if (!es.length) { hintEl.innerHTML = `提示：${T.hintEmpty}`; return; }
        hintEl.innerHTML = '提示：' + es.map(([id]) => {
          const s = SPOTS.get(id);
          return `<span class="rl-hint__row">${spotLabel(id)} · ${s.odds}:1 · 命中 ${s.nums.length}/37 = ${pct(s.nums.length / 37)}</span>`;
        }).join('') + `<span class="rl-hint__row">${T.evNote}</span>`;
      }
      function strategyTable() {
        return ui.table([['注別', '號碼數', '賠率', '命中率', '優勢'],
          ...TYPE_ROWS.map(([nm, k, o]) => [nm, String(k), `${o}:1`, pct(k / 37), `${EDGE.toFixed(2)}%`])], { caption: '每種注優勢都一樣：2.70%' });
      }

      // ---- 一局流程 --------------------------------------------------------
      function roll() {
        if (state.forced !== null) { const n = state.forced; state.forced = null; return n; }
        return LG.rng.int(0, 36);
      }
      function startRound() {
        if (!ctx.alive()) return;
        state.phase = 'betting';
        state.ballLaunched = false;
        state.spin = null;
        if (real) { clearMarks(); removeDolly(); }   // 荷官拿走 dolly 後才能再下注
        bets.unlock();
        // 真實：closeAt → 剩 5 秒時框架喊 No more bets 並鎖注，倒數跑完才 onClose
        ctx.bettingWindow({ bets, seconds: COUNTDOWN, label: T.spinBtn, onTick: real ? onTick : undefined, onClose: onNoMoreBets,
          closeAt: real ? NMB_AT : undefined, onNoMoreBets: callNoMoreBets });
      }
      function onTick(n) {
        if (state.phase !== 'betting') return;
        if (n <= BALL_AT && !state.ballLaunched) { state.ballLaunched = true; launchBall(); }
      }
      /** 真實模式：倒數剩 5 秒（框架已喊 No more bets 並鎖注），球開始減速落格 */
      function callNoMoreBets() {
        if (state.phase !== 'betting') return;
        if (!state.ballLaunched) { state.ballLaunched = true; launchBall(); }
        state.phase = 'closing';
        state.result = roll();
        state.spin = land(state.result);
      }
      async function onNoMoreBets({ ok, validation }) {
        if (!ctx.alive()) return;
        if (state.phase === 'betting') {           // 練習/教學按「轉球」
          state.phase = 'closing';
          state.result = roll();
          state.spin = land(state.result);
        }
        const n = state.result;
        const play = !!ok;
        if (play) { state.staked = bets.total(); ctx.bank.debit(state.staked); }
        else if (bets.total() > 0) ui.toast(validation.zh || '下注不合法', { type: 'warn', ms: 2600 });
        state.phase = 'spinning';
        await state.spin;
        if (!ctx.alive()) return;
        finishRound(n, play);
      }
      function finishRound(n, play) {
        state.phase = 'settled';
        state.spins += 1;
        state.history.unshift(n);
        if (state.history.length > 12) state.history.length = 12;
        paintLast();
        placeDolly(n);
        const a = announce(n);
        ctx.dealer.say(a.zh, a.en);
        if (play) {
          const r = settle(bets.entries(), n);
          ctx.bank.credit(r.returned);
          state.staked = 0;
          state.rounds += 1;
          markBets(r);
          ctx.recordRound({ wagered: r.wagered, net: r.net, outcome: r.net > 0 ? 'win' : r.net < 0 ? 'lose' : 'push' });
          const wins = r.lines.filter((l) => l.win).length;
          const hasOutside = r.lines.some((l) => !SPOTS.get(l.spot).inside);
          ctx.explain({
            hand: `開出 <b class="rl-badge is-${colorOf(n)}">${n}</b> ${describe(n)}`,
            result: `${a.zh} <i class="en">${a.en}</i> — 中 ${wins} / ${r.lines.length} 注`,
            formula: r.lines.map((l) => l.formula).join('<br>') + `<br>淨 <b>${money.fmtSigned(r.net)}</b>（派彩順序：外注 → 內注）`,
            why: r.lines.map((l) => l.why).join('<br>') + (n === 0 && hasOutside ? `<br>${T.zeroOutside}` : '') + `<br>${T.evNote}`,
            net: r.net,
          });
        }
        bets.clear();                               // 上一注存在 bets.last → 重複上注
        if (!real) bets.unlock();                   // 真實：dolly 拿走（下一局開始）前維持鎖定
        ctx.checkBroke();
        if (real) ctx.nextRound(startRound);
        else ctx.later(() => ctx.nextRound(startRound), 1500);   // 讓報號留在橫幅上一下
      }

      // 練習/教學：一碰桌面（改注）就視為荷官已拿走 dolly
      bets.subscribe(() => {
        paintHints();
        if (!real && !bets.locked && (state.phase === 'betting' || state.phase === 'settled') && bets.total() > 0) {
          removeDolly(); clearMarks();
        }
      });

      // ---- 教學 ------------------------------------------------------------
      const demo = {
        showBanner(zh, en) { ctx.dealer.say(zh, en); },
        showDolly(n) { placeDolly(n); },
        clearDolly() { removeDolly(); },
        /** 把元素捲到畫面上方 28%（避免被教學工作表蓋住） */
        focus(sel) {
          const e = root && root.querySelector(sel);
          if (!e || !e.getBoundingClientRect || !globalThis.scrollBy) return;
          const r = e.getBoundingClientRect();
          globalThis.scrollBy(0, r.top - (globalThis.innerHeight || 800) * 0.28);
        },
        setBets(obj) { if (bets.locked || state.phase === 'spinning' || state.phase === 'closing') return; bets.restore(obj); },
        /** 示範發球（不開獎）：轉 2 秒後落在隨機格 */
        spinShow() {
          if (anim.mode !== 'idle' || state.phase === 'spinning' || state.phase === 'closing') return;
          launchBall();
          ctx.later(() => { if (anim.mode === 'orbit' && state.phase !== 'spinning' && state.phase !== 'closing') land(LG.rng.pick([...WHEEL]), { record: false }); }, 2000);
        },
        /** 測試/示範：指定下一球號碼 */
        forceNext(n) { state.forced = n; },
        ensureBetting() { if (state.phase === 'idle') startRound(); },
      };

      const hs = (id) => [`[data-bet="${id}"]`];
      const placeStep = (id, section, title, bodyHtml, spot) => ({
        id, section, title, body: bodyHtml, highlight: hs(spot),
        setup: (inst) => inst.demo.focus(`[data-bet="${spot}"]`),
        action: {
          label: `在發亮的熱區放一枚籌碼（${spotLabel(spot)}）`,
          check: (inst) => inst.bets.get(spot) > 0 || `點金色閃爍的位置（${spotLabel(spot)}）；被擋住可先收起教學面板 ▾`,
        },
      });

      function tutorialSteps() {
        const edgeTable = '<table class="lg-datatable"><tr><th>注</th><th>賠率</th><th>命中</th><th>優勢</th></tr>'
          + TYPE_ROWS.map(([nm, k, o]) => `<tr><td>${nm.split(/[ ／]/)[0]}</td><td>${o}:1</td><td>${k}/37</td><td>2.70%</td></tr>`).join('')
          + '</table>';
        return [
          // ===== layout 桌面
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：輪盤桌面',
            body: `<p>上方是${T.wheel}，下方是下注桌布 <i class="en">Layout</i>。先認識每一格，再學 7 種內注怎麼放。</p>`,
            highlight: ['.rl-table'] },
          { id: 'layout-numbers', section: 'layout', title: '號碼區 1–36',
            body: '<p>12 橫排 × 3 格，每排 3 個號碼（1-2-3、4-5-6…）。紅、黑各 18 個。</p>',
            highlight: ['.rl-num.is-red', '.rl-num.is-black'] },
          { id: 'layout-zero', section: 'layout', title: '0 格 <i class="en">Zero</i>',
            body: '<p>綠色的 0 不算紅黑、單雙、大小，也不在任何打或列裡。</p>',
            highlight: hs('n-0') },
          { id: 'layout-columns', section: 'layout', title: '列 <i class="en">Column</i> 2 to 1',
            body: '<p>底端三格「2 to 1」各押一整直列 12 個號碼，賠 2:1。第 1 列 = 1、4、7…34。</p>',
            highlight: ['[data-bet^="col-"]'], setup: (inst) => inst.demo.focus('[data-bet="col-1"]') },
          { id: 'layout-dozens', section: 'layout', title: '打 <i class="en">Dozen</i>',
            body: '<p>第 1 打 = 1–12、第 2 打 = 13–24、第 3 打 = 25–36，賠 2:1。</p>',
            highlight: ['[data-bet^="dozen-"]'] },
          { id: 'layout-even', section: 'layout', title: '紅黑、單雙、大小',
            body: '<p>這六格都賠 1:1：紅 <i class="en">Red</i>／黑 <i class="en">Black</i>、單 <i class="en">Odd</i>／雙 <i class="en">Even</i>、小 1–18／大 19–36。</p>',
            highlight: EVEN_ORDER.map((x) => `[data-bet="${x}"]`) },
          placeStep('layout-straight', 'layout', '直注 <i class="en">Straight</i> 35:1',
            '<p>點號碼格<b>正中央</b> = 只押這一個號碼，賠 35:1。</p>', 'n-17'),
          placeStep('layout-split', 'layout', '分注 <i class="en">Split</i> 17:1',
            '<p>點兩個相鄰號碼<b>中間的線</b> = 同時押這兩號，賠 17:1。例：17 與 20。</p>', 'split-17-20'),
          placeStep('layout-street', 'layout', '街注 <i class="en">Street</i> 11:1',
            '<p>點一排號碼<b>外側的端線</b>（靠「打」那邊）= 押整排 3 個號碼，賠 11:1。例：16-17-18。</p>', 'street-16'),
          placeStep('layout-corner', 'layout', '角注 <i class="en">Corner</i> 8:1',
            '<p>點四個號碼的<b>交叉點</b> = 押這 4 個號碼，賠 8:1。例：17-18-20-21。</p>', 'corner-17'),
          placeStep('layout-line', 'layout', '線注 <i class="en">Six line</i> 5:1',
            '<p>點兩排外側端線的<b>交界</b> = 押上下兩排共 6 個號碼，賠 5:1。例：16–21。</p>', 'line-16'),
          placeStep('layout-trio', 'layout', '三數 <i class="en">Trio</i> 11:1',
            '<p>點 0 與 1、2 的交叉點 = 押 0-1-2，賠 11:1（0-2-3 同理）。</p>', 'trio-0-1-2'),
          placeStep('layout-first-four', 'layout', '首四 <i class="en">First four</i> 8:1',
            '<p>點 0 下緣的<b>外側角</b> = 押 0-1-2-3 四個號碼，賠 8:1。</p>', 'corner-0'),
          { id: 'layout-wheel', section: 'layout', title: '輪盤順序 <i class="en">Wheel</i>',
            body: '<p>輪盤上號碼不是照 1–36 排，而是紅黑交錯，0 夾在 32 和 26 之間。</p>',
            highlight: ['.rl-wheel'], setup: (inst) => inst.demo.focus('.rl-wheel') },
          // ===== flow 流程
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：一局怎麼進行',
            body: '<p>請下注 → 發球 → 停止下注 → 球落格 → 放 dolly → 收輸注、派彩。</p>',
            highlight: ['.lg-dealer-banner'],
            setup: (inst) => { inst.demo.ensureBetting(); inst.demo.showBanner('請下注', 'Place your bets'); } },
          { id: 'flow-ball', section: 'flow', title: '球在轉，還能下注',
            body: '<p>荷官發球 <i class="en">Spin</i> 後，球在外圈轉的前幾秒你仍可放籌碼。</p>',
            highlight: ['.rl-wheel'], setup: (inst) => { inst.demo.focus('.rl-wheel'); inst.demo.spinShow(); } },
          { id: 'flow-no-more-bets', section: 'flow', title: '停止下注 <i class="en">No more bets</i>',
            body: '<p>球快停時荷官喊 <b>No more bets</b>。之後手放桌下，加、減、移動籌碼都不行。</p>',
            highlight: ['.lg-dealer-banner'], setup: (inst) => inst.demo.showBanner('停止下注', 'No more bets') },
          { id: 'flow-dolly', section: 'flow', title: '標記 <i class="en">Dolly</i>',
            body: '<p>球停後荷官把 dolly 放在開出的號碼上。<b>dolly 沒拿走之前，不能碰任何籌碼。</b></p>',
            highlight: ['[data-bet="n-17"]'],
            setup: (inst) => { inst.demo.showDolly(17); inst.demo.focus('[data-bet="n-17"]'); inst.demo.showBanner('17 黑 單', 'Seventeen black odd'); } },
          { id: 'flow-chips', section: 'flow', title: '輪盤籌碼 <i class="en">Roulette chips</i>',
            body: '<p>真賭場每位玩家換一種顏色的個人色碼籌碼，荷官靠顏色分辨誰的注。這裡用一般籌碼代替。</p>',
            highlight: ['.lg-chips'] },
          { id: 'flow-spin', section: 'flow', title: '轉一球 <i class="en">Spin</i>',
            body: '<p>桌上已有你剛放的籌碼。按「轉球」看球落格、dolly、派彩。</p>',
            highlight: ['[data-action="deal"]'],
            setup: (inst) => { inst.demo.ensureBetting(); inst.demo.focus('[data-action="deal"]'); },
            action: { label: '按「轉球 Spin」玩一局', check: (inst) => inst.state.rounds > 0 || '桌上要有籌碼，再按「轉球」' } },
          // ===== payout 賠率
          { id: 'payout-intro', section: 'payout', title: '這段你會學到：賠率怎麼算',
            body: '<p>35:1 = 押 1 淨贏 35，另外拿回本金。輸了只輸那一注。</p>',
            highlight: ['[data-bet="n-17"] .lg-spot__odds'] },
          { id: 'payout-straight', section: 'payout', title: '直注 35:1',
            body: '<p>直注 17 押 RM 10，開 17：<br><b>RM 10 × 35 = RM 350</b>（淨贏）<br>拿回 RM 360（含本金）。</p>',
            highlight: hs('n-17'), setup: (inst) => { inst.demo.setBets({ 'n-17': 10 }); inst.demo.showDolly(17); inst.demo.focus('[data-bet="n-17"]'); } },
          { id: 'payout-split', section: 'payout', title: '分注 17:1',
            body: '<p>分注 17-20 押 RM 10，開 20：<br><b>RM 10 × 17 = RM 170</b>（淨贏）<br>拿回 RM 180（含本金）。</p>',
            highlight: hs('split-17-20'), setup: (inst) => { inst.demo.setBets({ 'split-17-20': 10 }); inst.demo.showDolly(20); } },
          { id: 'payout-outside', section: 'payout', title: '外注 1:1',
            body: '<p>紅押 RM 25，開 19（紅）：<br><b>RM 25 × 1 = RM 25</b>（淨贏）<br>拿回 RM 50（含本金）。</p>',
            highlight: hs('red'), setup: (inst) => { inst.demo.setBets({ red: 25 }); inst.demo.showDolly(19); inst.demo.focus('[data-bet="red"]'); } },
          { id: 'payout-combo', section: 'payout', title: '一球同時算 3 注',
            body: '<p>直注 17 RM 10、分注 17-20 RM 10、紅 RM 25，開 17 黑：<br>+RM 350 +RM 170 −RM 25 = <b>淨 +RM 495</b></p>',
            highlight: ['[data-bet="n-17"]', '[data-bet="split-17-20"]', '[data-bet="red"]'],
            setup: (inst) => { inst.demo.setBets({ 'n-17': 10, 'split-17-20': 10, red: 25 }); inst.demo.showDolly(17); inst.demo.focus('[data-bet="n-17"]'); } },
          // ===== strategy 策略
          { id: 'strategy-edge', section: 'strategy', title: '這段你會學到：莊家優勢 <i class="en">House edge</i>',
            body: `<p>單零輪盤每一注優勢都是 <b>2.70%</b>（= 1/37）。</p>${edgeTable}`,
            highlight: null },
          { id: 'strategy-variance', section: 'strategy', title: '差別只是波動',
            body: '<p>直注很少中，中一次賠很多；紅黑常中，賠得少。長期每押 RM 100 平均都輸 RM 2.70。</p>',
            highlight: ['[data-bet="n-17"]', '[data-bet="red"]'] },
          { id: 'strategy-hot', section: 'strategy', title: '別信「熱門號」',
            body: '<p>最近 12 個號碼<b>只是紀錄，不能預測</b>。每一球都是獨立的 1/37，輪盤沒有記憶。</p>',
            highlight: ['.rl-history-wrap'], setup: (inst) => inst.demo.focus('.rl-wheel') },
          { id: 'strategy-zero', section: 'strategy', title: '0 讓外注輸',
            body: '<p>優勢來自 0：押紅時 18 個號碼贏、19 個輸。本桌沒有 La Partage，開 0 外注全輸。</p>',
            highlight: hs('n-0'), setup: (inst) => inst.demo.focus('[data-bet="n-0"]') },
          { id: 'strategy-do', section: 'strategy', title: '該押',
            body: '<p>任選一種注、固定小額。想玩久一點押紅黑／單雙；想要刺激就小額直注。</p>',
            highlight: EVEN_ORDER.map((x) => `[data-bet="${x}"]`) },
          { id: 'strategy-dont', section: 'strategy', title: '別押',
            body: '<p>別把 37 個號碼全鋪滿：每號 RM 10 共 RM 370，中一號拿回 RM 360，<b>每球固定輸 RM 10</b>。</p>',
            highlight: ['.rl-num'] },
          { id: 'strategy-budget', section: 'strategy', title: '預算',
            body: '<p>今晚只帶 RM 500，輸完就走。注碼小一點能玩久一點，但長期仍是 −2.70%。</p>',
            highlight: ['.lg-topbar .lg-balance'] },
        ];
      }

      // ---- instance ----------------------------------------------------------
      return {
        bets,
        state,
        tray: () => tray,
        demo,
        el: (id) => spotEls.get(id),
        mount(el0) {
          root = el0;
          buildTable();
          paintHints();
          ctx.on('hints:change', paintHints);
          if (ctx.isPractice) ctx.strategyPanel(strategyTable());
          root.dataset.ready = '1';
          startRound();
        },
        unmount() {
          anim.token += 1;
          caf(anim.raf);
          if (state.staked > 0) { ctx.bank.credit(state.staked); state.staked = 0; }
          if (layer) layer.destroy();
          if (bar) bar.destroy();
        },
        tutorialSteps,
      };
    },
  });
})();
