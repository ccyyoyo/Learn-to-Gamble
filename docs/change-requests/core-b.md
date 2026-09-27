# 核心代理 B（libs：src/core/10–16）— 變更請求與實作備註

## CR-1 `npm test` 沒有排除 `[slow]` 測試（package.json，核心 A 擁有）
- 現況：`--test-name-pattern='^(?!.*\[slow\]).*$'` 在 Node 22 **不會排除**任何測試（負向前瞻比對到每個檔案的根測試，子測試就全部照跑）。
- 需要：把 `test` script 改成 `node --test --test-skip-pattern='\[slow\]' 'tests/unit/**/*.test.mjs'`（Node ≥ 22.1 支援，已在本機 v22.22 驗證有效）。
- 暫時做法：`lib-baccarat` / `lib-paigow` 的 `[slow]` 測試另加 `{skip}` 選項：`process.env.npm_lifecycle_event === 'test'`（即 `npm test`）時略過；`npm run test:slow`、直接 `node --test` 或 `SLOW=1 npm test` 時執行。遊戲代理若也寫 `[slow]` 測試，可照抄這一行。

## 實作備註（沒有破壞合約；以下是新增或補充說明）

### LG.cards
- 新增 `Shoe.stack(cards|'AS KH')`：指定之後依序抽出的牌（教學 setup、測試用），不影響牌靴本體。
- 新增 `make(rank,suit)`、`isJoker(c)`、`RANK_VALUE`。`rankValue(joker)` 回傳 0。
- `draw()` 在牌用完時自動重洗、不丟錯；遊戲仍應在局與局之間檢查 `needsShuffle()`。
- `LG.rng` 防禦：`core:'libs'` 只載入 00 + 10–16，所以 10-cards.js 在 `LG.rng` 不存在時放一份相同語意的 mulberry32 實作；正式建置由 01-rng.js 提供（兩者 seed 序列相同）。

### LG.baccarat
- `settle(bets, coup, variant)` 的 `bets` 接受 `LG.Bets` 實例（`entries()`）、`{spot:amt}`、`[[spot,amt]]` 或 `Map`；未知 spotId 丟 `Error('UNKNOWN_SPOT:x')`。
- 回傳另含 `wagered`、`returned`；每條 line 另含 `name{zh,en}`、`odds`、`returned`、`why`（繁中理由）。`pay` = 該注淨輸贏（贏 +、push 0、輸 −本金）。
- `formula`：贏 `RM 100 × 0.95 = RM 95`；push `RM 100 退回（push）= RM 0`；輸 `RM 100 輸 = −RM 100`。
- 新增 `resolveCoup(player, banker, drawFnOrShoe)`（由指定牌完成一局，教學用）、`burnStart(shoe)`、`judge(spot, coup, variant)`、`SPOTS`。
- `bankerDraws` 的第二參數也接受點數（number）。
- 變體 `squeeze` 結算同 `classic`。Tiger Pair「雙邊同 rank（Twin）」以兩邊對子 rank 相同判定（不看花色）。
- 規則表測試為莊 0–7 × 閒第三張 0–9 共 80 格（涵蓋 WBS 所稱 70 格）。

### LG.blackjack
- `value(cards, {fromSplit})`：`fromSplit:true` 時 A+10 不算 BJ（分 A 後）。
- `STRATEGY_TABLE`：`{dealer:['2'..'A'], hard:{4..21:[10]}, soft:{A2..A9:[10]}, pairs:{'22'..'99','TT','AA':[10]}, legend, rows, rules}`；代碼 `H/S/D/Ds/P`（`Ds` = 加倍否則停）。`rows` 為規格書的分組列（`17+`、`13–14`、`5–8`、`A,4–A,5` …）可直接渲染。
- `basicStrategy` 的 `dealerUp` 接受牌物件、`'A'/'T'/'7'/'KH'` 字串或數字 2–11；`canDouble` 預設「兩張」、`canSplit` 預設「兩張同點數」。額外支援 `s17:false`（H17 三格修正）與 `das:false`（22/33/44/66 修正），預設即規格表。
- 新增 `cardValue(card)`、`lookup(cards, up, opts)`（回傳查到的表/列/欄，給「為什麼」引用表格用）。

### LG.poker
- `score` 編碼：`cat × 16^5 + 5 個 rank nibble`，可直接比較；`ranks` 依重要性排列（葫蘆 `[K,K,K,7,7]`、輪子順 `[5,4,3,2,1]`，A 當 1）。
- `best(cards)` 接受 1–7 張（少於 5 張時只會是對子/高牌，方便翻牌前描述）；回傳 `cards` 與 `best5` 都是最佳 5 張。
- 新增 `score(cards)`（只回分數，最快）、`equityDetail()` → `{equity, win, tie, lose, iters}`、`outsDetail()` → `{count, cards}`。
- `eval3` 另回傳 `level`（0–5）與 `ranks`（一對 `[9,9,K]`；A-2-3 順 `[3,2,1]`）；`describe()` 同時接受 eval5/best/eval3 結果或牌陣列。
- 效能：`best(7)` 本機約 60 萬次/秒；`equity` 內部用由 `LG.rng` 取種子的 mulberry32（seed 後可重現），300 次 < 1 ms、2000 次 × 5 對手約 2 ms。

### LG.paigow
- `CATEGORY` = poker 的 CATEGORY + `FIVE_ACES: 10`。A-2-3-4-5 在順子與同花順都是第二大（僅次 T-J-Q-K-A / 皇家）。
- `eval2().score` 與 `eval5().score` 同一尺度，`isValidSplit` 直接比分數。
- `compare()` 回傳另含 `foul`；`high/low` 的 `0` = copy（算莊贏）。新增 `net(stake, result)`（win +95%、push 0、lose −本金）、`best(cards)`（5–7 張最佳 5 張，Fortune 旁注用）。
- `houseWay()` 回傳另含 `rule`（1–9）與 `why`（繁中規則說明），可直接給教學/提示用。
- 房規優先序（規格沒寫明，我的決定）：9 五條 A → 8 四條 → 7 葫蘆（含兩組三條）→ 6 順/同花（能同時放一對到低手 → 用它；否則若有兩對以上改用 3/4 條；否則保留順/同花、低手取最大兩張）→ 4 三對 → 3 兩對 → 5 三條 → 2 一對 → 1 無對。小丑分組時視為 A。
- 驗證：雙方都用房規 10 萬手，優勢 ≈ 2.3%、push ≈ 40.7%（規格 2–4%、38–44%）。

### LG.slots
- `evalLines` 的 wins 另含 `lineNo`（1 起）；`line` 為 0 起索引。`leftToRight:false` = 左右兩向都算、每線取高。
- `spin()` 回傳的 grid 附不可列舉的 `grid.stops`；新增 `gridAt(strips, stops, rows)`。
- `simulateRTP(config, spins)`：
  - evaluate 模式：`config.evaluate(grid)` 回傳該轉總贏（數字或 `{win}`，可在內部模擬免費轉/特色），`config.bet` 預設 1 → 回傳的贏額即「總注倍數」。可用 `config.spin()` 自訂畫面產生（Hold & Spin）。
  - 線模式：未給 evaluate 時用 `evalLines(...).total × lineBet + features(grid)`，`bet` 預設 `lines.length × lineBet`。
  - 回傳 `{rtp /* 0.94 = 94% */, hitRate, spins, totalBet, totalWin, maxWin}`。

### LG.dice
- 新增 `sum(dice)`。
