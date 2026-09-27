// LG.money — 金額工具。所有金額以「元」浮點表示，加減後一律 round2。
// 見 docs/02-architecture.md §2.2
(() => {
  const LG = globalThis.LG;
  const MINUS = '−'; // 「−」顯示用減號

  function round2(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return 0;
    const s = n < 0 ? -1 : 1;
    const r = s * Math.round(Math.abs(n) * 100 + 1e-7) / 100;
    return r === 0 ? 0 : r; // 去掉 -0
  }

  function groupInt(intStr) {
    return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /**
   * 'RM 1,000'；有小數或 cents=true → 'RM 0.10'；負數 → '−RM 50'（U+2212）。
   * @param {number} n
   * @param {{cents?: boolean, sign?: boolean}} [opts] sign=true 時正數加 '+'
   */
  function fmt(n, { cents = false, sign = false } = {}) {
    const v = round2(n);
    const abs = Math.abs(v);
    const hasFrac = Math.round(abs * 100) % 100 !== 0;
    const fixed = abs.toFixed(cents || hasFrac ? 2 : 0);
    const [i, f] = fixed.split('.');
    const body = 'RM ' + groupInt(i) + (f ? '.' + f : '');
    if (v < 0) return MINUS + body;
    if (sign && v > 0) return '+' + body;
    return body;
  }

  LG.money = {
    fmt,
    /** '+RM 95' / '−RM 50' / 'RM 0' */
    fmtSigned: (n, opts = {}) => fmt(n, { ...opts, sign: true }),
    round2,
    add: (a, b) => round2(Number(a) + Number(b)),
    sub: (a, b) => round2(Number(a) - Number(b)),
    mul: (a, b) => round2(Number(a) * Number(b)),
    /** 加總陣列 */
    sum: (arr) => round2(arr.reduce((s, x) => s + Number(x || 0), 0)),
  };
})();
