# Change requests / 實作備註：video-poker（視訊撲克 Jacks or Better 9/6）

## CR-VP1 真實模式不倒數 → 進場 modal 文字（請核心 A 處理）
- 視訊撲克是玩家自己按 DEAL，**不用 `ctx.bettingWindow`、不倒數**（派工特別要求）。`def.countdown = 0`。
- `32-modes.js` 真實模式進場 modal 固定寫「倒數 **${def.countdown ?? 15} 秒**」，會顯示「倒數 0 秒」。
- 目前繞過：遊戲 mount 後 `ctx.later(…, 0)` 把該段文字改成「**不倒數**（自己按 DEAL 發牌）」。
- 建議：核心在 `def.countdown === 0`（或新增 `def.noCountdown`）時改寫進場說明，遊戲就能拿掉這段 DOM 改寫。

## CR-VP2 沒有下注格 `data-bet`
- 視訊撲克沒有籌碼盤與下注格（def 省略 `denoms`；分類 `slots` 不會補預設籌碼）。下注用 BET ONE / MAX BET（1–5 枚）＋每枚金額按鈕（RM 0.20 / 0.50 / 1 / 2 / 5，`[data-coin]`）。
- 「每格 data-bet + 中文/英文/賠率」的 DoD 項目改由賠付表滿足：每列 `tr[data-hand="royal|sf|quads|fh|flush|straight|trips|twopair|jacks"]`，含中文、英文與 1–5 枚賠付；目前枚數欄 `.is-col`、中獎列 `.is-win`。

## CR-VP3 限注
- `limits.real = limits.practice = {min: 0.2, max: 25}`（每枚 RM 0.20–5 × 1–5 枚）。練習模式沿用同一組，否則通用的「練習最低 RM 10」會讓 `checkBroke()` 在餘額 < RM 10 時就提示。
- 扣款：按 DEAL（或 MAX BET）時 `bank.debit(枚數 × 每枚)`；DRAW 結算 `bank.credit(贏的枚數 × 每枚)`（含本金的拿回金額）。每手 `ctx.recordRound` + `ctx.checkBroke()`；一對 J 以上（淨 0）記為 `push`。
- 沒呼叫 `ctx.nextRound`：視訊撲克沒有自動下一局，結算後直接回到可按 DEAL 的狀態；破產覆蓋層由 `checkBroke()` 顯示，重置後即可再玩。
- 局中離開（已 DEAL 未 DRAW）：依平台約定 `unmount` 退回押注。註：真實機台會保留這手；若要防「看牌不好就離開」，可改成離開時自動以目前 HOLD 換牌結算（需要框架允許卸載中 `recordRound`）。

## CR-VP4 教學模式不動用餘額
- 教學的 DEAL/DRAW 不扣款、不派彩（結果面板照常顯示並註明「教學模式不扣款」），流程示範用固定牌（J♥ J♦ 7♣ 4♠ 9♠，換牌 J♣ 2♥ 5♦ → 三條 J）。

## 實作備註：策略規則的解讀（規格 §4）
- 第 3 條「葫蘆、同花、順、三條 → 全留」：三條只留三張（換 2 張拚四條/葫蘆）；全留 5 張會讓 RTP 明顯下降，與「最佳策略」本意不符。
- 第 10 條「四張兩頭順聽」：4 張連續且兩端都能接（不含 A-2-3-4、J-Q-K-A）。
- 第 11 條多組同花高牌時，留「最高張較低」的一組（J♠Q♠ 優先於 A♥K♥）。第 12 條多組時留高牌較多者。
- 第 13 條：兩張以上高牌（且不同花）留最低的兩張。
- `suggestHold(cards)` → `{hold:[index], rule, n, short, en, why}`；`classifyHold`、`evHold`（精確期望值，換 ≤ 4 張）供結果面板「你留的 vs 建議留的」比較。都在 `LG.games['video-poker'].logic`。
- 此 15 條簡化策略 RTP 約 **99.40%**（100 萬手分層估計 99.41%；最佳策略 99.54%）。單元測試 `[slow]` 用 20 萬手＋變異數縮減（依發牌牌型分層、少量換牌精確列舉、皇家以精確機率計），標準誤約 0.1%。
