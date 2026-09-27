// LG.rng — 亂數。預設 crypto.getRandomValues；LG.rng.seed(n) 切成可重現的 mulberry32（測試用）。
// 見 docs/02-architecture.md §2.1
(() => {
  const LG = globalThis.LG;
  const c = globalThis.crypto;
  const buf = new Uint32Array(1);

  function cryptoRandom() {
    if (c && typeof c.getRandomValues === 'function') {
      c.getRandomValues(buf);
      return buf[0] / 4294967296;
    }
    return Math.random();
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let source = cryptoRandom;

  const rng = {
    /** [0,1) */
    random() { return source(); },
    /** 整數，含 min 與 max 兩端 */
    int(min, max) {
      min = Math.ceil(min); max = Math.floor(max);
      return min + Math.floor(source() * (max - min + 1));
    },
    /** Fisher–Yates，原地打亂並回傳同一陣列 */
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(source() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
    pick(arr) { return arr.length ? arr[Math.floor(source() * arr.length)] : undefined; },
    /** seed(n) → 可重現 PRNG；seed(null) 還原為 crypto */
    seed(n) {
      source = (n === null || n === undefined) ? cryptoRandom : mulberry32(Number(n) >>> 0);
      return rng;
    },
    get seeded() { return source !== cryptoRandom; },
  };
  LG.rng = rng;
})();
