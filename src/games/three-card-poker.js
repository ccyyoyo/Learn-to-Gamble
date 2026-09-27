// ============================================================================
// Three Card Poker（id: three-card-poker）— 規格：docs/05-game-rules/three-card-poker.md
//
// 兩個獨立主注：Ante/Play（對莊）與 Pair Plus（只看自己）。可只押其一。
// 一局：Pair Plus / Ante → No more bets → 各 3 張 → 有 Ante 時玩家棄牌 Fold / 跟注 Play（= Ante 同額；
//      真實 30 秒未操作 = 棄牌）→ 莊開牌 → 莊 Q 高以上合格 → 結算（Ante、Play、Ante Bonus、Pair Plus 各一行）。
// 金流（CR-A1）：No more bets 後 debit(Ante + Pair Plus)；Play 時 debit(Ante)；結算 credit(拿回含本金)。
// 假設（見 docs/change-requests/three-card-poker.md）：Ante Bonus 需要有 Play（棄牌不領）；Pair Plus 棄牌仍結算。
// ============================================================================
(() => {
  const { ui, money, poker } = LG;
  const { el, term } = ui;
  const { fmt, round2, fmtSigned } = money;

  // ---------------------------------------------------------------- 常數
  const ID = 'three-card-poker';
  const DECIDE_SECONDS = 30;
  const ANTE_BONUS = { STRAIGHT: 1, TRIPS: 4, SF: 5 };
  const PAIR_PLUS = { PAIR: 1, FLUSH: 4, STRAIGHT: 6, TRIPS: 30, SF: 40 };
  const Q64 = poker.eval3(LG.cards.parseMany('QS 6H 4D')).score;   // Q-6-4 門檻
  const QUAL_MIN = poker.eval3(LG.cards.parseMany('QS 3H 2D')).score; // 莊 Q 高最小

  // ---------------------------------------------------------------- 文案
  const T = {
    pairPlus: { zh: '對子加注', en: 'Pair Plus', odds: '1:1–40:1' },
    ante: { zh: '底注', en: 'Ante', odds: '1:1' },
    play: { zh: '跟注', en: 'Play', odds: '1:1', note: '= Ante・看牌後自動放' },
    dealer: { zh: '莊家', en: 'Dealer' },
    you: { zh: '你', en: 'You' },
    qualifyPrint: 'DEALER PLAYS WITH QUEEN HIGH OR BETTER',
    qualifyZh: '莊家 Q 高牌以上才合格',
    fold: { zh: '棄牌', en: 'Fold' },
    playBtn: { zh: '跟注', en: 'Play' },
    playAuto: '「跟注 Play」格不用自己放：看牌後按「跟注」會自動放與 Ante 同額',
    needBet: '請押底注 <i class="en">Ante</i> 或對子加注 <i class="en">Pair Plus</i>',
    playWarn: (x) => `提醒：跟注時要再放與 Ante 同額（${fmt(x)}），餘額可能不夠`,
    noPlayCash: '餘額不足以跟注',
    decide: ['請決定：跟 或 棄', 'Play or fold?'],
    timeout: '30 秒未決定 → 視為棄牌 <i class="en">Fold</i>',
    ppTable: [['同花順', 'Straight Flush', '40:1'], ['三條', 'Three of a Kind', '30:1'], ['順子', 'Straight', '6:1'], ['同花', 'Flush', '4:1'], ['一對', 'Pair', '1:1']],
    abTable: [['同花順', 'Straight Flush', '5:1'], ['三條', 'Three of a Kind', '4:1'], ['順子', 'Straight', '1:1']],
    ranking: '同花順 > 三條 > <b>順子 > 同花</b> > 一對 > 高牌',
  };

  // ---------------------------------------------------------------- 純邏輯（Node 可測）
  const label = (c) => LG.cards.label(c);
  const labels = (cs) => cs.map(label).join(' ');
  const describe = (ev) => poker.describe(ev);
  /** 牌型相同時補一句差在哪一張（踢腳 kicker） */
  const kickerNote = (a, b) => { const k = LG.poker.kicker(a, b); return k ? `（${k}）` : ''; };
  const RZ = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10' };
  const rz = (r) => RZ[r] || String(r);

  /** 莊家合格：Q 高牌以上 */
  function qualifies(dealer) {
    const de = Array.isArray(dealer) ? poker.eval3(dealer) : dealer;
    return de.score >= QUAL_MIN;
  }
  /** Q-6-4 策略：≥ Q-6-4 跟注 Play，否則棄牌 */
  function shouldPlay(player) {
    const pe = Array.isArray(player) ? poker.eval3(player) : player;
    return pe.score >= Q64;
  }
  function strategyText(pe) {
    if (pe.level > 0) return `你有${pe.name.zh}（一對以上）→ 跟注`;
    const [a, b, c] = pe.ranks;
    const s = `${rz(a)}-${rz(b)}-${rz(c)}`;
    return shouldPlay(pe) ? `${s} ≥ Q-6-4 → 跟注` : `${s} < Q-6-4 → 棄牌`;
  }

  const nm = (spot) => (spot === 'anteBonus' ? term('Ante 獎金', 'Ante Bonus') : term(T[spot].zh, T[spot].en));
  const line = (spot, stake, result, pay, formula, extra = {}) =>
    ({ spot, stake, result, pay: round2(pay), returned: round2(result === 'lose' ? 0 : stake + pay), formula, ...extra });

  /**
   * 結算。
   * @param {{ante?:number, play?:number, pairPlus?:number, folded?:boolean, player:Array, dealer:Array}} o
   * @returns {{pe, de, qualifies, cmp, folded, lines, wagered, returned, net, outcome, steps}}
   */
  function settle(o) {
    const { ante = 0, play = 0, pairPlus = 0, folded = false, player, dealer } = o;
    const pe = poker.eval3(player), de = poker.eval3(dealer);
    const q = qualifies(de);
    const cmp = Math.sign(pe.score - de.score);
    const lines = [];
    const steps = {};
    if (ante > 0) {
      if (folded) {
        steps.qualify = `你已棄牌，莊牌不影響 Ante（莊牌：${describe(de)}）`;
        steps.compare = '棄牌不比牌';
        lines.push(line('ante', ante, 'lose', -ante, `${nm('ante')} ${fmt(ante)} 輸（棄牌）= −${fmt(ante)}`));
      } else {
        steps.qualify = q
          ? `莊家 ${describe(de)} ≥ Q 高 → <b>合格</b> <i class="en">Dealer qualifies</i>`
          : `莊家 ${describe(de)} 不到 Q 高 → <b>不合格</b> <i class="en">Dealer does not qualify</i>`;
        const win = (spot, amt) => line(spot, amt, 'win', amt, `${nm(spot)} ${fmt(amt)} × 1 = +${fmt(amt)}（拿回 ${fmt(amt * 2)}）`);
        const push = (spot, amt) => line(spot, amt, 'push', 0, `${nm(spot)} ${fmt(amt)} 退回（push）= RM 0`);
        const lose = (spot, amt) => line(spot, amt, 'lose', -amt, `${nm(spot)} ${fmt(amt)} 輸 = −${fmt(amt)}`);
        if (!q) {
          steps.compare = '莊不合格 → 不比牌：Ante 賠 1:1、Play 退回';
          lines.push(win('ante', ante), push('play', play));
        } else if (cmp > 0) {
          steps.compare = `你的 ${describe(pe)} > 莊的 ${describe(de)}${kickerNote(pe, de)} → <b>你贏</b>`;
          lines.push(win('ante', ante), win('play', play));
        } else if (cmp < 0) {
          steps.compare = `你的 ${describe(pe)} < 莊的 ${describe(de)}${kickerNote(pe, de)} → <b>莊贏</b>`;
          lines.push(lose('ante', ante), lose('play', play));
        } else {
          steps.compare = `雙方同為 ${describe(pe)} → <b>平手</b> <i class="en">Push</i>`;
          lines.push(push('ante', ante), push('play', play));
        }
        const ab = ANTE_BONUS[pe.cat];
        if (ab) {
          const pay = round2(ante * ab);
          // Ante Bonus 不是另一注：stake 記 0，只把彩金加進拿回
          lines.push(line('anteBonus', 0, 'win', pay, `${nm('anteBonus')}：${pe.name.zh} ${ab}:1 → ${fmt(ante)} × ${ab} = +${fmt(pay)}（不論莊牌）`));
        }
      }
    } else {
      steps.qualify = `沒有押 Ante，莊牌只是亮出來（${describe(de)}）`;
      steps.compare = '只押 Pair Plus → 不比牌';
    }
    if (pairPlus > 0) {
      const m = PAIR_PLUS[pe.cat];
      if (m) {
        const pay = round2(pairPlus * m);
        lines.push(line('pairPlus', pairPlus, 'win', pay, `${nm('pairPlus')} ${fmt(pairPlus)} × ${m}（${pe.name.zh} ${m}:1）= +${fmt(pay)}（拿回 ${fmt(pairPlus + pay)}）`));
      } else {
        lines.push(line('pairPlus', pairPlus, 'lose', -pairPlus, `${nm('pairPlus')} ${fmt(pairPlus)}：沒有一對以上 → 輸 = −${fmt(pairPlus)}`));
      }
    }
    const wagered = round2(ante + (folded ? 0 : play) + pairPlus);
    const returned = round2(lines.reduce((s, l) => s + l.returned, 0));
    const net = round2(returned - wagered);
    return { pe, de, qualifies: q, cmp, folded, lines, wagered, returned, net, steps,
      outcome: net > 0 ? 'win' : net < 0 ? 'lose' : 'push' };
  }

  // ---------------------------------------------------------------- 註冊
  LG.registerGame({
    id: ID,
    category: 'poker-table',
    order: 2,
    name: { zh: '三張撲克', en: 'Three Card Poker' },
    summary: '三張牌比莊家，另有只看自己牌型的 Pair Plus。Q-6-4 以上就跟。',
    houseEdge: [
      { bet: { zh: '對子加注 Pair Plus（1-4-6-30-40）', en: 'Pair Plus' }, edge: 2.32, best: true },
      { bet: { zh: '底注 Ante/Play（Q-6-4 策略）', en: 'Ante/Play' }, edge: 3.37 },
    ],
    limits: { real: { min: 25, max: 500 }, practice: { min: 10, max: 100000 } },
    denoms: [10, 25, 50, 100, 500, 1000],
    countdown: 15,
    logic: { settle, qualifies, shouldPlay, strategyText, ANTE_BONUS, PAIR_PLUS, Q64, QUAL_MIN, DECIDE_SECONDS },

    create(ctx) {
      const state = { phase: 'idle', player: [], dealer: [], staked: 0, rounds: 0, decision: null, forced: null, last: null };
      const lim = ctx.limits;
      const bets = new LG.Bets({
        min: lim.min, max: Infinity, perSpotMin: lim.min, perSpotMax: lim.max,
        spotRules: {
          pairPlus: { min: lim.min, max: lim.max, label: '對子加注 Pair Plus' },
          ante: { min: lim.min, max: lim.max, label: '底注 Ante' },
          play: { min: 0, max: Infinity, label: '跟注 Play' },
        },
      });
      const shoe = LG.cards.newShoe(1, { cutCard: 0 });
      let root, tableEl, dealerHand, playerHand, dealerRank, playerRank, hintEl, tray, layer, bar, acts, decideCd = null;

      // ---------------------------------------------------------- 桌面
      function spot(id, extra = []) {
        return el('div', { class: ['lg-spot', 'tcp-spot', `tcp-spot--${id}`], dataset: { bet: id } }, [
          el('span.lg-spot__zh', { text: T[id].zh }),
          el('span.lg-spot__en', { text: T[id].en }),
          el('span.lg-spot__odds', { text: T[id].odds }),
          ...extra,
        ]);
      }
      const payTable = (cls, title, rows) => el('div', { class: ['tcp-pay', cls] }, [
        el('div.tcp-pay__title', { html: title }),
        ...rows.map(([z, e, o]) => el('div.tcp-pay__row', [el('span', { html: `${z} <i class="en">${e}</i>` }), el('b', { text: o })])),
      ]);
      function buildTable() {
        tableEl = el('div.lg-table.tcp-table', [
          el('div.tcp-area', [
            el('div.lg-table__label', { html: `${T.dealer.zh} ${T.dealer.en.toUpperCase()}` }),
            dealerHand = el('div.lg-hand.tcp-hand.tcp-dealer', { dataset: { role: 'dealer' } }),
            dealerRank = el('div.tcp-rank', { dataset: { role: 'dealer-rank' } }),
          ]),
          el('div.tcp-print', [
            el('div.tcp-qualify', { html: `<span class="tcp-qualify__en">${T.qualifyPrint}</span><span class="tcp-qualify__zh">${T.qualifyZh}</span>` }),
            el('div.tcp-pays', [
              payTable('tcp-pay--pp', 'PAIR PLUS', T.ppTable),
              payTable('tcp-pay--ab', 'ANTE BONUS', T.abTable),
            ]),
          ]),
          el('div.tcp-area', [
            playerHand = el('div.lg-hand.tcp-hand.tcp-player', { dataset: { role: 'player' } }),
            playerRank = el('div.tcp-rank', { dataset: { role: 'player-rank' } }),
            el('div.lg-table__label', { html: `${T.you.zh} ${T.you.en.toUpperCase()}` }),
          ]),
          el('div.tcp-spots', [
            spot('pairPlus'),
            spot('ante'),
            spot('play', [el('span.tcp-spot__note', { text: T.play.note })]),
          ]),
        ]);
        hintEl = el('div.lg-hint.tcp-hint', { hidden: true });
        const actions = el('div.lg-actions.tcp-actions', { dataset: { dealSlot: '' } });
        const chips = el('div');
        const barEl = el('div');
        root.append(tableEl, hintEl, actions, chips, barEl);
        acts = ui.actionBar(actions, [
          { id: 'fold', label: T.fold.zh, en: T.fold.en, hidden: true, onClick: () => decide('fold') },
          { id: 'play', label: T.playBtn.zh, en: T.playBtn.en, primary: true, hidden: true, onClick: () => decide('play') },
        ]);
        tray = ui.chipTray(chips, { denoms: ctx.denoms, selected: ctx.isReal ? 25 : 10 });
        layer = ui.betLayer(tableEl, { bets, chipTray: tray, gameId: ctx.gameId, canPlace });
        bar = ui.betBar(barEl, { bets, layer });
        renderHands([], [], { placeholders: true });
      }

      function canPlace(spotId, amount) {
        if (spotId === 'play') return T.playAuto;
        if (spotId === 'ante') {
          const ante = round2(bets.get('ante') + amount);
          const need = round2(bets.total() + amount + ante);
          if (!ctx.bank.canAfford(need) && ctx.bank.canAfford(round2(bets.total() + amount))) ui.toast(T.playWarn(ante), { type: 'warn' });
        }
        return true;
      }

      function renderHand(container, cards, down) {
        container.innerHTML = '';
        const out = [];
        for (let i = 0; i < 3; i++) {
          const c = cards[i] || null;
          const e = ui.card(c, { faceDown: !c || down, dim: !c, size: 'lg' });
          container.appendChild(e);
          out.push(e);
        }
        return out;
      }
      function renderHands(player, dealer, { revealDealer = true, placeholders = false } = {}) {
        renderHand(playerHand, player, placeholders);
        renderHand(dealerHand, dealer, !revealDealer);
        playerRank.innerHTML = player.length === 3 ? describe(poker.eval3(player)) : '';
        dealerRank.innerHTML = revealDealer && dealer.length === 3 ? describe(poker.eval3(dealer)) : '';
      }
      function markSpots(lines) {
        tableEl.querySelectorAll('[data-bet]').forEach((s) => {
          const l = lines && lines.find((x) => x.spot === s.dataset.bet);
          s.classList.toggle('is-win', !!l && l.result === 'win');
          s.classList.toggle('is-lose', !!l && l.result === 'lose');
        });
      }

      // ---------------------------------------------------------- 提示
      function paintHints() {
        hintEl.hidden = !ctx.hints;
        if (!ctx.hints) return;
        if (state.phase === 'decide') {
          const pe = poker.eval3(state.player);
          hintEl.innerHTML = `建議：<b>${shouldPlay(pe) ? '跟注 Play' : '棄牌 Fold'}</b> — ${strategyText(pe)}`;
        } else {
          hintEl.innerHTML = '提示：Pair Plus 優勢 2.32%、Ante/Play 3.37%。跟注門檻 <b>Q-6-4</b>；記得 <b>順子 > 同花</b>。';
        }
      }
      function strategyNode() {
        return el('div', [
          el('p', { html: '看牌後：<b>Q-6-4 以上跟注 Play</b>，否則棄牌。先比最大張（Q），再比第二張（6），再比第三張（4）。一對以上一律跟。' }),
          el('p', { html: `牌型排序：${T.ranking}` }),
          ui.table([['Pair Plus', '賠率'], ...T.ppTable.map(([z, e, o]) => [term(z, e), o])], { caption: '對子加注 Pair Plus（只看你的牌）' }),
          ui.table([['Ante Bonus', '賠率'], ...T.abTable.map(([z, e, o]) => [term(z, e), o])], { caption: 'Ante 獎金（有跟注就領，不論莊牌）' }),
          el('p.lg-muted', { text: '莊家優勢：Pair Plus 2.32%；Ante/Play 3.37%（照 Q-6-4）。' }),
        ]);
      }

      // ---------------------------------------------------------- 一局流程
      function startRound() {
        if (!ctx.alive()) return;
        state.phase = 'betting';
        state.decision = null;
        acts.set('fold', { hidden: true, disabled: true });
        acts.set('play', { hidden: true, disabled: true });
        paintHints();
        ctx.bettingWindow({ bets, onClose: onNoMoreBets, validate: preDealCheck });
      }
      function preDealCheck() {
        return bets.get('ante') > 0 || bets.get('pairPlus') > 0 ? true : T.needBet;
      }

      async function onNoMoreBets({ ok, validation }) {
        const own = ok ? preDealCheck() : validation.zh;
        if (own !== true) {
          bets.unlock();
          if (bets.total() > 0) ui.toast(own, { type: 'warn' });
          ctx.nextRound(startRound);
          return;
        }
        state.staked = bets.total();
        ctx.bank.debit(state.staked);
        state.phase = 'dealing';
        markSpots(null);
        ctx.dealer.say('發牌', 'Dealing');
        shoe.shuffle();
        if (state.forced) { shoe.stack(state.forced); state.forced = null; }
        const player = [], dealer = [];
        for (let i = 0; i < 3; i++) { player.push(shoe.draw()); dealer.push(shoe.draw()); }
        state.player = player; state.dealer = dealer;
        playerRank.innerHTML = ''; dealerRank.innerHTML = '';
        const pEls = renderHand(playerHand, player, true);
        renderHand(dealerHand, dealer, true);
        await ctx.wait(250);
        for (const e of pEls) { await ui.flip(e); if (!ctx.alive()) return; }
        playerRank.innerHTML = describe(poker.eval3(player));
        if (bets.get('ante') > 0) enterDecision();
        else { state.decision = null; state.phase = 'showdown'; await reveal(); }
      }

      function enterDecision() {
        state.phase = 'decide';
        const add = bets.get('ante');
        const can = ctx.bank.canAfford(add);
        acts.set('fold', { hidden: false, disabled: false });
        acts.set('play', { hidden: false, disabled: !can, label: can ? T.playBtn.zh : `${T.playBtn.zh}（${T.noPlayCash}）`, en: can ? `Play ${fmt(add)}` : '' });
        ctx.dealer.say(...T.decide);
        paintHints();
        if (ctx.isReal) {
          decideCd = ui.countdown(DECIDE_SECONDS, { onDone: () => { decideCd = null; if (ctx.alive() && state.phase === 'decide') { ui.toast(T.timeout, { type: 'warn' }); decide('fold', true); } } });
        }
      }

      async function decide(choice, auto = false) {
        if (state.phase !== 'decide') return;
        if (decideCd) { decideCd.cancel(); decideCd = null; }
        if (choice === 'play') {
          const add = bets.get('ante');
          if (!ctx.bank.canAfford(add)) { ui.toast(T.noPlayCash, { type: 'warn' }); return; }
          bets.set('play', add);
          ctx.bank.debit(add);
          state.staked = round2(state.staked + add);
          ctx.dealer.say('跟注', 'Play');
        } else {
          ctx.dealer.say(auto ? '時間到，棄牌' : '棄牌', 'Fold');
        }
        state.decision = choice;
        state.phase = 'showdown';
        acts.set('fold', { hidden: true, disabled: true });
        acts.set('play', { hidden: true, disabled: true });
        paintHints();
        await reveal();
      }

      async function reveal() {
        await ctx.wait(300);
        if (!ctx.alive()) return;
        for (const e of [...dealerHand.children]) { await ui.flip(e); if (!ctx.alive()) return; }
        dealerRank.innerHTML = describe(poker.eval3(state.dealer));
        finishRound();
      }

      function finishRound() {
        const r = settle({
          ante: bets.get('ante'), play: bets.get('play'), pairPlus: bets.get('pairPlus'),
          folded: state.decision === 'fold', player: state.player, dealer: state.dealer,
        });
        ctx.bank.credit(r.returned);
        state.staked = 0;
        state.last = r;
        markSpots(r.lines);
        const antePlayed = bets.get('ante') > 0 && !r.folded;
        ctx.dealer.say(r.folded ? '棄牌，收 Ante' : !antePlayed ? '派彩' : r.qualifies ? (r.cmp > 0 ? '你贏' : r.cmp < 0 ? '莊贏' : '平手') : '莊家不合格', 'Paying out');
        ctx.recordRound({ wagered: r.wagered, net: r.net, outcome: r.outcome });
        ctx.explain(explainOf(r));
        state.rounds += 1;
        state.phase = 'settled';
        bets.unlock();
        bets.clear();
        ctx.checkBroke();
        ctx.nextRound(startRound);
      }

      function explainOf(r) {
        const why = [];
        if (bets.get('ante') > 0) {
          const sp = shouldPlay(r.pe);
          const did = state.decision === 'play';
          why.push(`策略：${strategyText(r.pe)}。你選了<b>${did ? '跟注' : '棄牌'}</b>${sp === did ? ' ✓ 符合策略' : '，和策略不同'}。`);
          if (!r.folded && !r.qualifies) why.push('莊不合格時 Play 只退回，這是 Ante/Play 莊家優勢的來源。');
        }
        if (bets.get('pairPlus') > 0) why.push('Pair Plus 只看你的三張，和莊家、棄牌都無關。');
        if (r.pe.cat === 'STRAIGHT' || r.pe.cat === 'FLUSH') why.push(`三張牌時同花比順子容易出現，所以 <b>順子 > 同花</b>。`);
        return {
          hand: `你 <i class="en">You</i>：${labels(state.player)} → <b>${describe(r.pe)}</b><br>莊 <i class="en">Dealer</i>：${labels(state.dealer)} → <b>${describe(r.de)}</b>`,
          result: `① 莊是否合格：${r.steps.qualify}<br>② 比牌：${r.steps.compare}`,
          formula: `③ 每注計算：<br>${r.lines.map((l) => l.formula).join('<br>')}<br>淨 <b>${fmtSigned(r.net)}</b>（拿回 ${fmt(r.returned)} − 下注 ${fmt(r.wagered)}）`,
          why: why.join(''),
        };
      }

      // ---------------------------------------------------------- 教學用
      const demo = {
        ensureBetting() { if (state.phase === 'idle' || state.phase === 'settled') startRound(); },
        /** 下一局指定牌：player 3 張、dealer 3 張 */
        force(p, d) {
          const P = LG.cards.parseMany(p), D = LG.cards.parseMany(d);
          state.forced = [P[0], D[0], P[1], D[1], P[2], D[2]];
        },
        show(p, d, { reveal: rv = true } = {}) {
          if (['dealing', 'decide', 'showdown'].includes(state.phase)) return;
          renderHands(LG.cards.parseMany(p), LG.cards.parseMany(d), { revealDealer: rv });
        },
        say(zh, en) { ctx.dealer.say(zh, en); },
      };

      // ---------------------------------------------------------- 教學步驟（23 步）
      function tutorialSteps() {
        return [
          // ===== layout
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：桌面',
            body: '<p>上方莊家三張、下方你三張，最下面三個下注格：Pair Plus、Ante、Play。</p>',
            highlight: ['.tcp-table'] },
          { id: 'layout-pairplus', section: 'layout', title: '對子加注 <i class="en">Pair Plus</i>',
            body: '<p>只看<b>你自己的三張</b>，有一對以上就賠，和莊家無關。</p>',
            highlight: ['[data-bet="pairPlus"]'] },
          { id: 'layout-ante', section: 'layout', title: '底注 <i class="en">Ante</i>',
            body: '<p>要和莊家比牌就押 Ante。Pair Plus 和 Ante 可以只押其中一個。</p>',
            highlight: ['[data-bet="ante"]'] },
          { id: 'layout-play', section: 'layout', title: '跟注 <i class="en">Play</i> 格',
            body: '<p>最靠近你的格子。看牌後要玩，就放<b>與 Ante 同額</b>；這格不用自己放籌碼。</p>',
            highlight: ['[data-bet="play"]'] },
          { id: 'layout-print', section: 'layout', title: '桌上印字與賠付表',
            body: '<p>印字 <b>DEALER PLAYS WITH QUEEN HIGH OR BETTER</b>：莊家 Q 高以上才合格。下面是兩張賠付表。</p>',
            highlight: ['.tcp-print'] },
          // ===== flow
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：一局怎麼進行',
            body: '<p>先放 Ante／Pair Plus → 發牌 → 看牌後 <b>棄牌</b> 或 <b>跟注 Play</b> → 莊開牌 → 結算。</p>',
            highlight: ['.lg-dealer-banner'],
            setup: (inst) => { inst.demo.ensureBetting(); inst.demo.say('請下注', 'Place your bets'); } },
          { id: 'flow-ante', section: 'flow', title: '押底注',
            body: '<p>選 RM 25 籌碼，點「底注 ANTE」格。長按或右鍵可拿回一枚。</p>',
            highlight: ['[data-bet="ante"]', '.lg-chips'],
            setup: (inst) => inst.demo.ensureBetting(),
            action: { label: '在「底注 ANTE」放 RM 25', check: (inst) => inst.bets.get('ante') >= 25 || inst.state.rounds > 0 || inst.state.phase !== 'betting' || `目前 Ante 上有 ${fmt(inst.bets.get('ante'))}` } },
          { id: 'flow-deal', section: 'flow', title: '發牌 <i class="en">Deal</i>',
            body: '<p>按「發牌」。你和莊家各拿三張，莊家的牌全部蓋著。</p>',
            highlight: ['[data-action="deal"]'],
            setup: (inst) => { inst.demo.ensureBetting(); inst.demo.force('KS 7H 2D', 'QC 9D 4H'); },
            action: { label: '按「發牌 Deal」', check: (inst) => inst.state.phase === 'decide' || inst.state.rounds > 0 || '先放 Ante，再按發牌' } },
          { id: 'flow-hands-off', section: 'flow', title: '放好後不能碰',
            body: '<p>荷官說 <b>No more bets</b> 後，手放桌下。Ante 和 Pair Plus 都不能再碰，只能在 Play 格加注。</p>',
            highlight: ['[data-bet="ante"]', '[data-bet="pairPlus"]', '.lg-dealer-banner'] },
          { id: 'flow-play', section: 'flow', title: '棄牌或跟注',
            body: '<p>你 K-7-2，比 Q-6-4 大。按 <b>跟注</b>，系統在 Play 格自動放與 Ante 同額。</p>',
            highlight: ['[data-action="play"]', '[data-bet="play"]'],
            action: { label: '按「跟注 Play」', check: (inst) => inst.state.rounds > 0 || (inst.state.phase === 'decide' ? '按下方「跟注」' : '先回上一步發牌') } },
          // ===== payout
          { id: 'payout-intro', section: 'payout', title: '這段你會學到：怎麼賠',
            body: '<p>先看 <b>莊是否合格</b>（Q 高以上），再 <b>比牌</b>，最後每注各算一次。以下 Ante、Play 各 RM 25。</p>',
            highlight: ['.tcp-spots'] },
          { id: 'payout-noqual', section: 'payout', title: '情境一：莊不合格',
            body: '<p>莊 J-9-4 → 不合格。<br>Ante：<b>RM 25 × 1 = RM 25</b>（淨贏，拿回 RM 50）<br>Play：退回 RM 25（push）</p>',
            highlight: ['.tcp-dealer', '[data-bet="ante"]'],
            setup: (inst) => inst.demo.show('KS 7H 2D', 'JC 9D 4H') },
          { id: 'payout-win', section: 'payout', title: '情境二：莊合格，你贏',
            body: '<p>你一對 8，莊 A 高。<br>Ante <b>RM 25 × 1 = RM 25</b>，Play <b>RM 25 × 1 = RM 25</b><br>淨贏 RM 50，拿回 RM 100。</p>',
            highlight: ['.tcp-player', '[data-bet="play"]'],
            setup: (inst) => inst.demo.show('8S 8H 3D', 'AC 9D 4H') },
          { id: 'payout-lose', section: 'payout', title: '情境三：莊合格，你輸',
            body: '<p>你 K 高，莊一對 5。<br>Ante 輸 RM 25，Play 輸 RM 25，<b>共 −RM 50</b>。</p>',
            highlight: ['.tcp-dealer', '.tcp-player'],
            setup: (inst) => inst.demo.show('KS 7H 2D', '5C 5D 9H') },
          { id: 'payout-ante-bonus', section: 'payout', title: 'Ante 獎金 <i class="en">Ante Bonus</i>',
            body: '<p>有跟注時，拿到順子以上<b>不論莊牌、不論輸贏</b>另外賠：順 1:1、三條 4:1、同花順 5:1。Ante RM 25 拿三條 → +RM 100。</p>',
            highlight: ['.tcp-pay--ab', '[data-bet="ante"]'],
            setup: (inst) => inst.demo.show('9S 9H 9D', 'AC KD 4H') },
          { id: 'payout-pairplus', section: 'payout', title: 'Pair Plus 獨立結算',
            body: '<p>Pair Plus 和 Ante 各算各的。押 RM 25 拿三條：<b>RM 25 × 30 = RM 750</b>，拿回 RM 775。棄牌也照算。</p>',
            highlight: ['.tcp-pay--pp', '[data-bet="pairPlus"]'],
            setup: (inst) => inst.demo.show('9S 9H 9D', 'AC KD 4H') },
          { id: 'payout-ranking', section: 'payout', title: '順子 > 同花',
            body: `<p>三張牌的排序：${T.ranking}。三張牌湊同花比湊順子容易，所以<b>順子比同花大</b>——和五張撲克相反。</p>`,
            highlight: ['.tcp-pay--pp'],
            setup: (inst) => inst.demo.show('5S 6H 7D', '2H 9H KH') },
          // ===== strategy
          { id: 'strategy-edge', section: 'strategy', title: '這段你會學到：莊家優勢 <i class="en">House edge</i>',
            body: '<table class="lg-datatable"><tr><th>注</th><th>優勢</th></tr><tr><td>Pair Plus（1-4-6-30-40）</td><td>2.32%</td></tr><tr><td>Ante/Play（Q-6-4）</td><td>3.37%</td></tr></table>',
            highlight: null },
          { id: 'strategy-q64', section: 'strategy', title: 'Q-6-4 規則',
            body: '<p><b>Q-6-4 以上跟注，否則棄牌。</b>先比最大張、再比第二張、再比第三張：Q-6-4 跟，Q-6-3 棄，Q-7-2 跟。</p>',
            highlight: ['[data-action="play"]', '[data-action="fold"]', '.tcp-player'],
            setup: (inst) => inst.demo.show('QS 6H 4D', '2C 2D 9H', { reveal: false }) },
          { id: 'strategy-do', section: 'strategy', title: '該押',
            body: '<p>Pair Plus（2.32%）比 Ante（3.37%）<b>划算一點</b>。押 Ante 就照 Q-6-4 決定。</p>',
            highlight: ['[data-bet="pairPlus"]', '[data-bet="ante"]'] },
          { id: 'strategy-dont', section: 'strategy', title: '別這樣做',
            body: '<p>別：Q-6-4 以下還硬跟、或每手都不看就跟——長期虧得比 3.37% 多。也別以為「好久沒三條」就加大 Pair Plus，每手都獨立。</p>',
            highlight: ['[data-bet="play"]'] },
          { id: 'strategy-budget', section: 'strategy', title: '預算',
            body: '<p>跟注要再放一份 Ante，每局最多 2×Ante + Pair Plus。今晚只帶 RM 500，輸完就走。</p>',
            highlight: ['.lg-topbar .lg-balance'] },
        ];
      }

      return {
        bets, state, demo,
        tray: () => tray,
        mount(el0) {
          root = el0;
          root.classList.add('tcp');
          buildTable();
          paintHints();
          ctx.on('hints:change', paintHints);
          if (ctx.isPractice) ctx.strategyPanel(strategyNode());
          root.dataset.ready = '1';
          startRound();
        },
        unmount() {
          if (decideCd) { decideCd.cancel(); decideCd = null; }
          if (state.staked > 0) { ctx.bank.credit(state.staked); state.staked = 0; }
          if (layer) layer.destroy();
          if (bar) bar.destroy();
        },
        tutorialSteps,
      };
    },
  });
})();
