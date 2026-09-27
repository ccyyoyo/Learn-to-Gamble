# 核心 A：與合約（02-architecture.md）的差異與擴充

所有合約簽名皆已實作；以下為「語意補充」與「新增的擴充 API」。遊戲代理可放心使用擴充 API（示範見 `src/games/_demo.js`）。

## CR-A1 金流約定（語意補充，所有遊戲必須一致）
- 下注階段**不扣款**：籌碼只放在 `LG.Bets` 上；可用餘額 = `bank.balance() − bets.total()`（betLayer 以此判斷「籌碼不足」並灰掉籌碼）。
- `bettingWindow` 的 `onClose` 之後（No more bets）由遊戲 `ctx.bank.debit(bets.total())`；結算 `ctx.bank.credit(拿回金額含本金)`。
- 局中卸載（切模式/離開）：遊戲在 `unmount()` 退回已扣未結算的注金（見 `_demo.js`）。
- 局中加注（Double / Play / Raise）：`bets.set(spot, amt)`（不檢查限額與鎖定）+ `bank.debit(追加額)`。

## CR-A2 `LG.Bets` 限額語意
- `min`/`max` = 整桌**總注**下限/上限；`perSpotMin`/`perSpotMax` 省略時**沿用 min/max**；`spotRules[spot]` 覆寫個別格（可含 `label`）。
  - 有旁注、總注可超過主注上限的遊戲請明確傳 `max`（例如 `max: Infinity, perSpotMax: 5000`）。
- `place` 失敗 reason 另有 `'LOCKED'`、`'BAD_AMOUNT'`、`'ABOVE_TABLE_MAX'`；回傳帶 `zh` 說明。
- `validate()` 無下注時回 `{ok:false, errors:[{spot:null, reason:'EMPTY'}]}`。
- `clear()` 不管鎖定（結算後由遊戲呼叫）；`lock()` 時記下 `bets.last`（重複上注用，betLayer 另存 `store.lastBets[gameId]`）。
- 擴充：`set(spot, amt)`、`subscribe(fn) → off`、`limitFor(spot)`、`labelOf(spot)`、`labels` 選項。

## CR-A3 `LG.ui.betLayer` / `LG.ui.betBar`
- betLayer 擴充選項：`gameId`（持久化上一注）、`canPlace(spotId, amount) → true | '提示字串' | false`。
- 回傳另有 `clear()`、`rebet()`、`available()`。
- 格子加 `.is-disabled` 或 `data-bet-disabled` 即不可下注（toast `data-disabled-msg`）。
- 新增 `LG.ui.betBar(container, {bets, layer})`：[清除 Clear] [重複上注 Rebet] 總注 RM x。
- 長按移除時間 500ms 不隨 `LG.speed` 縮短（輸入時間，不是動畫）。

## CR-A4 `ctx` 擴充（§4.1 之外）
| 名稱 | 說明 |
|---|---|
| `ctx.nextRound(fn)` | 真實：3 秒後自動呼叫（暫停/破產時延後到恢復/重置）；練習/教學：立即呼叫。**每局結束都呼叫**，不要因 `checkBroke()` 為 true 就略過 |
| `ctx.wait(ms)` | Promise，`LG.ms(ms)` 後 resolve；卸載後永不 resolve（async 流程自然停止） |
| `ctx.later(fn, ms)` | setTimeout(LG.ms)，卸載自動清除 |
| `ctx.on(name, fn)` | LG.events.on，卸載自動解除（例：`ctx.on('hints:change', paint)`） |
| `ctx.alive()` | instance 是否仍掛載 |
| `ctx.ready` | Promise；真實模式進場 modal 按「開始」後 resolve |
| `ctx.root` / `ctx.variantDef` / `ctx.limitsText` | 遊戲 section、目前變體 def、'RM 50 – 5,000' |

- `bettingWindow({seconds, onClose, bets?, label?, validate?, onTick?})` → `{cancel(), close(), isOpen()}`。
  - `seconds` 預設 `def.countdown ?? 15`；傳 `bets` 時：練習按「發牌」前先 `bets.validate()`，關閉時自動 `bets.lock()`。
  - `onClose({auto, ok, validation})`：真實模式倒數結束可能 `ok:false`（沒下注/不合法）→ 遊戲 `bets.unlock()` 並 `ctx.nextRound(startRound)`。
  - 「發牌」按鈕放在遊戲 root 內 `[data-deal-slot]`，沒有就放 `.lg-actions`，再沒有就放桌面下方。
- `explain({hand, result, formula, why, net?, title?, actions?})`：`net` 省略時用最近一次 `recordRound` 的 net。
- `onModeChange(mode)` / `onVariantChange(id)`：切換模式與變體**一律重新 create**；這兩個 hook 只在 mount 後各呼叫一次（可省略）。
- 真實模式切換變體視為同一 session（不結算摘要、不再跳進場 modal）。

## CR-A5 def 擴充欄位
- `countdown`：真實模式倒數秒數（預設 15；進場說明與 bettingWindow 預設值）。
- `houseEdge[i].approx: true`：顯示「≈」（三公模擬值用）。
- `demo: true`（首頁標「示範」）、`logic: {...}`（純函式，供單元測試 `LG.games[id].logic` 取用）。
- 新增 `LG.gameList(category?)`、`LG.bestEdge(def)`、`LG.limitsFor(def, mode, variantId)`（variant.limits 覆寫 def.limits）。

## CR-A6 `LG.ui` 補充
- `LG.money.fmt(-50)` → `'−RM 50'`（U+2212 減號）；新增 `fmtSigned(n)` → `'+RM 95'`、`sum(arr)`。
- `LG.ui.el` 的 tag 可寫 `'div.a.b'`；新增 `term(zh, en)`、`esc(s)`、`setCard(el, card)`、`cardOf(el)`、`SUIT`、`chipColor(d)`、`clearOverlays()`。
- `flip(el, card?)` 回傳 Promise：蓋著→翻開；已翻開且給新牌→換牌；已翻開沒給牌→蓋回。
- `squeezeable` 回傳 `{reveal(), progress(), destroy()}`；另可按住不放自動揭露、Enter 直接翻開。
- `resultPanel` 另收 `net`（標題右側顯示並上色）、`tone`、`onClose`；預設動作「再來一局」只關閉面板。
- `payoutFlash` 每次呼叫 `LG.ui.flashCount++`、`LG.ui.lastFlash={net}`（e2e `h.waitFlash()` 用）。
- `highlight(sels, {scope})`：預設範圍 `.lg-stage`（含荷官橫幅、倒數與遊戲 section）；範圍外元素只加金框不變暗。
- `table(data)` 也接受二維陣列（第一列表頭）。`actionBar` 另有 `add(items)`、`button(id)`。
- `modal({..., dismissable, onClose, className})`；`confirm(text, {title, okLabel, cancelLabel, danger})`。
- `dealer.clear()`。`countdown` 同時只有一個（新的取消舊的）。

## CR-A7 `LG.slotView` 補充
- `create` 選項 `spinMs`（預設 700）、`stepMs`（預設 150）；方法另有 `setGrid(grid)`、`grid()`、`cell(r,row)`、`showLine(rowsPerReel)`、`unlock(cells?)`、`isLocked(cell)`、`reset()`、`setStrips()`、`destroy()`。
- `lock(cells)` 為**累加**；`lock(null)` / `unlock()` 解除全部。鎖定格在 spin 時不轉、保留原符號。
- cell 可寫 `[reel,row]` 或 `{reel,row}`。`spin(null)` 只轉不改符號（測試用）。
- `betPanel` 選項 `lines` 可為數字或選項陣列（1 → 隱藏線數）、`lineBet`、`linesLabel`、`lineBetLabel`；方法另有 `set({lines,lineBet})`、`setEnabled(b)`、`isMax()`。

## CR-A8 其他
- `LG.store`：`peek()`（核心內部快速讀取，勿修改）、`load()`、`persistent`、`migrate()`、`defaults()`、`START_BANK`。
- `LG.stats.session.markBroke()`、`LG.progress.get(gameId)`；事件另有 `'stats:change'`、`'hints:change'`。
- 教學：「下一步」鎖住時用 `aria-disabled`（仍可點，點了顯示提示）；e2e 需 `click(..., {force:true})`。前進（通過）時才 `markStep`。
- `LG.tutorial.lint(steps)` → `{ok, problems}`，遊戲單元測試可直接檢查教學規範（見 `tests/unit/core-demo.test.mjs`）。
- e2e：`tests/e2e/<id>.mjs` 匯出 `default async function (t)`，用 `t.test(name, async (page, h) => …)`；每個 test 新 context、乾淨 localStorage、有 console error 即失敗。
