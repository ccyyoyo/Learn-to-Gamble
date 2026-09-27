# 變更請求
遊戲代理需要核心 API 變動或發現規格矛盾時，在此建立 `<game-id>.md`，格式：
```
## CR-1 標題
- 需要：LG.ui.xxx 新增參數 …
- 原因：…
- 暫時做法：…（我在自己的檔案內怎麼繞過）
```
協調者於 Wave 3 統一處理。

## 協調者決議（供 Wave 3 整合代理執行）
- **three-pictures**：規格原本的比牌規則對玩家有利（+10.5%）。決議採用「B 方案」：比點數 → 比公數 → 完全同則莊贏（**取消最高單張比較**）；玩家勝出三公 3:1、9 點 2:1、其他 1:1；**莊贏按莊家牌型收（莊 9 點輸 2 倍、莊三公輸 3 倍、其他 1 倍；`bankerMultiplier=true`）**，優勢 4.17%（精確枚舉；Monte Carlo 100 萬局 4.16%）。規格書與 `00-common.md` 寫 ≈4.2%（approx）。
  - 更正（Wave 3 整合）：原決議文字寫「莊勝一律收 1 倍（`bankerMultiplier=false`）」與 4.17% 互相矛盾——同一比牌規則下莊勝只收 1 倍時玩家反有 +7.42% 優勢（CR-1 枚舉表）。依枚舉結果以 `true` 為準，已與程式、規格一致。
- **fantan 三門**：採 1:3 賠付（優勢 1.25%）；更新規格書與 00-common。
- **sicbo**：以 `sicbo.md` 為準（圍骰 180:1 = 16.20%；總點 9/12 = 18.98%）；更新 00-common 的備註數字。
- **caribbean-stud Progressive**：houseEdge 保留 Progressive 一列（approx），規格書 §3 備註改為「獎池 RM 100,000 時優勢約 86%，需 RM 1.58M 才打平」。
- **baccarat CR-1/CR-2**：接受（免佣桌提示照實說明閒 1.24% < 莊 1.46%；旁注顯示實際優勢）。CR-3（變體別 houseEdge）由整合代理在核心加 `variants[i].houseEdge` 支援並讓首頁/卡片顯示目前變體。
- **核心共通 CR**：真實模式進場 modal 在 `countdown: 0` 時顯示「不倒數」（video-poker、slot-* 的 DOM 改寫可移除）；`checkBroke(minNeeded)` 支援；`ui.actionBar().set()` 不得重設 className（保留教學高亮）；`.lg-spot--hl` 不設 position（roulette 覆寫可移除）；`bettingWindow` 加 `closeAt`。
- **slot-holdspin CR-2（追認，接受）**：MINOR = 總注 × 50；MAJOR / GRAND 以總注 RM 2 為基準等比換算（總注 RM 2 時種子 RM 500 / RM 5,000），任何注額 RTP 皆 94.5%，且 MINOR < MAJOR < GRAND 永遠成立。已寫入 `slot-holdspin.md` §4。
- **slot-progressive CR-2（追認，接受）**：非最大注時 GRAND 格變 MAJOR，且輪盤獎金 = 獎池 × (總注 ÷ RM 100)；最大注 RTP 92.19%、非最大注 86.64%。已寫入 `slot-progressive.md` §2。
- **教學沙盒（Wave 3，I2 審查高項）**：教學模式的 `ctx.bank` / `LG.bank` 改用記憶體示範籌碼 RM 1,000（`LG.bank.sandbox()`），不寫 store、不動真實餘額；離開教學自動還原。解決「真實餘額不足時教學卡住」與「21 點教學局可重複賺 RM 100」。
- **roulette CR-R4（追認）**：37 個號碼格顯示「號碼 + 35:1」，108 個格線熱區以 `title` / `aria-label` 帶中英文與賠率，桌面上方一行圖例說明所有內注；手機寬度放不下每格中英文。
