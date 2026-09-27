// ============================================================================
// 三公 Three Pictures（id: three-pictures）— 規格：docs/05-game-rules/three-pictures.md
// 1 副牌每局重洗；莊家與 3 個位置各 3 張。玩家可同時押多個位置，每個位置獨立與莊比。
// 牌型：三公 > 9 > 8 > … > 0；同點比公數；再比最高單張（K>Q>J>10>…>A）；全同 → 莊贏。
// 玩家贏：三公 3:1、9 點 2:1、其他 1:1。
// 莊贏：玩家輸「莊家牌型倍數」（莊三公輸 3 倍、莊 9 點輸 2 倍、其他輸 1 倍）。
//   ↑ 與規格 §2「莊勝輸 1 倍」不同：照規格字面玩家反而有 +10.5% 優勢（精確枚舉），
//     見 docs/change-requests/three-pictures.md CR-1。RULES.bankerMultiplier 可切回規格字面。
// ============================================================================
(() => {
  const { ui, money } = LG;
  const { el } = ui;
  const { fmt, round2 } = money;

  // ---------------------------------------------------------------- 規則常數
  const RULES = {
    bankerMultiplier: true,   // 莊贏時玩家輸莊家牌型倍數（CR-1）
    maxLossMult: 3,           // 下注時需保留 3 倍注額（莊三公輸 3 倍）
  };
  /** Monte Carlo 主注優勢（%）：LG.rng.seed(20260927); logic.simulate(40,000,000) → 0.8905%（精確枚舉 0.8935%），見 change-request */
  const MC_EDGE = 0.89;
  const RANK_ORDER = 'A23456789TJQK';           // 比最高單張：K 最大、A 最小
  const SEATS = [1, 2, 3];
  const YOU = 2;
  const EN_NUM = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const ZH_PICS = ['', '一公', '兩公'];
  const EN_PICS = ['', 'one picture', 'two pictures'];

  const T = {
    banker: { zh: '莊', en: 'Banker' },
    seat: (n) => ({ zh: n === YOU ? `位置 ${n} 你` : `位置 ${n}`, en: n === YOU ? `Seat ${n} · You` : `Seat ${n}` }),
    odds: '1:1 · 9點 2:1 · 三公 3:1',
    print: '三公 3:1 · 九點 2:1 · 和局歸莊',
    printEn: 'Three Pictures 3:1 · Nine 2:1 · Ties go to Banker',
    printRule: '莊家九點輸 2 倍 · 莊家三公輸 3 倍',
    reserve: (need) => `三公可能輸 3 倍：需保留 3 倍注額 ${fmt(need)}`,
    houseRule: '現場以桌上規則牌為準',
  };

  // ---------------------------------------------------------------- 純邏輯
  const point = (c) => ('TJQK'.includes(c.rank) ? 0 : c.rank === 'A' ? 1 : Number(c.rank));
  const isPic = (c) => 'JQK'.includes(c.rank);
  const rankIdx = (r) => RANK_ORDER.indexOf(r) + 1;         // A=1 … K=13
  const rankText = (r) => (r === 'T' ? '10' : r);
  const cardText = (c) => `${rankText(c.rank)}${ui.SUIT ? ui.SUIT[c.suit].symbol : c.suit}`;

  /** 牌型 → {points, pics, three, top, topRank, level, score, mult, name:{zh,en}} */
  function evaluate(cards) {
    const pics = cards.filter(isPic).length;
    const points = cards.reduce((s, c) => s + point(c), 0) % 10;
    const three = pics === 3;
    const top = Math.max(...cards.map((c) => rankIdx(c.rank)));
    const level = three ? 10 : points;
    const name = three ? { zh: '三公', en: 'Three Pictures' }
      : { zh: `${points} 點${ZH_PICS[pics]}`, en: `${EN_NUM[points]}${pics ? `, ${EN_PICS[pics]}` : ''}` };
    return { points, pics, three, top, topRank: RANK_ORDER[top - 1], level, score: level * 10000 + pics * 100 + top, mult: three ? 3 : points === 9 ? 2 : 1, name };
  }

  /** 位置 vs 莊：→ {win:boolean, by:'level'|'pics'|'top'|'tie', why} */
  function compare(p, b) {
    const win = p.score > b.score;
    let by, why;
    if (p.level !== b.level) {
      by = 'level';
      why = `${p.name.zh} ${win ? '>' : '<'} ${b.name.zh}`;
    } else if (p.pics !== b.pics) {
      by = 'pics';
      why = `同 ${p.three ? '三公' : p.points + ' 點'}，比公數：${p.pics} 公 ${win ? '>' : '<'} ${b.pics} 公`;
    } else if (p.top !== b.top) {
      by = 'top';
      why = `點數與公數都一樣，比最高單張：${rankText(p.topRank)} ${win ? '>' : '<'} ${rankText(b.topRank)}`;
    } else {
      by = 'tie';
      why = `點數、公數、最高單張（${rankText(p.topRank)}）全同 → 和局歸莊`;
    }
    return { win, by, why };
  }

  /** 莊贏時玩家輸幾倍 */
  const lossMult = (b) => (RULES.bankerMultiplier ? b.mult : 1);

  /**
   * 結算。entries = [['seat-2', 100], ...]；hands = {banker:[3 張], seats:{1:[…],2:[…],3:[…]}}
   * @returns {{wagered, returned, extra, net, lines:[{spot, seat, stake, result, mult, pay, returned, extra, formula, why}]}}
   *  returned = 贏注拿回（含本金）；extra = 輸超過本金的部分（莊九點/三公）；net = returned − wagered − extra
   */
  function settle(entries, hands) {
    const b = evaluate(hands.banker);
    let wagered = 0, returned = 0, extra = 0;
    const lines = entries.map(([spot, stake]) => {
      const seat = Number(spot.split('-')[1]);
      const p = evaluate(hands.seats[seat]);
      const c = compare(p, b);
      const label = `位置 ${seat}`;
      wagered += stake;
      if (c.win) {
        const pay = round2(stake * p.mult);
        const back = round2(stake + pay);
        returned += back;
        return { spot, seat, stake, result: 'win', mult: p.mult, pay, returned: back, extra: 0, why: c.why, hand: p, banker: b,
          formula: `${label} ${fmt(stake)} × ${p.mult} = +${fmt(pay)}（拿回 ${fmt(back)}）` };
      }
      const m = lossMult(b);
      const ex = round2(stake * (m - 1));
      extra += ex;
      const loss = round2(stake * m);
      return { spot, seat, stake, result: 'lose', mult: -m, pay: -loss, returned: 0, extra: ex, why: c.why, hand: p, banker: b,
        formula: m > 1 ? `${label} ${fmt(stake)} × ${m} = −${fmt(loss)}（莊家${b.name.zh}，輸 ${m} 倍）` : `${label} ${fmt(stake)} 輸 = −${fmt(stake)}` };
    });
    wagered = round2(wagered); returned = round2(returned); extra = round2(extra);
    return { banker: b, wagered, returned, extra, net: round2(returned - wagered - extra), lines };
  }

  /** 一副新牌洗好，發 3 個位置 + 莊（莊最後） */
  function dealHands(deck) {
    const d = deck || LG.rng.shuffle(LG.cards.newDeck());
    const seats = {};
    SEATS.forEach((s, i) => { seats[s] = d.slice(i * 3, i * 3 + 3); });
    return { seats, banker: d.slice(9, 12) };
  }

  /**
   * Monte Carlo：位置押 1 單位 n 局，回傳 {edge%, ev, rounds, win, tieToBanker}。
   * 每局只需 6 張（位置 + 莊），用部分 Fisher–Yates 抽，結果與整副洗牌同分布。
   */
  function simulate(n = 1000000) {
    const deck = LG.cards.newDeck();
    const N = deck.length;
    let sum = 0, win = 0, tie = 0;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 6; k++) {
        const j = k + Math.floor(LG.rng.random() * (N - k));
        const t = deck[k]; deck[k] = deck[j]; deck[j] = t;
      }
      const p = evaluate([deck[0], deck[1], deck[2]]);
      const b = evaluate([deck[3], deck[4], deck[5]]);
      if (p.score > b.score) { sum += p.mult; win++; } else { sum -= lossMult(b); if (p.score === b.score) tie++; }
    }
    return { edge: (-sum / n) * 100, ev: sum / n, rounds: n, win: win / n, tieToBanker: tie / n };
  }

  const reduceMotion = () => { try { return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; } };
  const P = (s) => LG.cards.parseMany(s);

  // ---------------------------------------------------------------- 註冊
  LG.registerGame({
    id: 'three-pictures',
    category: 'table',
    order: 5,
    name: { zh: '三公', en: 'Three Pictures' },
    summary: '三張牌比點數，J/Q/K 叫「公」。三張都是公最大。',
    houseEdge: [
      { bet: { zh: '主注（押位置）', en: 'Seat bet' }, edge: MC_EDGE, best: true, approx: true },
    ],
    limits: { real: { min: 50, max: 3000 }, practice: { min: 10, max: 100000 } },
    denoms: [10, 25, 50, 100, 500, 1000],
    countdown: 15,
    logic: { evaluate, compare, settle, dealHands, simulate, point, isPic, RULES, MC_EDGE, SEATS },

    create(ctx) {
      const state = { phase: 'idle', staked: 0, rounds: 0, rig: null, hands: null, last: null };
      const bets = new LG.Bets({
        min: ctx.limits.min,
        max: ctx.isReal ? ctx.limits.max * SEATS.length : ctx.limits.max,
        perSpotMin: ctx.limits.min,
        perSpotMax: ctx.limits.max,
        labels: Object.fromEntries(SEATS.map((s) => [`seat-${s}`, `位置 ${s}`])),
      });
      let root, tableEl, bankerHand, bankerBadge, seatEls = {}, hintEl, tray, layer, bar;

      // ---- 桌面
      function buildTable() {
        bankerHand = el('div.lg-hand.tp-hand.tp-hand--banker', { dataset: { role: 'banker' } });
        bankerBadge = el('div.tp-badge', { dataset: { role: 'banker-badge' } });
        const banker = el('div.tp-banker', [
          el('div.lg-table__label', { html: `莊 BANKER` }),
          bankerHand, bankerBadge,
        ]);
        const seats = el('div.tp-seats', SEATS.map((s) => {
          const t = T.seat(s);
          const hand = el('div.lg-hand.tp-hand', { dataset: { seat: s } });
          const badge = el('div.tp-badge');
          const why = el('div.tp-why');
          const spot = el('div.lg-spot.tp-spot', { dataset: { bet: `seat-${s}` } }, [
            el('span.lg-spot__zh', { text: t.zh }),
            el('span.lg-spot__en', { text: t.en }),
            el('span.lg-spot__odds', { text: T.odds }),
          ]);
          const box = el('div', { class: ['tp-seat', s === YOU && 'tp-seat--you'], dataset: { seatBox: s } }, [
            el('div.tp-seat__head', { html: s === YOU ? `位置 ${s} <b>你</b> <i class="en">YOU</i>` : `位置 ${s} <i class="en">SEAT ${s}</i>` }),
            hand, badge, why, spot,
          ]);
          seatEls[s] = { box, hand, badge, why, spot };
          return box;
        }));
        const print = el('div.tp-print', [
          el('div.tp-print__zh', { text: T.print }),
          el('div.tp-print__en', { text: T.printEn }),
          el('div.tp-print__rule', { text: `${T.printRule}（${T.houseRule}）` }),
        ]);
        tableEl = el('div.lg-table.tp-table', [banker, seats, print]);
        const actions = el('div.lg-actions', { dataset: { dealSlot: '' } });
        const chips = el('div');
        const barEl = el('div');
        hintEl = el('div.lg-hint.tp-hint', { hidden: true });
        root.append(tableEl, hintEl, actions, chips, barEl);

        tray = ui.chipTray(chips, { denoms: ctx.denoms, selected: ctx.isReal ? 50 : 10 });
        layer = ui.betLayer(tableEl, { bets, chipTray: tray, gameId: ctx.gameId, canPlace });
        bar = ui.betBar(barEl, { bets, layer });
        clearHands();
      }

      /** 需保留最大可能輸額（3 倍） */
      function canPlace(spotId, amount) {
        if (!RULES.bankerMultiplier) return true;
        const need = round2((bets.total() + amount) * RULES.maxLossMult);
        return ctx.bank.canAfford(need) ? true : T.reserve(need);
      }

      function emptyHand(h) { h.replaceChildren(...[0, 1, 2].map(() => el('div.tp-slot'))); }
      function clearHands() {
        emptyHand(bankerHand);
        bankerBadge.textContent = '';
        SEATS.forEach((s) => { emptyHand(seatEls[s].hand); seatEls[s].badge.textContent = ''; seatEls[s].why.textContent = ''; });
        markSeats(null);
      }
      function badgeHtml(ev) { return `<b>${ev.name.zh}</b> <i class="en">${ev.name.en}</i>`; }
      function markSeats(res) {
        SEATS.forEach((s) => {
          const e = seatEls[s];
          const r = res && res[s];
          e.box.classList.toggle('is-win', !!r && r.win);
          e.box.classList.toggle('is-lose', !!r && !r.win);
          e.spot.classList.toggle('is-win', !!r && r.win);
          e.spot.classList.toggle('is-lose', !!r && !r.win && bets.get(`seat-${s}`) > 0);
        });
      }
      /** 直接擺出攤開的手牌（教學 / 結算後） */
      function showHands(hands, { compareAll = true } = {}) {
        bankerHand.replaceChildren(...hands.banker.map((c) => ui.card(c, { size: 'sm' })));
        const b = evaluate(hands.banker);
        bankerBadge.innerHTML = badgeHtml(b);
        const res = {};
        SEATS.forEach((s) => {
          const e = seatEls[s];
          e.hand.replaceChildren(...hands.seats[s].map((c) => ui.card(c, { size: 'sm' })));
          const p = evaluate(hands.seats[s]);
          const c = compare(p, b);
          res[s] = c;
          e.badge.innerHTML = badgeHtml(p);
          e.why.innerHTML = `${c.win ? '贏' : '輸'}：${c.why}`;
        });
        if (compareAll) markSeats(res);
        return res;
      }

      // ---- 練習提示
      function paintHints() {
        root.classList.toggle('tp-show-hints', !!ctx.hints);
        hintEl.hidden = !ctx.hints;
        hintEl.innerHTML = `提示：三公沒有決策，每個位置優勢都一樣（約 ${MC_EDGE}%）。押多個位置不會更划算，只會讓輸贏波動更大。`;
      }
      function strategyTable() {
        return ui.table([
          ['玩家贏的牌型', '賠付'], ['三公', '3:1'], ['9 點', '2:1'], ['其他', '1:1'],
          ['莊贏（莊 9 點）', '輸 2 倍'], ['莊贏（莊三公）', '輸 3 倍'], ['莊贏（其他）/ 和局', '輸 1 倍'],
          ['主注優勢（模擬）', `≈ ${MC_EDGE}%`],
        ], { caption: '每個位置獨立和莊比' });
      }

      // ---- 一局流程
      function startRound() {
        if (!ctx.alive()) return;
        state.phase = 'betting';
        SEATS.forEach((s) => seatEls[s].spot.classList.remove('is-lose'));
        ctx.bettingWindow({
          bets, onClose: onNoMoreBets,
          validate: () => {
            if (!RULES.bankerMultiplier) return true;
            const need = round2(bets.total() * RULES.maxLossMult);
            return ctx.bank.canAfford(need) ? true : T.reserve(need);
          },
        });
      }

      async function onNoMoreBets({ ok, validation }) {
        if (!ok) {
          bets.unlock();
          if (bets.total() > 0) ui.toast(validation.zh, { type: 'warn' });
          state.phase = 'idle';
          ctx.nextRound(startRound);
          return;
        }
        state.staked = bets.total();
        ctx.bank.debit(state.staked);
        state.phase = 'dealing';
        clearHands();
        ctx.dealer.say('發牌', 'Dealing');
        let hands;
        if (state.rig) { hands = state.rig; state.rig = null; } else hands = dealHands();
        state.hands = hands;
        const fast = reduceMotion();
        // 發牌：每位 3 張蓋牌，莊最後
        const cardEls = { banker: [], seats: {} };
        const order = [...SEATS.map((s) => ['seat', s]), ['banker', 0]];
        for (const [kind, s] of order) {
          const hEl = kind === 'banker' ? bankerHand : seatEls[s].hand;
          const cards = kind === 'banker' ? hands.banker : hands.seats[s];
          const els = cards.map((c) => ui.card(c, { faceDown: true, size: 'sm' }));
          hEl.replaceChildren(...els);
          if (kind === 'banker') cardEls.banker = els; else cardEls.seats[s] = els;
          if (!fast) { await ctx.wait(160); if (!ctx.alive()) return; }
        }
        // 開牌：莊先，再逐位比對
        const b = evaluate(hands.banker);
        await Promise.all(cardEls.banker.map((e) => ui.flip(e)));
        if (!ctx.alive()) return;
        bankerBadge.innerHTML = badgeHtml(b);
        ctx.dealer.say(`莊：${b.name.zh}`, `Banker: ${b.name.en}`);
        const res = {};
        for (const s of SEATS) {
          if (!fast) { await ctx.wait(450); if (!ctx.alive()) return; }
          await Promise.all(cardEls.seats[s].map((e) => ui.flip(e)));
          if (!ctx.alive()) return;
          const p = evaluate(hands.seats[s]);
          const c = compare(p, b);
          res[s] = c;
          seatEls[s].badge.innerHTML = badgeHtml(p);
          seatEls[s].why.innerHTML = `${c.win ? '贏' : '輸'}：${c.why}`;
          markSeats(res);
          ctx.dealer.say(`位置 ${s}：${p.name.zh}，${c.win ? '贏' : '輸'}`, `Seat ${s}: ${p.name.en}, ${c.win ? 'wins' : 'loses'}`);
        }
        if (!fast) { await ctx.wait(350); if (!ctx.alive()) return; }
        finishRound(hands);
      }

      function finishRound(hands) {
        const r = settle(bets.entries(), hands);
        state.last = r;
        ctx.bank.credit(r.returned);
        if (r.extra > 0) ctx.bank.debit(Math.min(r.extra, ctx.bank.balance()));
        state.staked = 0;
        ctx.dealer.say('派彩', 'Paying out');
        ctx.recordRound({ wagered: r.wagered, net: r.net, outcome: r.net > 0 ? 'win' : r.net < 0 ? 'lose' : 'push' });
        const b = r.banker;
        const handLine = (label, cards, ev) => `${label}：${cards.map(cardText).join(' ')} → <b>${ev.name.zh}</b>`;
        ctx.explain({
          hand: [handLine('莊', hands.banker, b), ...SEATS.map((s) => handLine(`位置 ${s}${s === YOU ? '（你）' : ''}`, hands.seats[s], evaluate(hands.seats[s])))].join('<br>'),
          result: r.lines.map((l) => `位置 ${l.seat} ${l.result === 'win' ? '<b class="lg-win">贏 WIN</b>' : '<b class="lg-lose">輸 LOSE</b>'}`).join('、'),
          formula: r.lines.map((l) => l.formula).join('<br>') + `<br>淨 <b>${money.fmtSigned(r.net)}</b>`,
          why: '<ul class="tp-whylist">' + r.lines.map((l) => `<li><b>位置 ${l.seat}</b>：${l.why}${l.result === 'win' && l.mult > 1 ? `（${l.hand.name.zh}賠 ${l.mult}:1）` : ''}</li>`).join('') + '</ul>'
            + '<p class="lg-muted">算點：A=1，2–9 照面值，10/J/Q/K=0，加總取個位數。</p>',
        });
        state.rounds += 1;
        state.phase = 'settled';
        bets.unlock();
        bets.clear();
        ctx.checkBroke();
        if (ctx.isReal && RULES.bankerMultiplier && ctx.bank.balance() >= ctx.limits.min && ctx.bank.balance() < ctx.limits.min * RULES.maxLossMult) {
          ui.toast(`餘額不足最低注的 3 倍保留（${fmt(ctx.limits.min * RULES.maxLossMult)}），無法再下注`, { type: 'warn', ms: 3000 });
        }
        ctx.nextRound(startRound);
      }

      // ---- 教學用
      const demo = {
        showBanner(zh, en) { ctx.dealer.say(zh, en); },
        ensureBetting() { if (state.phase === 'idle' || state.phase === 'settled') startRound(); },
        showHands(h) { return showHands(h); },
        clear() { clearHands(); },
        rig(h) { state.rig = h; },
      };
      const H = (b, s1, s2, s3) => ({ banker: P(b), seats: { 1: P(s1), 2: P(s2), 3: P(s3) } });

      function tutorialSteps() {
        return [
          // ===== layout
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：三公桌面',
            body: `<p>上方是莊家，下方三個位置。每個位置都和莊比牌。${T.houseRule}。</p>`,
            highlight: ['.tp-table'] },
          { id: 'layout-banker', section: 'layout', title: '莊 <i class="en">Banker</i> 牌區',
            body: '<p>荷官代表莊家，拿 3 張牌。你不能押莊，只能押位置。</p>',
            highlight: ['.tp-banker'] },
          { id: 'layout-seats', section: 'layout', title: '三個位置 <i class="en">Seats</i>',
            body: '<p>位置 1、2、3 各發 3 張。每格下注區押的就是「這個位置贏莊」。</p>',
            highlight: ['.tp-seats'] },
          { id: 'layout-you', section: 'layout', title: '你的位置：位置 2',
            body: '<p>你坐在位置 2（<b>你 <i class="en">YOU</i></b>）。預設押自己的位置，也可以押別人的位置。</p>',
            highlight: ['[data-bet="seat-2"]'] },
          { id: 'layout-print', section: 'layout', title: '桌面印字',
            body: '<p>「三公 3:1 · 九點 2:1 · 和局歸莊」：玩家拿三公或 9 點贏錢較多；打和算莊贏。</p>',
            highlight: ['.tp-print'] },
          { id: 'layout-chips', section: 'layout', title: '籌碼 <i class="en">Chips</i>',
            body: '<p>10 藍、25 綠、50 橙、100 黑、500 紫、1000 黃。現場顏色可能不同，看面額。</p>',
            highlight: ['.lg-chips'],
            action: { label: '點選 RM 50 籌碼', check: (inst) => inst.tray().selected() === 50 || '點一下「50」那枚籌碼' } },
          // ===== flow
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：一局怎麼進行',
            body: '<p><b>請下注 <i class="en">Place your bets</i></b> → 停止下注 → 發牌 → 莊開牌 → 逐位比對 → 派彩。</p>',
            highlight: ['.lg-dealer-banner'],
            setup: (inst) => { inst.demo.clear(); inst.demo.ensureBetting(); inst.demo.showBanner('請下注', 'Place your bets'); } },
          { id: 'flow-place', section: 'flow', title: '押你的位置',
            body: '<p>點位置 2 的下注格放籌碼。長按或右鍵拿回一枚。</p>',
            highlight: ['[data-bet="seat-2"]', '.lg-chips'],
            setup: (inst) => inst.demo.ensureBetting(),
            action: { label: '在「位置 2 你」放至少 RM 50', check: (inst) => inst.bets.get('seat-2') >= 50 || `目前位置 2 上有 ${fmt(inst.bets.get('seat-2'))}` } },
          { id: 'flow-multi', section: 'flow', title: '可以同時押多位',
            body: '<p>位置 1、3 也能押，每個位置各自和莊比、各自結算。押越多位，輸贏起伏越大。</p>',
            highlight: ['[data-bet="seat-1"]', '[data-bet="seat-3"]'],
            setup: (inst) => inst.demo.ensureBetting() },
          { id: 'flow-deal', section: 'flow', title: '發牌與開牌順序',
            body: '<p>按「發牌」：每位 3 張、莊最後。開牌時莊先翻，再從位置 1 到 3 逐位比。</p>',
            highlight: ['[data-action="deal"]', '.tp-banker'],
            setup: (inst) => { inst.demo.ensureBetting(); inst.demo.rig(H('KS 3H 4D', '2C 5S AD', 'KH QD 9S', '7C 8D TH')); },
            action: { label: '按「發牌 Deal」玩一局', check: (inst) => inst.state.rounds > 0 || '先在位置 2 放籌碼，再按發牌' } },
          { id: 'flow-no-touch', section: 'flow', title: '不能碰牌、不能碰籌碼',
            body: '<p>荷官說 <b>No more bets</b> 後，手放桌下。牌由荷官翻，玩家不碰牌。</p>',
            highlight: ['.lg-dealer-banner', '.tp-seats'],
            setup: (inst) => inst.demo.showBanner('停止下注', 'No more bets') },
          // ===== payout
          { id: 'payout-values', section: 'payout', title: '這段你會學到：算點數',
            body: '<p>A = 1，2–9 照面值，10 和 J/Q/K = 0。三張加起來<b>只看個位數</b>。J/Q/K 叫<b>公 <i class="en">Picture</i></b>。</p>',
            highlight: ['.tp-banker'],
            setup: (inst) => inst.demo.showHands(H('KS QH 7D', '5C 5S AD', 'KH 9D QS', 'KD QC JS')) },
          { id: 'payout-q1', section: 'payout', title: '算點練習 1：K-Q-7',
            body: '<p>0 + 0 + 7 = <b>7 點</b>，有 K、Q 兩張公 → 「7 點兩公」。</p>',
            highlight: ['.tp-banker'] },
          { id: 'payout-q2', section: 'payout', title: '算點練習 2：5-5-A',
            body: '<p>5 + 5 + 1 = 11，個位數 → <b>1 點</b>。</p>',
            highlight: ['[data-seat-box="1"]'] },
          { id: 'payout-q3', section: 'payout', title: '算點練習 3：K-9-Q = 9 點 2:1',
            body: '<p>9 點兩公贏莊。押 RM 100：<br><b>RM 100 × 2 = RM 200</b>（淨贏）<br>拿回 RM 300（含本金）。</p>',
            highlight: ['[data-seat-box="2"]'] },
          { id: 'payout-three', section: 'payout', title: '三公 3:1',
            body: '<p>K-Q-J 三張都是公 = <b>三公</b>，比 9 點還大。押 RM 100：<b>RM 100 × 3 = RM 300</b>，拿回 RM 400。</p>',
            highlight: ['[data-seat-box="3"]'] },
          { id: 'payout-compare', section: 'payout', title: '同點怎麼比',
            body: '<p>同點數 → 公多的贏；再同 → 比最高單張（K 最大、A 最小）；全部一樣 → <b>莊贏</b>。</p>',
            highlight: ['.tp-seats'],
            setup: (inst) => inst.demo.showHands(H('8S KH TC', 'QD 8H JC', '9C 9D KS', '4H 4D QS')) },
          { id: 'payout-banker-mult', section: 'payout', title: '莊家拿 9 點或三公',
            body: '<p>本桌規則：莊 9 點贏你，輸 2 倍；莊三公贏你，輸 3 倍。所以下注時要留 3 倍籌碼。</p>',
            highlight: ['.tp-print'] },
          { id: 'payout-try', section: 'payout', title: '押別人的位置試試',
            body: '<p>別人的位置也能押，算法完全一樣。</p>',
            highlight: ['[data-bet="seat-1"]', '[data-bet="seat-3"]'],
            setup: (inst) => { inst.demo.clear(); inst.demo.ensureBetting(); },
            action: { label: '在位置 1 或位置 3 放籌碼', check: (inst) => inst.bets.get('seat-1') > 0 || inst.bets.get('seat-3') > 0 || '點位置 1 或 3 的下注格' } },
          // ===== strategy
          { id: 'strategy-edge', section: 'strategy', title: '莊家優勢 <i class="en">House edge</i>',
            body: `<table class="lg-datatable"><tr><th>注</th><th>優勢</th></tr><tr><td>押任一位置</td><td>≈ ${MC_EDGE}%（模擬值）</td></tr></table><p>由電腦模擬 4,000 萬局算出。</p>`,
            highlight: null },
          { id: 'strategy-no-choice', section: 'strategy', title: '沒有決策，純運氣',
            body: '<p>三公發完牌就定輸贏，你不能補牌也不能換牌。沒有「技巧」可以降低優勢。</p>',
            highlight: ['.tp-seats'] },
          { id: 'strategy-why', section: 'strategy', title: '優勢從哪裡來',
            body: '<p>和局歸莊，加上莊 9 點、三公時你輸 2–3 倍——莊家靠這些規則長期贏錢。</p>',
            highlight: ['.tp-print'] },
          { id: 'strategy-do', section: 'strategy', title: '該押 / 別押',
            body: '<p>該押：一個位置、固定注額。<br>別押：同時押滿三位想「分散風險」——優勢一樣，只放大輸贏。</p>',
            highlight: ['[data-bet="seat-2"]'] },
          { id: 'strategy-budget', section: 'strategy', title: '預算',
            body: '<p>今晚只帶 RM 500，輸完就走。上一局的牌不會影響下一局（每局重洗）。</p>',
            highlight: ['.lg-topbar .lg-balance'] },
        ];
      }

      return {
        bets,
        state,
        tray: () => tray,
        demo,
        mount(el0) {
          root = el0;
          root.classList.add('tp-root');
          buildTable();
          paintHints();
          ctx.on('hints:change', paintHints);
          if (ctx.isPractice) ctx.strategyPanel(strategyTable());
          root.dataset.ready = '1';
          startRound();
        },
        unmount() {
          if (state.staked > 0) { ctx.bank.credit(state.staked); state.staked = 0; }
          if (layer) layer.destroy();
          if (bar) bar.destroy();
        },
        tutorialSteps,
      };
    },
  });
})();
