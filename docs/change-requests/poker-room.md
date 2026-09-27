# poker-room（德州撲克現金桌）實作備註與變更請求

撲克室是「玩家對玩家」，跟其他遊戲的「下注格 + 發牌」模型不同。以下是與合約 / DoD 的差異與我的繞過方式；都不需要改核心就能運作。

## CR-1 不用籌碼盤、betLayer、`data-bet` 下注格
- 現況：DoD 要求每個下注格 `data-bet` + 中英 + 賠率；撲克室沒有下注格（下注是「加注到 RM x」）。
- 做法：def 省略 `denoms`（registry 仍會補預設值，未使用）；桌面是橢圓桌 + 座位環繞，動作列（Fold / Check-Call / Bet-Raise + 滑桿 + ½池 ¾池 池 全下）取代籌碼盤。按鈕有 `data-action`（`deal` / `fold` / `call` / `raise`、`data-size`）。
- 建議：整合代理驗收時把 poker-room 的「下注格」項目改為「動作列與座位」。

## CR-2 買入 / 離桌金流（取代「No more bets 後扣款」）
- 進桌（練習/真實）先開「買入 Buy-in」modal（`[data-action="buyin"]`）：RM 400–1,000（上限不超過餘額），從 `bank.debit` 扣；可選 3 / 4 / 5 個 AI。
- 離桌：返回首頁、切模式（`unmount`）或按「離桌 Leave table」→ 桌上籌碼 `bank.credit` 轉回餘額。
- **局中離桌 = 棄牌**：已放進底池的籌碼不退（撲克室現場規則；也防止輸的時候離桌退錢）。因為 teardown 時 `ctx.alive()` 已是 false，`ctx.recordRound` 不記，所以直接呼叫 `LG.stats.record` / `LG.stats.session.record` 記這手（net = −已投入）。
- 桌上籌碼歸零：跳「再買入 Rebuy」modal（可離桌）。真實模式餘額 < RM 400 → `ctx.checkBroke()` 覆蓋層，`ctx.nextRound(openBuyIn)` 等重置後再開買入。練習模式餘額不足 → 自己的 modal 提供「重置籌碼 RM 1,000」。
- 教學模式用示範籌碼 RM 1,000，不動餘額。

## CR-3 `limits` 語意：用買入範圍
- 撲克室沒有「每注限額」。`limits.real/practice = {min: 400, max: 1000}`（買入範圍），好讓 `checkBroke()` 以「餘額 < RM 400 = 無法再買入」判斷。
- 副作用：真實模式 modebar 與進場 modal 顯示「限注 RM 400 – 1,000」。建議核心支援 `def.limitsLabel`（例如「買入 RM 400 – 1,000 · 盲注 RM 5/10」）。

## CR-4 不用 `ctx.bettingWindow`
- 撲克的倒數是「每次輪到你行動 30 秒」，不是下注時段。真實模式用 `LG.ui.countdown(30)`，逾時自動過牌（可過時）或棄牌；荷官口令 `輪到你 / Your action`。`def.countdown = 30` 只用於進場說明。
- 練習/教學：一手結束後顯示自己的「發牌 Deal」按鈕（`[data-action="deal"]`，e2e `h.deal()` 可用）；結果面板另有「下一手 Next hand」。真實模式每手結束 `ctx.nextRound()` 3 秒後自動下一手（暫停鈕有效）。

## CR-5 金額與抽水取整
- 全部以整數 RM 計（盲注 5/10、買入整數、加注滑桿步進 1）。
- 抽水 = min(⌊底池 × 5%⌋, RM 50)，向下取整到 RM 1（現場以最小籌碼單位抽）；規格案例 RM 200 → RM 10、RM 2,000 → RM 50 不受影響。抽水先從主池扣。
- 「奇數籌碼」= 平分後除不盡的 RM 1，依「按鈕左側第一位起、順時針」逐枚分給贏家。
- 未被跟注的下注先退回（不算底池、不抽水）。

## CR-6 其他實作決定
- 按鈕規則採「移動按鈕」：每手移到下一個有籌碼的座位；兩人時按鈕 = 小盲、翻牌前先動、翻牌後後動。
- 不足額 all-in 加注不重新開放加注（已行動者只能跟或棄）；面對所有人都已全下時，「全下」自動變成跟注。
- 攤牌時所有未棄牌者都亮牌（不做 muck）。AI 籌碼輸光 → 換一位新 AI 入座（隨機買入 RM 400–1,000、隨機性格）。
- AI：起手牌範圍以 Chen 公式排序的 169 種起手牌百分位（TAG 前 20%、LAG 前 40%、Station 前 50%）；翻牌後用 `LG.poker.equity(hole, board, nOpp, 300)` + 底池賠率 + 性格偏移（bias / margin / 下注比例 / 詐唬率），10% 機率對勝率加 ±15% 雜訊。反應時間 0.6–1.8 秒（`ctx.wait`，乘 `LG.speed`），練習與真實模式皆有。
- 練習提示：`LG.poker.equity(..., 1000)` 勝率、底池賠率（x:1 與需要勝率）、建議動作 + 一句理由；提示面板（`ctx.strategyPanel`）放起手牌表。
- 教學模式第一手固定發你 A♠ K♠、公共牌 K♥ 7♦ 2♣ 9♠ 4♥（`startHand({preset})`），之後隨機。
- 教學工作表會蓋住動作列：需要操作的步驟在 `setup` 把該區塊捲到畫面中間。
- 純邏輯在 `LG.games['poker-room'].logic`（`Table`、`buildPots`、`rakeFor`、`awardPots`、`aiDecide`、`advise`、`explainHand`…），單元測試直接用。
