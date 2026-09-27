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
- **three-pictures**：規格原本的比牌規則對玩家有利（+10.5%）。決議採用「B 方案」：比點數 → 比公數 → 完全同則莊贏（**取消最高單張比較**），賠付只對玩家勝出加倍（三公 3:1、9 點 2:1），莊勝一律收 1 倍（`bankerMultiplier=false`），優勢約 4.17%。請整合代理切換並更新 `docs/05-game-rules/three-pictures.md` 與 `00-common.md`（≈4.2%，approx）。
- **fantan 三門**：採 1:3 賠付（優勢 1.25%）；更新規格書與 00-common。
- **sicbo**：以 `sicbo.md` 為準（圍骰 180:1 = 16.20%；總點 9/12 = 18.98%）；更新 00-common 的備註數字。
- **caribbean-stud Progressive**：houseEdge 保留 Progressive 一列（approx），規格書 §3 備註改為「獎池 RM 100,000 時優勢約 86%，需 RM 1.58M 才打平」。
- **baccarat CR-1/CR-2**：接受（免佣桌提示照實說明閒 1.24% < 莊 1.46%；旁注顯示實際優勢）。CR-3（變體別 houseEdge）由整合代理在核心加 `variants[i].houseEdge` 支援並讓首頁/卡片顯示目前變體。
- **核心共通 CR**：真實模式進場 modal 在 `countdown: 0` 時顯示「不倒數」（video-poker、slot-* 的 DOM 改寫可移除）；`checkBroke(minNeeded)` 支援；`ui.actionBar().set()` 不得重設 className（保留教學高亮）；`.lg-spot--hl` 不設 position（roulette 覆寫可移除）；`bettingWindow` 加 `closeAt`。
