# three-card-poker — 變更請求與實作假設

沒有需要改核心 API 的項目。以下是規格沒寫明、由我決定的地方。

## CR-1 規則假設
- **Ante Bonus 需要跟注 Play 才領**（棄牌不領；標準規則）。有 Play 時「不論莊牌、不論輸贏」都付：順 1:1、三條 4:1、同花順 5:1（以 Ante 金額計）。
  結算行 `spot:'anteBonus'` 的 `stake` 記 0（不是另一注），只把彩金加進拿回金額。
- **Pair Plus 棄牌仍結算**（規格：「Fold 輸 Ante 與 Pair Plus 仍結算」）。
- 只押 Pair Plus：不進入決策，直接翻莊牌（展示用）並結算 Pair Plus。
- 各格限額：Ante、Pair Plus 各自 RM 25–500（真實）；Play 由遊戲自動放（`bets.set`，= Ante）。

## 備註
- 單元測試：Pair Plus 以 22,100 種組合精確列舉 = 2.32%（一般測試）；[slow] Monte Carlo：Pair Plus 2,000 萬手、Ante/Play（Q-6-4）500 萬手，以 52³ 查表加速，約 2 秒。
- No more bets 後停 500ms 再喊「發牌 Dealing」（讓停止下注口令看得到）。
- 真實模式決策 30 秒用 `LG.ui.countdown`；逾時 = 棄牌。
