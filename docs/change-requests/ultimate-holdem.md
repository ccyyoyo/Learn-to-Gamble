# ultimate-holdem — 變更請求與實作假設（遊戲代理 G6）

## CR-1 規格 §4 河牌 1× 規則：「公共牌無對且 outs < 21」會讓優勢約 6%
- 需要：把 §4 河牌規則改為「用到手牌的一對以上 → 1×；否則莊家 outs < 21 → 1×；否則 Fold」（拿掉「公共牌無對」）。
- 原因：照原文實作，公共牌有對（約一半的河牌局面）時一律棄牌，Monte Carlo 優勢約 6.2%、棄牌率 25.6%，驗收（1.5%–3%）不過。
  去掉這個條件（即 Wizard of Odds 的簡化策略）→ 棄牌約 18%、優勢約 2.4%（100 萬情境、seed 20260927：2.43% ± 0.22%）。
- 實作：`logic.riverAdvice`；outs = 剩餘 45 張中「單張配 5 張公共牌就嚴格贏過你」的張數（平手不算）。
  「用到手牌」= 7 張牌型類別高於公共牌 5 張的類別（順子以上則比分數）。

## CR-2 Trips 優勢數字與賠付表不一致
- 規格賠付表 Trips：皇家 50、同花順 40、四條 30、葫蘆 8、同花 7、順 4、三條 3，但標「1.90%」。
- 以 7 張牌型精確機率計算，這張表的優勢是 **3.50%**；1.90% 對應的是 50/40/30/**8/6/5**/3。
- 實作：不改賠付表（規格數字），`houseEdge` 的 Trips 標 3.5（00-common「Trips 1.9%–3.5% 依賠付表」範圍內），教學也寫 3.50%。
  `[slow]` 測試同時驗證精確值 3.50% 與 Monte Carlo。請協調者決定要改表還是保留。

## CR-3 資金預留
- 假設：放 Ante / Trips 時與發牌前檢查「餘額 ≥ 3 × Ante + Trips」（Ante + Blind + 至少 1× Play），確保河牌能 1×。
  3× / 4× / 2× / 1× 付不起時按鈕停用（按鈕上顯示金額）。
- 例外：餘額連「3 × 最低注 + Trips」都不夠時不擋、只提醒「這局河牌只能棄牌」（仍需付得起 Ante + Blind = 2 × Ante）。

## CR-4 `ctx.checkBroke()` 門檻需要可自訂
- 需要：`ctx.checkBroke({min})` 或 def 欄位（例如 `minStake: 2 × limits.min`）。
- 原因：UTH 每局最少要 Ante + Blind = 2 × 最低注（真實模式 RM 50）。餘額 RM 25–49 時 `checkBroke()` 不觸發（門檻 = 最低注 RM 25），
  但玩家下不了任何合法注，只能看倒數空轉。
- 暫時做法：無（玩家可離開或重置籌碼；練習模式最低注 RM 10 影響較小）。

## 實作備註（不需核心變更）
- 中文名稱規格沒寫，用「終極德州撲克 Ultimate Texas Hold'em」。
- Blind：格子 `data-bet-disabled`（點了 toast「Blind 自動跟 Ante 同額」），`bets.subscribe` 在未鎖定時把 blind 設成與 ante 相同；加注 `play` 在鎖定後 `bets.set`。
- 狀態機 `logic.createFlow()`：preflop [check, raise3, raise4] → flop [check, raise2] → river [fold, raise1]；raise 或 fold 後 stage = showdown（跳過剩下的決策）。非法動作丟 `ILLEGAL:<stage>:<action>`。
- 轉牌與河牌一起翻（UTH 標準）。
- 真實模式每階段 30 秒 `ui.countdown`，逾時：翻牌前/翻牌後 Check、河牌 Fold（規格 §6）。
- 翻牌後 2×：規格寫「用到手牌的一對」，所以口袋 2-2 也算（Wizard 版本排除 2-2，差異 < 0.01%）。
- Monte Carlo（`logic.simulate`）用三個不改變期望值的變異數縮減：每情境抽 4 組莊家牌、依玩家 7 張最終牌型以精確機率分層、Blind 皇家 500:1 以精確機率加回（否則單一事件標準差約 2.8 單位，20 萬手的誤差 ±0.9% 無法驗 1.5–3%）。100 萬情境約 12 秒，標準誤約 0.22%。
- 教學 26 步：strategy 段含 3 題測驗（按鈕在步驟內容裡，遊戲在 mount 時於 document 掛點擊委派、unmount 移除；`action.check` 讀 `instance.state.quiz`）。
