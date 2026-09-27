# 核心使用提示（給遊戲代理）

## 函式庫（核心 B）
- `LG.baccarat.settle(bets, coup, variant)`：`bets` 可傳 `LG.Bets` 實例、`{spot: amt}`、`[[spot, amt]]` 或 Map。回傳
  `{payouts:{banker:195}, net:95, wagered:100, returned:195, lines:[{spot, name:{zh,en}, stake, result:'win'|'lose'|'push', odds, pay, returned, formula:'RM 100 × 0.95 = RM 95', why:'…'}]}`。
  `payouts` 是含本金拿回金額（可直接 `bank.credit`）；`line.formula`/`line.why` 可直接餵 `ctx.explain`。
- 教學擺牌：`shoe.stack('8S 2H KD 3C')` 後 `dealCoup(shoe)`（順序閒、莊、閒、莊）；或 `LG.baccarat.resolveCoup(閒牌, 莊牌, shoe)`。
- 21 點：`basicStrategy(cards, dealerUp, {canDouble, canSplit})`，dealerUp 可傳牌物件、`'A'` 或數字；`lookup()` 回傳表名/列/欄供「為什麼」；分 A 後 `value(cards, {fromSplit:true})`。
- 撲克：`score`/`compare` 直接比；`best(7).best5` 亮牌；`equity(hole, board, nOpp, iters)` 300 次約 0.7ms（AI 用 300、提示用 1000–2000）；Three Card Poker 用 `eval3(h).score >= eval3(parseMany('QS 6H 4D')).score` 判 Q-6-4。
- 牌九：`houseWay()` 回傳附 `rule` 與 `why`，教學可直接顯示套用的規則。
- 老虎機：`simulateRTP({strips, evaluate: grid => 總贏(以總注為單位), bet:1}, 500000).rtp` 為比例（0.94）；`config.spin` 可自訂盤面產生（Hold & Spin）。
- 慢測試：測試名稱含 `[slow]`，`npm test` 略過、`npm run test:slow` 執行。
