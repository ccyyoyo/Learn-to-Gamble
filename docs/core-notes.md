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

## 框架與 UI（核心 A）— 詳見 docs/change-requests/core-a.md
- **扣款時機（所有遊戲一致）**：下注階段不扣款；`No more bets` 後遊戲自己 `bank.debit(bets.total())`；結算 `bank.credit(拿回金額含本金)`；局中離開在 `unmount` 退回已扣注金。
- **一局標準流程**（參考 `src/games/sicbo.js`）：`ctx.bettingWindow({bets, onClose})` → `onClose` 若 `!ok`：`bets.unlock(); ctx.nextRound(startRound)`；若 `ok`：debit → 發牌 → credit → `ctx.recordRound` → `ctx.explain` → `bets.unlock(); bets.clear()` → `ctx.checkBroke()` → `ctx.nextRound(startRound)`。每局都要呼叫 `nextRound`（破產也要）。
- **下注 UI 三件組**：`ui.chipTray(容器,{denoms:ctx.denoms})`、`ui.betLayer(桌面,{bets, chipTray, gameId:ctx.gameId})`、`ui.betBar(容器,{bets, layer})`；在 `.lg-actions` 加 `data-deal-slot` 讓「發牌」按鈕放進去。
- `Bets` 的 `min/max` 是整桌總注上下限；`perSpotMin/perSpotMax` 未給時沿用；有旁注的遊戲要把 `max` 設大並用 `spotRules` 設每格限額。
- 切模式/變體一律重新 `create`；`onModeChange/onVariantChange` 只在 mount 後各呼叫一次。
- 非同步：`await ctx.wait(ms)`（已乘 LG.speed），每段 await 後 `if (!ctx.alive()) return`；事件 `ctx.on('hints:change', fn)` 卸載自動清除。新增 ctx：`nextRound, wait, later, on, alive, ready`；def 可加 `countdown`（真實模式秒數）、`houseEdge[].approx`。
- 下注格：`<div class="lg-spot" data-bet="id">` 內放 `.lg-spot__zh/.lg-spot__en/.lg-spot__odds`。教學 `action.check` 回傳 `true` 或提示字串；單元測試用 `LG.tutorial.lint(steps)` 檢查步數/四段/action 數。
- `money.fmt(-50)` → `'−RM 50'`；另有 `fmtSigned`。
- e2e：`export default async (t) => t.test('名稱', async (page, h) => { await h.openGame(page, id, 'practice'); await h.placeChip(page, spot, 25); await h.deal(page); await h.waitResult(page); })`；真實模式 `h.startReal(page)` → `h.waitCountdown(page)` / `h.waitFlash(page)`；教學鎖住的「下一步」用 `aria-disabled`，Playwright 需 `force:true`。
