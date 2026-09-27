// LG.dice — 擲骰（骰寶、番攤等）。見 docs/02-architecture.md §2.13
(() => {
  const LG = globalThis.LG;

  /**
   * 擲 n 顆六面骰。
   * @param {number} [n=3]
   * @returns {number[]} 每顆 1..6
   */
  function roll(n = 3) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(LG.rng.int(1, 6));
    return out;
  }

  /**
   * 點數總和。
   * @param {number[]} dice
   * @returns {number}
   */
  function sum(dice) { return dice.reduce((a, b) => a + b, 0); }

  LG.dice = { roll, sum };
})();
