# slot-video 變更請求與實作備註（遊戲代理 G8）

## CR-1 真實模式進場 modal 寫「倒數 N 秒」，老虎機沒有倒數
- 同 slot-classic CR-1。暫時做法：mount 後改寫 modal 第一段為「每轉 RM 2.00 – RM 100.00（固定 20 線），沒有倒數，按 SPIN 就轉」。

## CR-2 老虎機不適用 bettingWindow / nextRound
- 下注用 `LG.slotView.betPanel`：每線注 `[0.1,0.2,0.5,1,2,5]`；線數練習/教學 `[1,5,10,20]`、真實固定 `[20]`（面板自動隱藏線數）。def 省略 `denoms`。
- 每次付費轉：`bank.debit(總注)` → 轉 → `bank.credit(贏分)` → `ctx.recordRound({wagered: 總注, net})`；
  免費轉每轉 `bank.credit(贏分)` + `ctx.recordRound({wagered: 0, net: 贏分})`；全部轉完才 `ctx.explain`（net = 整串總贏 − 總注）與 `ctx.checkBroke()`。
- 真實模式 `ctx.ready` 前 SPIN 停用；不倒數、不呼叫 `ctx.nextRound`。餘額不足 → SPIN 停用 + toast。
- unmount 時退回已扣未結算的總注；進行中的免費轉剩餘次數作廢（已派的贏分保留）。

## 規格解讀 / 假設
- **Wild 只在軸 2–4**（規格「可選」，派工訊息指定採用）。因此軸 1、5 沒有龍，「5 連龍 1000×」保留在賠付表物件與說明中，但實際不可能出現；Pay Table 已註明。`exactRTP()` 以「軸 1 沒有 Wild」為前提。
- **Scatter 即時獎**：規格只在 3 個時寫「總注 ×2 即時獎」。實作為**任何觸發（3/4/5 個）都即時贏總注 ×2**，4/5 個的差別只在免費轉次數（15/20）。若要 4/5 個給更高即時獎，需改 `SCATTER_MULT` 為表並重調 strips。
- 免費轉沿用觸發時的線數與每線注、同一組轉軸帶、無倍數；免費轉中觸發同樣 +次數 + 即時獎。
- 限注：真實 `{min: 2, max: 100}`（20 線 × RM 0.10–5）；練習 `{min: 0.10, max: 100}`（可選 1 線）。
- `slotView.create` 的 `symbols[k].svg` 用來放 HTML 符號磚（龍/金幣附 WILD/SCATTER 小字）。

## 轉軸帶與 RTP（目標 94% ± 0.5%，含免費轉期望）
組成（每軸）：財神 2、元寶 2、紅包 3、鯉魚 3、A 3、K 3、Q 4、J 4、10 4、9 4（軸 3 的 10 為 3；軸 5 的 9 為 3）

| 軸 | 停點 | Wild | Scatter | 序列 |
|---|---|---|---|---|
| 1 | 34 | 0 | 2 | `CS KO GI A Q SC K J RP T T KO Q N A J N CS K GI RP Q SC KO J T A T N K Q RP J N` |
| 2 | 38 | 5 | 1 | `SC T A CS Q K GI J T RP N N KO Q W A J W K T W RP CS Q KO GI J T A N N K Q W RP J W KO` |
| 3 | 37 | 5 | 1 | `SC J CS A N GI K Q RP T J KO N W A Q W K J W T CS RP Q GI KO J A N N K W W RP T Q KO` |
| 4 | 38 | 5 | 1 | 軸 2 反序 |
| 5 | 33 | 0 | 2 | `CS KO GI A J SC K Q RP N J KO T T A Q CS K J GI RP N SC KO Q A J T K T RP N Q` |

- 精確解析（`logic.exactRTP()`）：單線期望 79.20%（每線注），金幣即時獎 2.54%，單轉 V = 81.74%；
  觸發率 q = 1/78.6，平均給 m = 10.29 次；RTP = V / (1 − q·m) = **94.047%**（免費轉貢獻 12.31%）。
- `LG.slots.simulateRTP`（evaluate 內含整串免費轉）：seed 123、500,000 轉 = **93.884%**，命中率 45.4%（單元測試 `[slow]`）。每轉標準差約 2.7 倍總注，500k 標準誤約 0.38%。
- e2e：`LG.rng.seed(1)` 後第一轉必觸發 3 金幣（單元測試也驗證）。

## e2e 規範差異
- 07-test-plan「真實模式出現倒數與口令」不適用老虎機；改驗「沒有倒數、按開始前 SPIN 停用、只閃金額、餘額正確」。
