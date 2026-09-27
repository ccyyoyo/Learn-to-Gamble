// LG.slots — 轉軸、賠付線、Scatter、RTP 模擬（純邏輯）。見 docs/02-architecture.md §2.12、slot-video.md
(() => {
  const LG = globalThis.LG;

  /**
   * 轉一次：每軸隨機停點，取連續 rows 格（環狀）。
   * @param {string[][]} strips 每軸的符號帶
   * @param {number} [rows=3]
   * @returns {string[][]} grid[reel][row]；另附 grid.stops（每軸停點索引，row 0 = strip[stop]）
   */
  function spin(strips, rows = 3) {
    const grid = [];
    const stops = [];
    for (const strip of strips) {
      const stop = LG.rng.int(0, strip.length - 1);
      stops.push(stop);
      const col = [];
      for (let r = 0; r < rows; r++) col.push(strip[(stop + r) % strip.length]);
      grid.push(col);
    }
    Object.defineProperty(grid, 'stops', { value: stops, enumerable: false });
    return grid;
  }

  /**
   * 由停點組出 grid（教學/測試指定畫面用）。
   * @param {string[][]} strips
   * @param {number[]} stops
   * @param {number} [rows=3]
   * @returns {string[][]}
   */
  function gridAt(strips, stops, rows = 3) {
    return strips.map((strip, i) => {
      const col = [];
      for (let r = 0; r < rows; r++) col.push(strip[(stops[i] + r) % strip.length]);
      return col;
    });
  }

  /** 5×3 標準 20 線（row 0 上、1 中、2 下）。LINES_20[0] = 第 1 線。 */
  const LINES_20 = [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
    [0, 0, 1, 0, 0], [2, 2, 1, 2, 2], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
    [2, 1, 1, 1, 2], [1, 0, 1, 0, 1], [1, 2, 1, 2, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
    [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 2, 0, 0], [2, 2, 0, 2, 2], [0, 2, 0, 2, 0],
  ];
  LINES_20.forEach(Object.freeze);
  Object.freeze(LINES_20);

  const payOf = (paytable, sym, count) => {
    const p = paytable[sym];
    if (!p) return 0;
    return Number(p[count]) || 0;
  };

  /** 評一條線的一個方向（seq 為依方向排列的 [sym, cell]）。 */
  function evalSeq(seq, paytable, wild, scatter) {
    let best = null;
    // (a) 純 Wild 開頭的連線
    let w = 0;
    while (w < seq.length && wild !== undefined && seq[w][0] === wild) w++;
    if (w > 0) {
      const m = payOf(paytable, wild, w);
      if (m > 0) best = { sym: wild, count: w, mult: m };
    }
    // (b) 第一個非 Wild 符號為目標，Wild 可替代
    if (w < seq.length) {
      const target = seq[w][0];
      if (target !== scatter) {
        let n = w;
        while (n < seq.length && (seq[n][0] === target || seq[n][0] === wild)) n++;
        const m = payOf(paytable, target, n);
        if (m > 0 && (!best || m > best.mult)) best = { sym: target, count: n, mult: m };
      }
    }
    if (best) best.cells = seq.slice(0, best.count).map((x) => x[1]);
    return best;
  }

  /**
   * 計算所有賠付線。規則：由左起連續（leftToRight:false 則左右兩向都算、取高）、
   * Wild 替代所有非 Scatter 符號、每線只取最高一種賠付、Scatter 不算線（用 countScatter）。
   * @param {string[][]} grid grid[reel][row]
   * @param {number[][]} lines 每條線的 row 陣列（例：LINES_20）
   * @param {Object<string, Object<number, number>>} paytable {SYM:{3:x,4:y,5:z}}，倍數乘「每線注」
   * @param {{wild?:string, scatter?:string, leftToRight?:boolean}} [opts]
   * @returns {{wins:Array<{line:number, lineNo:number, sym:string, count:number, mult:number, cells:number[][]}>, total:number}}
   *   line = lines 陣列索引（0 起）；lineNo = 線號（1 起）；cells = [[reel,row],...]；total = 各線倍數總和
   */
  function evalLines(grid, lines, paytable, { wild, scatter, leftToRight = true } = {}) {
    const wins = [];
    let total = 0;
    lines.forEach((line, li) => {
      const seq = line.map((row, reel) => [grid[reel][row], [reel, row]]);
      let best = evalSeq(seq, paytable, wild, scatter);
      if (!leftToRight) {
        const rb = evalSeq(seq.slice().reverse(), paytable, wild, scatter);
        if (rb && (!best || rb.mult > best.mult)) best = rb;
      }
      if (best) {
        wins.push({ line: li, lineNo: li + 1, sym: best.sym, count: best.count, mult: best.mult, cells: best.cells });
        total += best.mult;
      }
    });
    return { wins, total: Math.round(total * 1e6) / 1e6 };
  }

  /**
   * 計算 Scatter（任意位置）。
   * @param {string[][]} grid
   * @param {string} sym
   * @returns {{count:number, cells:number[][]}}
   */
  function countScatter(grid, sym) {
    const cells = [];
    grid.forEach((col, reel) => col.forEach((s, row) => { if (s === sym) cells.push([reel, row]); }));
    return { count: cells.length, cells };
  }

  /**
   * 通用 RTP 模擬。
   * @param {object} config
   * @param {string[][]} [config.strips] 轉軸帶（未提供 config.spin 時必填）
   * @param {number} [config.rows=3]
   * @param {()=>string[][]} [config.spin] 自訂產生畫面（預設 LG.slots.spin(strips, rows)）
   * @param {(grid:string[][])=>number|{win:number}} [config.evaluate] 回傳該轉總贏（與 bet 同單位；
   *   可在內部模擬免費轉/特色）。未提供時用 evalLines(grid, lines, paytable, opts).total × lineBet + features(grid)
   * @param {number[][]} [config.lines] @param {object} [config.paytable] @param {string} [config.wild] @param {string} [config.scatter]
   * @param {number} [config.lineBet=1] 預設模式下每線注
   * @param {(grid:string[][])=>number} [config.features] 預設模式下額外獎（與 bet 同單位）
   * @param {number} [config.bet] 每轉總注；預設 = evaluate 模式 1、線模式 lines.length × lineBet
   * @param {number} [spins=200000]
   * @returns {{rtp:number, hitRate:number, spins:number, totalBet:number, totalWin:number, maxWin:number}}
   *   rtp 為比例（0.94 = 94%）
   */
  function simulateRTP(config, spins = 200000) {
    const rows = config.rows || 3;
    const gen = config.spin || (() => spin(config.strips, rows));
    let evaluate = config.evaluate;
    let bet = config.bet;
    if (!evaluate) {
      const lineBet = config.lineBet || 1;
      const opts = { wild: config.wild, scatter: config.scatter, leftToRight: config.leftToRight !== false };
      evaluate = (grid) => evalLines(grid, config.lines, config.paytable, opts).total * lineBet
        + (config.features ? Number(config.features(grid)) || 0 : 0);
      if (bet === undefined) bet = config.lines.length * lineBet;
    }
    if (bet === undefined) bet = 1;
    let totalWin = 0, hits = 0, maxWin = 0;
    for (let i = 0; i < spins; i++) {
      const r = evaluate(gen());
      const w = typeof r === 'number' ? r : (r && Number(r.win)) || 0;
      totalWin += w;
      if (w > 0) hits++;
      if (w > maxWin) maxWin = w;
    }
    const totalBet = bet * spins;
    return { rtp: totalWin / totalBet, hitRate: hits / spins, spins, totalBet, totalWin, maxWin };
  }

  LG.slots = { spin, gridAt, LINES_20, evalLines, countScatter, simulateRTP };
})();
