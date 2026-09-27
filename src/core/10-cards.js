// LG.cards — 牌、牌組、牌靴（純邏輯，無 DOM）。見 docs/02-architecture.md §2.7
(() => {
  const LG = globalThis.LG;

  // ---- 防禦：若 01-rng.js（核心 A）尚未載入，提供語意相同的簡易 LG.rng ----
  // 正式建置時 01-rng.js 先載入，這段不會生效；單獨測試 libs（loadLG({core:'libs'})）時使用。
  if (!LG.rng) {
    const cryptoRandom = () => {
      const c = globalThis.crypto;
      if (c && typeof c.getRandomValues === 'function') {
        const a = new Uint32Array(1);
        c.getRandomValues(a);
        return a[0] / 4294967296;
      }
      return Math.random();
    };
    const mulberry32 = (a) => () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let gen = cryptoRandom;
    const rng = {
      /** [0,1) 亂數 */
      random: () => gen(),
      /** 整數，含兩端 */
      int: (min, max) => min + Math.floor(gen() * (max - min + 1)),
      /** Fisher–Yates 原地洗牌並回傳 */
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(gen() * (i + 1));
          const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
      },
      /** 隨機取一個元素 */
      pick: (arr) => arr[Math.floor(gen() * arr.length)],
      /** 切換為可重現 PRNG（mulberry32）；seed(null) 還原 */
      seed(n) { gen = (n === null || n === undefined) ? cryptoRandom : mulberry32(Number(n) >>> 0); },
    };
    LG.rng = rng;
  }

  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const SUITS = ['S', 'H', 'D', 'C'];
  const RANK_VALUE = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
  const SUIT_INFO = {
    S: { zh: '黑桃', en: 'Spades', symbol: '♠', color: 'black' },
    H: { zh: '紅心', en: 'Hearts', symbol: '♥', color: 'red' },
    D: { zh: '方塊', en: 'Diamonds', symbol: '♦', color: 'red' },
    C: { zh: '梅花', en: 'Clubs', symbol: '♣', color: 'black' },
    J: { zh: '小丑', en: 'Joker', symbol: '★', color: 'red' },
  };

  /**
   * 建立一張牌物件。
   * @param {string} rank '2'..'9','T','J','Q','K','A'；小丑為 'X'
   * @param {string} suit 'S'|'H'|'D'|'C'；小丑為 'J'
   * @returns {{rank:string, suit:string, id:string}}
   */
  function make(rank, suit) { return { rank, suit, id: rank + suit }; }

  /** 是否為小丑。 @param {{rank:string}} c */
  function isJoker(c) { return !!c && c.rank === 'X'; }

  /**
   * 建立一副新牌（未洗）。
   * @param {{jokers?:number}} [opts] jokers 小丑張數（牌九撲克用 1）
   * @returns {Array<{rank,suit,id}>} 52(+jokers) 張
   */
  function newDeck({ jokers = 0 } = {}) {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push(make(r, s));
    for (let i = 0; i < jokers; i++) d.push(make('X', 'J'));
    return d;
  }

  /**
   * 牌靴 Shoe：多副牌，建立時即洗牌。剩餘張數 ≤ cutCard 時 needsShuffle() 為 true。
   * 牌用完時 draw() 會自動重洗（不會丟錯），但遊戲應在局與局之間檢查 needsShuffle()。
   */
  class Shoe {
    /**
     * @param {number} decks 副數
     * @param {{cutCard?:number, jokers?:number}} [opts] cutCard 切牌位置（剩幾張時重洗）；jokers 每副小丑數
     */
    constructor(decks = 1, { cutCard = 14, jokers = 0 } = {}) {
      this.decks = decks;
      this.cutCard = cutCard;
      this.jokers = jokers;
      this.cards = [];
      this.dealt = 0;
      this._stack = [];
      this.shuffle();
    }
    /** 重新組成完整牌靴並洗牌。 @returns {Shoe} */
    shuffle() {
      const cards = [];
      for (let i = 0; i < this.decks; i++) cards.push(...newDeck({ jokers: this.jokers }));
      this.cards = LG.rng.shuffle(cards);
      this.dealt = 0;
      this._stack = [];
      return this;
    }
    /** 抽一張牌（先抽 stack() 預先指定的牌）。 @returns {{rank,suit,id}} */
    draw() {
      if (this._stack.length) return this._stack.shift();
      if (this.dealt >= this.cards.length) { LG.debug && LG.debug('shoe empty → reshuffle'); this.shuffle(); }
      return this.cards[this.dealt++];
    }
    /** 剩餘張數。 @returns {number} */
    remaining() { return this.cards.length - this.dealt + this._stack.length; }
    /** 是否已到切牌（需要在本局結束後重洗）。 @returns {boolean} */
    needsShuffle() { return this.cards.length - this.dealt <= this.cutCard; }
    /** 燒牌 n 張，回傳被燒的牌。 @param {number} n @returns {Array} */
    burn(n = 1) { const out = []; for (let i = 0; i < n; i++) out.push(this.draw()); return out; }
    /**
     * 教學/測試用：指定接下來依序抽出的牌（不影響牌靴本體）。
     * @param {Array|string} cards 牌物件陣列或 'AS KH' 字串
     * @returns {Shoe}
     */
    stack(cards) {
      const list = typeof cards === 'string' ? parseMany(cards) : cards;
      this._stack.push(...list);
      return this;
    }
  }

  /**
   * 建立牌靴。
   * @param {number} decks 副數
   * @param {{cutCard?:number, jokers?:number}} [opts]
   * @returns {Shoe}
   */
  function newShoe(decks = 1, opts = {}) { return new Shoe(decks, opts); }

  /**
   * 撲克點數 2..14（A=14）；小丑回傳 0（由各函式庫自行處理）。
   * @param {{rank:string}} card
   * @returns {number}
   */
  function rankValue(card) { return RANK_VALUE[card.rank] || 0; }

  /**
   * 顯示用文字，例如 'A♠'、'10♥'；小丑 'Joker'。
   * @param {{rank,suit}} card
   * @returns {string}
   */
  function label(card) {
    if (isJoker(card)) return 'Joker';
    return (card.rank === 'T' ? '10' : card.rank) + SUIT_INFO[card.suit].symbol;
  }

  /**
   * 花色資訊。
   * @param {string} suit 'S'|'H'|'D'|'C'|'J'
   * @returns {{zh:string, en:string, symbol:string, color:'black'|'red'}}
   */
  function suitName(suit) { return SUIT_INFO[suit]; }

  /**
   * 解析文字為牌（測試用）。接受 'AS'、'10h'、'Td'、'XJ'/'JK'/'JOKER'（小丑）。
   * @param {string} s
   * @returns {{rank,suit,id}}
   */
  function parse(s) {
    const t = String(s).trim().toUpperCase();
    if (t === 'XJ' || t === 'JK' || t === 'JOKER' || t === 'X') return make('X', 'J');
    const m = /^(10|[2-9TJQKA])([SHDC])$/.exec(t);
    if (!m) throw new Error('BAD_CARD:' + s);
    return make(m[1] === '10' ? 'T' : m[1], m[2]);
  }

  /**
   * 解析多張牌（以空白或逗號分隔）。
   * @param {string} s 例如 'AS KH 7D'
   * @returns {Array<{rank,suit,id}>}
   */
  function parseMany(s) { return String(s).split(/[\s,]+/).filter(Boolean).map(parse); }

  LG.cards = {
    RANKS, SUITS, RANK_VALUE,
    make, isJoker, newDeck, newShoe, Shoe, rankValue, label, suitName, parse, parseMany,
  };
})();
