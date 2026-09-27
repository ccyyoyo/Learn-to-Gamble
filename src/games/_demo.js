// ============================================================================
// 示範遊戲「猜大小 Hi-Lo」（id: _demo）— 遊戲代理的參考範本，整合階段刪除。
//
// 規則：荷官抽一張牌（每次獨立抽，等於無限副牌）。
//   8 以上（8, 9, 10, J, Q, K, A；7/13）→「大 Hi」贏，賠 4:5（0.8 倍）
//   7 以下（2–7；6/13）              →「小 Lo」贏，賠 11:10（1.1 倍）
//   兩邊的莊家優勢都是 1/13 × 0.4 ≈ 3.08%（機率高的一邊賠得少）。
//
// 這個檔案示範：
//   1. registerGame 的 def 欄位（含 variants、countdown、logic 供單元測試）
//   2. create(ctx) → instance：mount / unmount / tutorialSteps / demo
//   3. 一局流程：ctx.bettingWindow → 扣款 → 發牌 → 結算 → ctx.recordRound → ctx.explain → ctx.nextRound
//   4. LG.Bets + LG.ui.chipTray + LG.ui.betLayer + LG.ui.betBar 的接法
//   5. 練習模式提示（ctx.hints / 'hints:change' / ctx.strategyPanel）
//   6. 咪牌變體（LG.ui.squeezeable）
//   7. 教學 14 步（四段、3 個 action）
// ============================================================================
(() => {
  const { ui, money } = LG;
  const { el, term } = ui;
  const { fmt, round2 } = money;

  // ---------------------------------------------------------------- 規則常數（集中管理）
  const RANKS = '23456789TJQKA';
  const SUITS = 'SHDC';
  const HI_MIN = 8;                     // 牌值 ≥ 8 為「大」
  const PAYS = { hi: 0.8, lo: 1.1 };    // 淨賠倍數
  const T = {                           // 文案集中：中文 / 英文 / 賠率
    hi: { zh: '大', en: 'Hi', odds: '4:5', rule: '8 以上' },
    lo: { zh: '小', en: 'Lo', odds: '11:10', rule: '7 以下' },
  };

  // ---------------------------------------------------------------- 純邏輯（可在 Node 單元測試）
  const rankValue = (r) => RANKS.indexOf(r) + 2;           // 2..14（A = 14）
  const outcomeOf = (card) => (rankValue(card.rank) >= HI_MIN ? 'hi' : 'lo');
  const cardLabel = (c) => `${c.rank === 'T' ? '10' : c.rank}${ui.SUIT[c.suit].symbol}`;

  function drawCard() {
    const rank = LG.rng.pick([...RANKS]);
    const suit = LG.rng.pick([...SUITS]);
    return { rank, suit, id: rank + suit };
  }

  /**
   * 結算。entries = bets.entries()（[[spotId, stake]]）
   * @returns {{outcome, wagered, returned, net, lines:[{spot, stake, result, pay, formula}]}}
   *   returned = 拿回金額（含本金），net = returned − wagered
   */
  function settle(entries, card) {
    const outcome = outcomeOf(card);
    let wagered = 0, returned = 0;
    const lines = entries.map(([spot, stake]) => {
      wagered += stake;
      if (spot === outcome) {
        const pay = round2(stake * PAYS[spot]);
        returned += stake + pay;
        return { spot, stake, result: 'win', pay,
          formula: `${T[spot].zh} ${fmt(stake)} × ${PAYS[spot]} = +${fmt(pay)}（拿回 ${fmt(stake + pay)}）` };
      }
      return { spot, stake, result: 'lose', pay: -stake, formula: `${T[spot].zh} ${fmt(stake)} → −${fmt(stake)}` };
    });
    wagered = round2(wagered); returned = round2(returned);
    return { outcome, wagered, returned, net: round2(returned - wagered), lines };
  }

  // ---------------------------------------------------------------- 註冊
  LG.registerGame({
    id: '_demo',
    category: 'table',
    order: 99,
    demo: true,                                   // 擴充欄位：首頁標「示範」
    name: { zh: '猜大小', en: 'Hi-Lo (Demo)' },
    summary: '抽一張牌，猜 8 以上還是 7 以下。框架示範用。',
    houseEdge: [
      { bet: { zh: '大', en: 'Hi' }, edge: 3.08, best: true },
      { bet: { zh: '小', en: 'Lo' }, edge: 3.08 },
    ],
    limits: { real: { min: 25, max: 500 }, practice: { min: 10, max: 100000 } },
    denoms: [10, 25, 50, 100, 500, 1000],
    countdown: 10,                                // 擴充欄位：真實模式倒數秒數（進場說明用）
    variants: [
      { id: 'classic', name: { zh: '標準', en: 'Classic' } },
      { id: 'squeeze', name: { zh: '咪牌', en: 'Squeeze' } },
    ],
    logic: { settle, outcomeOf, rankValue, PAYS },  // 擴充欄位：給單元測試用

    create(ctx) {
      // ---- 狀態（每次 create 都是新的；切換模式/變體會重新 create）
      const state = { phase: 'idle', card: null, staked: 0, rounds: 0 };
      const bets = new LG.Bets({
        min: ctx.limits.min, max: ctx.limits.max,
        labels: { hi: '大 Hi', lo: '小 Lo' },
      });
      let root, tableEl, cardSlot, hintEl, tray, layer, bar;

      // ---- 桌面：一次建好，之後只更新牌區與籌碼堆
      function spot(id) {
        return el('div.lg-spot.demo-spot', { dataset: { bet: id } }, [
          el('span.lg-spot__zh', { text: T[id].zh }),
          el('span.lg-spot__en', { text: T[id].en }),
          el('span.lg-spot__odds', { text: T[id].odds }),
          el('span.demo-spot__rule', { text: T[id].rule }),
        ]);
      }
      function buildTable() {
        tableEl = el('div.lg-table.demo-table', [
          el('div.lg-table__label', { text: 'Dealer 荷官' }),
          cardSlot = el('div.lg-hand.demo-cardslot', { dataset: { role: 'card' } }),
          el('div.demo-rule', { html: `8 以上 = 大 <i class="en">Hi</i> · 7 以下 = 小 <i class="en">Lo</i>` }),
          el('div.demo-spots', [spot('hi'), spot('lo')]),
        ]);
        const actions = el('div.lg-actions', { dataset: { dealSlot: '' } }); // 框架把「發牌 Deal」按鈕放這裡
        const chips = el('div');
        const barEl = el('div');
        hintEl = el('div.lg-hint.demo-hint', { hidden: true });
        root.append(tableEl, hintEl, actions, chips, barEl);

        tray = ui.chipTray(chips, { denoms: ctx.denoms, selected: ctx.isReal ? 25 : 10 });
        layer = ui.betLayer(tableEl, { bets, chipTray: tray, gameId: ctx.gameId });
        bar = ui.betBar(barEl, { bets, layer });
        showCard(null);
      }

      /** 牌區：null = 蓋著的空位 */
      function showCard(card, { faceDown = false } = {}) {
        cardSlot.innerHTML = '';
        const c = ui.card(card, { faceDown: faceDown || !card, size: 'lg' });
        cardSlot.appendChild(c);
        return c;
      }
      function markSpots(outcome) {
        tableEl.querySelectorAll('[data-bet]').forEach((s) => {
          s.classList.toggle('is-win', !!outcome && s.dataset.bet === outcome);
          s.classList.toggle('is-lose', !!outcome && s.dataset.bet !== outcome);
        });
      }

      // ---- 練習提示
      function paintHints() {
        hintEl.hidden = !ctx.hints;
        hintEl.innerHTML = '提示：大、小的莊家優勢一樣（3.08%）。大比較常中，但只賠 0.8 倍。<b>不要兩邊同時押</b>——一定虧。';
      }

      // ---- 一局流程
      function startRound() {
        if (!ctx.alive()) return;
        state.phase = 'betting';
        markSpots(null);
        showCard(null);
        // 真實：倒數 → No more bets；練習/教學：顯示「發牌」按鈕。關閉時框架會 bets.lock()
        ctx.bettingWindow({ bets, onClose: onNoMoreBets });
      }

      async function onNoMoreBets({ ok, validation }) {
        if (!ok) {
          // 真實模式倒數結束但沒下注 / 不合法 → 這局不發牌，解鎖等下一局
          bets.unlock();
          if (bets.total() > 0) ui.toast(validation.zh, { type: 'warn' });
          ctx.nextRound(startRound);
          return;
        }
        // No more bets 後籌碼才真正離手：扣款
        state.staked = bets.total();
        ctx.bank.debit(state.staked);
        state.phase = 'dealing';
        ctx.dealer.say('發牌', 'Dealing');
        const card = drawCard();
        await revealCard(card);
        if (!ctx.alive()) return;           // 使用者中途離開
        finishRound(card);
      }

      function revealCard(card) {
        const cEl = showCard(card, { faceDown: true });
        if (ctx.variant === 'squeeze') {
          ctx.dealer.say('請開牌', 'Card please');
          return new Promise((resolve) => ui.squeezeable(cEl, card, { onRevealed: () => resolve() }));
        }
        return ctx.wait(350).then(() => ui.flip(cEl, card));
      }

      function finishRound(card) {
        state.card = card;
        const r = settle(bets.entries(), card);
        ctx.bank.credit(r.returned);          // 拿回（含本金）
        state.staked = 0;
        markSpots(r.outcome);
        ctx.dealer.say(`${cardLabel(card)}，${T[r.outcome].zh}！`, `${T[r.outcome].en} wins`);

        ctx.recordRound({ wagered: r.wagered, net: r.net, outcome: r.net > 0 ? 'win' : r.net < 0 ? 'lose' : 'push' });
        ctx.explain({                          // 練習/教學 → resultPanel；真實 → 只閃金額
          hand: `荷官抽到 <b>${cardLabel(card)}</b>（牌值 ${rankValue(card.rank)}）`,
          result: `${T[r.outcome].zh} <i class="en">${T[r.outcome].en.toUpperCase()} WINS</i>`,
          formula: r.lines.map((l) => l.formula).join('<br>') + `<br>淨 <b>${money.fmtSigned(r.net)}</b>`,
          why: `${rankValue(card.rank)} ${r.outcome === 'hi' ? '≥ 8 所以是大' : '≤ 7 所以是小'}。`
            + (r.outcome === 'hi' ? '大比較常出現（7/13），所以只賠 0.8 倍。' : '小比較少出現（6/13），所以賠 1.1 倍。'),
        });

        state.rounds += 1;
        state.phase = 'settled';
        bets.unlock();
        bets.clear();                          // 上一注已存進 bets.last → 「重複上注」可用
        ctx.checkBroke();                      // 真實模式餘額 < 最低注 → 覆蓋層（nextRound 會等重置）
        ctx.nextRound(startRound);             // 真實：3 秒後；練習/教學：立即
      }

      // ---- 教學用：instance.demo.* 讓 step.setup 擺出示範狀態
      const demo = {
        showCard(id) { showCard({ rank: id[0], suit: id[1], id }); },
        showBanner(zh, en) { ctx.dealer.say(zh, en); },
        ensureBetting() { if (state.phase !== 'betting') startRound(); },
      };

      // ---- 教學步驟（14 步：layout 4、flow 4、payout 3、strategy 3；action 3 個）
      function tutorialSteps() {
        return [
          // ===== layout 桌面
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：桌面',
            body: '<p>猜大小只有兩個下注格和一個牌位。先認識桌面，再動手。</p>',
            highlight: ['.demo-table'] },
          { id: 'layout-hi', section: 'layout', title: `大 <i class="en">Hi</i> 下注格`,
            body: '<p>牌值 <b>8 以上</b>（8、9、10、J、Q、K、A）算大。格子上的 <b>4:5</b> 是賠率。</p>',
            highlight: ['[data-bet="hi"]'] },
          { id: 'layout-lo', section: 'layout', title: `小 <i class="en">Lo</i> 下注格`,
            body: '<p>牌值 <b>7 以下</b>（2–7）算小，賠率 <b>11:10</b>。</p>',
            highlight: ['[data-bet="lo"]'] },
          { id: 'layout-chips', section: 'layout', title: `籌碼 <i class="en">Chips</i>`,
            body: '<p>顏色代表面額：10 藍、25 綠、50 橙、100 黑、500 紫、1000 黃。現場顏色可能不同，看面額。</p>',
            highlight: ['.lg-chips'],
            action: { label: '點選綠色的 RM 25 籌碼', check: (inst) => inst.tray().selected() === 25 || '點一下「25」那枚籌碼' } },
          // ===== flow 流程
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：一局怎麼進行',
            body: `<p>荷官說 <b>請下注 <i class="en">Place your bets</i></b> → 你放籌碼 → 發牌 → 派彩。</p>`,
            highlight: ['.lg-dealer-banner'],
            setup: (inst) => { inst.demo.ensureBetting(); inst.demo.showBanner('請下注', 'Place your bets'); } },
          { id: 'flow-place', section: 'flow', title: '放籌碼',
            body: '<p>點下注格放一枚目前選的籌碼；長按或右鍵拿回一枚。</p>',
            highlight: ['[data-bet="hi"]', '.lg-chips'],
            setup: (inst) => inst.demo.ensureBetting(),
            action: { label: '在「大 HI」放 RM 25', check: (inst) => inst.bets.get('hi') >= 25 || `目前「大」上有 ${fmt(inst.bets.get('hi'))}` } },
          { id: 'flow-deal', section: 'flow', title: `發牌 <i class="en">Deal</i>`,
            body: '<p>練習時按「發牌」開始；真實模式是倒數結束自動開始。</p>',
            highlight: ['[data-action="deal"]'],
            setup: (inst) => inst.demo.ensureBetting(),
            action: { label: '按「發牌 Deal」玩一局', check: (inst) => inst.state.rounds > 0 || '先放籌碼，再按發牌' } },
          { id: 'flow-no-more-bets', section: 'flow', title: `停止下注 <i class="en">No more bets</i>`,
            body: '<p>荷官說 <b>No more bets</b> 之後，手放桌下——加、減、移動籌碼都不行，等派彩完成。</p>',
            highlight: ['.lg-dealer-banner', '.demo-spots'],
            setup: (inst) => inst.demo.showBanner('停止下注', 'No more bets') },
          // ===== payout 賠率
          { id: 'payout-intro', section: 'payout', title: '這段你會學到：賠率怎麼算',
            body: '<p><b>4:5</b> 表示押 5 贏 4；<b>11:10</b> 表示押 10 贏 11。贏了會拿回本金 + 彩金。</p>',
            highlight: ['.lg-spot__odds'] },
          { id: 'payout-hi', section: 'payout', title: '大贏的例子',
            body: '<p>押大 RM 100，開 Q：<br><b>RM 100 × 0.8 = RM 80</b>（淨贏）<br>拿回 RM 180（含本金）。</p>',
            highlight: ['[data-bet="hi"]', '.demo-cardslot'],
            setup: (inst) => inst.demo.showCard('QH') },
          { id: 'payout-lo', section: 'payout', title: '小贏的例子',
            body: '<p>押小 RM 100，開 5：<br><b>RM 100 × 1.1 = RM 110</b>（淨贏）<br>拿回 RM 210（含本金）。</p>',
            highlight: ['[data-bet="lo"]', '.demo-cardslot'],
            setup: (inst) => inst.demo.showCard('5S') },
          // ===== strategy 策略
          { id: 'strategy-edge', section: 'strategy', title: `莊家優勢 <i class="en">House edge</i>`,
            body: '<table class="lg-datatable"><tr><th>注</th><th>中獎率</th><th>優勢</th></tr><tr><td>大</td><td>7/13</td><td>3.08%</td></tr><tr><td>小</td><td>6/13</td><td>3.08%</td></tr></table><p>長期每押 RM 100 平均輸 RM 3.08。</p>',
            highlight: null },
          { id: 'strategy-bet', section: 'strategy', title: '該押 / 別押',
            body: '<p>該押：大或小擇一，優勢一樣。<br>別押：<b>兩邊同時押</b>——一定有一邊輸，淨額必虧。</p>',
            highlight: ['.demo-spots'] },
          { id: 'strategy-budget', section: 'strategy', title: '預算',
            body: '<p>今晚只帶 RM 500，輸完就走。上一局的結果不會影響下一張牌。</p>',
            highlight: ['.lg-topbar .lg-balance'] },
        ];
      }

      // ---- instance
      return {
        bets,                                   // 教學 action.check 讀取
        state,
        tray: () => tray,
        demo,
        mount(el0) {
          root = el0;
          buildTable();
          paintHints();
          ctx.on('hints:change', paintHints);   // ctx.on 會在卸載時自動解除
          if (ctx.isPractice) {
            ctx.strategyPanel(ui.table([['注', '賠率', '優勢'], ['大 Hi', '4:5', '3.08%'], ['小 Lo', '11:10', '3.08%']], { caption: '兩邊優勢相同' }));
          }
          root.dataset.ready = '1';
          startRound();
        },
        unmount() {
          // 局中離開：退回已扣的注金（ctx.later/wait 的計時器由框架清除）
          if (state.staked > 0) { ctx.bank.credit(state.staked); state.staked = 0; }
          if (layer) layer.destroy();
          if (bar) bar.destroy();
        },
        tutorialSteps,
      };
    },
  });
})();
