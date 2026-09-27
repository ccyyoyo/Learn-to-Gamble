# 規格一致性審查（Wave 3，審查代理 I2）

- 日期：2026-09-27
- 範圍：17 款遊戲 `docs/05-game-rules/<id>.md` ↔ `src/games/<id>.js/.css`，並對照 `01-prd`、`02-architecture`、`03-ui-spec`、`06-tutorial-guide`、`00-common`（含 I1 正在改的版本）、`change-requests/README.md` 協調者決議。
- 快照：HEAD `53f0ae9` + 整合代理 I1 當時的**未提交工作樹**（46 個檔案已改，含核心 CR、三公 B 方案、老虎機 modal DOM 改寫移除）。I1 仍在改檔，行號以審查當下工作樹為準，可能有幾行偏移。
- 本文件是唯讀審查結果，**沒有改任何程式**。

## 方法

1. 把工作樹複製到 scratchpad 建置 `index.html`（949.5 KB < 1.5 MB），用 Playwright 逐款、逐變體、逐模式抽取：`LG.games` 定義（houseEdge / limits / variants）、所有 `[data-bet]` 的 id 與文字、`instance.tutorialSteps()`（步數、段落、action、body 字數）、`LG.tutorial.lint()`、真實模式進場 modal 文字。
2. 用插樁版 e2e（攔截 `LG.ui.resultPanel` / `payoutFlash`）跑全部 e2e：**112 passed / 0 failed**。收集到每款的練習結果面板四段內容，也確認真實模式從沒開過 resultPanel。
3. `npm test`（工作樹快照）：**272 pass / 0 fail**。
4. 逐款讀規格、CR 與程式常數（賠付表、限注、倒數、口令、提示文案）。
5. 用 grep 找 `console.log` / `alert(` / `TODO` / `FIXME` / 外部 URL / `fetch` / 直接使用 `localStorage` 的地方。

嚴重度：**高**＝主要流程壞掉，或行為與規格／PRD 目標相反。**中**＝教錯、誤導，或與規格數字不一致、尚未經協調者認可。**低**＝文案、格式、寫作規範小瑕疵。

---

## 0. 全部遊戲共同通過的項目（下面各節不再重複）

| 檢查 | 結果 |
|---|---|
| 教學 `LG.tutorial.lint`（≥12 步、四段、≥3 action、段落順序、highlight） | 17/17 通過 |
| 教學步數 ≥ 各規格「教學大綱」要求 | 17/17 通過（最少 20 步：casino-holdem；規格最高要求 16：poker-room 有 27 步） |
| 每款都有「預算」步（今晚只帶 RM 500，輸完就走） | 17/17 |
| 桌遊的 flow 段都有獨立的「No more bets／不能碰籌碼」步 | 11/11 張桌遊＋撲克室都有；老虎機與視訊撲克不適用（holdspin/progressive 另有「轉動中不能改注」步） |
| 不教迷信（路單、熱號、「快出了」都標示「只是紀錄，不能預測」） | 通過；baccarat 路單、sicbo/fantan 最近 10 局、roulette 最近 12 號的 UI 上也都有同樣標語 |
| 練習結果面板四段（hand/result/formula/why）都有實質內容 | 17/17（e2e 攔截到的面板沒有任何一段是空的） |
| 真實模式只閃金額（payoutFlash）、不開 resultPanel、提示關閉 | 17/17 |
| 破產覆蓋層（「籌碼用完」、本次統計、重置 RM 1,000） | 核心提供；`checkBroke(minNeeded)` 已實作；三公傳 150、UTH 傳 2×min、Casino Hold'em 傳 3×min |
| houseEdge 與 00-common §4（I1 修訂版）一致 | 17/17 數字一致（差異見各節的「建議」列） |
| 金額顯示用 RM（`LG.money.fmt`）、沒有外部 URL/CDN/fetch、沒有直接使用 localStorage | 通過（唯一的 http 字串是 SVG namespace） |
| `console.log` / `alert(` / `TODO` / `FIXME` / `debugger` | 無（只有 `LG.debug` 在 `LG_DEBUG` 開啟時才 log） |
| 真實模式進場 modal：老虎機與視訊撲克顯示「不倒數」，遊戲內的 DOM 改寫已移除 | 通過（核心 `noCountdown`） |

---

## 1. 核心 / 跨遊戲

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| 教學 action 在餘額不足時無法完成 | 02-arch §4.2：教學「破產：不會」；PRD：教學完成率 100% | 教學用真實餘額。實測：餘額 RM 5 時，baccarat `flow-place`、blackjack `flow-bet`、sicbo `flow-place`、three-card-poker `flow-ante` 放籌碼都只跳「籌碼不足」，action.check 永遠不過，「下一步」一直鎖住，**教學卡死**。常見情境：真實模式破產後按「回首頁」不重置，再進教學。 | **高** | 核心：教學模式改用沙盒 bank（例如固定 RM 1,000，不寫 store），或 `LG.tutorial.run` 在餘額 < 本步 action 所需時提示「重置籌碼」並提供按鈕。`src/core/32-modes.js`（ctx.bank 建構處）、`src/core/21-bets.js:139` |
| 教學會動到真實餘額，各款做法不一 | 02-arch §4.2（教學不記統計；沒寫餘額） | video-poker、poker-room 教學不扣款；blackjack 教學那局加倍**固定贏 RM 100**（CR 自述），可以重複教學洗錢；其他款照實扣款與派彩。 | 中 | 與上一列一起用沙盒 bank 解決；在那之前至少讓 blackjack 教學局不入帳（`src/games/blackjack.js:992` 附近的 demo 局） |
| 真實模式進場 modal 的固定條列 | 老虎機、視訊撲克沒有荷官 | slot-* 與 video-poker 的 modal 仍列「荷官說 No more bets 後，籌碼不能再碰。」 | 低 | `src/core/32-modes.js:362`：`noCountdown` 時換成「按下 SPIN/DEAL 後不能改注」 |
| 教學最後一步按鈕 | 06 §1-9：「完成！去練習模式試 10 局」 | 「完成！去練習模式 Practice」 | 低 | `src/core/31-tutorial.js:96` 補「試 10 局」 |
| 段落開頭「這段你會學到…」 | 06 §1-3：每段開頭一步 | strategy 段缺開頭步的遊戲：baccarat、caribbean-stud、fantan、poker-room、sicbo、slot-classic、slot-video、three-card-poker、three-pictures（第一步直接是優勢表） | 低 | 把各款 `strategy-edge`／`strategy-rtp` 的標題改成「這段你會學到：莊家優勢」即可（行號見各節） |
| 同牌型時「為什麼」沒說明踢腳（kicker）或下一張 | 03 §6：為什麼要解釋勝負 | poker-room（實測：「Hafiz 的兩對 10 和 8 大過你的兩對 10 和 8」）、paigow-poker（「你的 K 高牌 < 莊的 K 高牌」）的 why 兩邊牌型名稱一樣，看不出為什麼輸；casino-holdem、ultimate-holdem、caribbean-stud、three-card-poker 也共用同一句型。 | 中（poker-room、paigow）／低（其他 4 款） | 牌型分類相同時補一句「牌型相同，比踢腳：A > 7」，可從 `best5`／`ranks` 找出第一張不同的牌 |
| 下注格最小 56×44px | 03 §1 | 390px 寬時低於標準的格子：fantan 12/28（最窄約 39px）、sicbo 32/52（圍骰 54×86、總點約 46px，CR 已說明）、roulette 117/157（外注在直式版只有 50px 寬，內注熱區依規格可到 22px） | 低 | fantan 念格與 sicbo 總點列，可在手機上改兩列排或放大 |

---

## 2. 百家樂 baccarat

通過：賠付（`11-baccarat-lib.js` settle：0.95、0.5、8、11、12、12/20、50、22、35、4/20/100）與 §3 全部一致；真實限注 `REAL_RULES`（主注 50–5,000、和 10–500、旁注 10–1,000）；倒數 15；spotId 四個變體都齊全（classic/squeeze 5、super6 6、tiger 10），沒有多餘的格，每格都有中文、英文與賠率；教學 26 步／7 action，大綱逐項都有（路單、籌碼顏色、第三張表、咪牌禮儀、3 題互動）；提示照 CR-1/CR-2；口令（Place your bets → No more bets → 唱點 → Player/Banker wins、Card please、Shuffling）；variants 各自帶 houseEdge（CR-3 已由 I1 實作）。

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| 免佣桌（super6/tiger）的策略步驟 | CR-1（已接受）：免佣桌閒 1.24% < 莊 1.46% | `strategy-bet` 的標題仍是「該押：莊」，而且高亮 banker；`strategy-edge` 的註腳在免佣桌也固定寫「優勢 1.06% = 長期每押 RM 100 平均輸 RM 1.06」 | 中 | `src/games/baccarat.js:685`：註腳依變體改成 1.24%／1.46%；`:687`：`nc` 時標題改「該押：閒或莊」並高亮 player＋banker |
| 燒牌 | §2「開局燒牌…教學提到即可」 | 教學沒有提到燒牌（程式有執行 `burnStart`） | 低 | 在 `flow-order`（`baccarat.js:634`）或 layout 補一句燒牌 Burn card |
| strategy 段開頭步 | 06 §1-3 | 缺「這段你會學到」 | 低 | `baccarat.js:684` 改標題 |
| 對子算式 | 06 §1-5：淨贏與拿回都寫 | `payout-pair` 只寫拿回 RM 120，沒標「淨贏」 | 低 | 補「RM 110（淨贏）」 |

## 3. 21 點 blackjack

通過：3:2、2:1、push；S17；DAS；分牌到 4 手、分 A 只拿一張；`STRATEGY_TABLE` 硬、軟、對子三張表與 §5 逐格相符；真實限注 50–3,000、倒數 15、行動 20 秒（逾時停牌）、保險 5 秒；真實模式按鈕加手勢文字；口令 Insurance? / Blackjack / Dealer has N / Push；spot `main`、`insurance`，分牌後有 `main-2..4`；教學 32 步／8 action，大綱全部涵蓋（第三壘、手勢、5 題策略、別買保險）；提示「建議：停牌 Stand（表：硬牌 16 vs 6）」，偏離建議時 why 會引用表格。

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| 教學局入帳 | 見核心列 | 教學那局固定 +RM 100 會寫進真實餘額 | 中 | 見 §1 |
| 偷看暗牌（peek） | §1「只在明牌為 A 時提供保險」 | 明牌 A 或 10 都偷看（CR 決定 2，美式規則，0.41% 以此計算） | 低 | 規格補一句「莊明牌 10 點牌也先偷看」 |

## 4. Caribbean Stud caribbean-stud

通過：Bet 賠付 1/1/2/3/4/5/7/20/50/100；累積獎金 50/100/500/10%/100%；獎池種子 100,000、每注 +3.5；Ante 25–500、旁注固定 5、倒數 15、決策 30 秒逾時棄牌；spot `ante/bet/progressive` 都有；houseEdge 另有 Progressive 86.54% approx 一列（決議保留）；教學 22 步，strategy 段已寫「獎池 RM 100,000 時約 86%，需 RM 1.58M 才打平」（決議）；提示「建議：跟注/棄牌（策略第 n 條）」。

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| progressive 格的賠率 | 03 §4：每格都要中文、英文、賠率 | 格內只寫「累積獎金 Progressive RM 5」，沒寫任何賠付 | 低 | `src/games/caribbean-stud.js:43` 的 odds 改成「同花 RM 50 起」之類 |
| strategy 段開頭步 | 06 §1-3 | 缺 | 低 | `caribbean-stud.js:570` 改標題 |

## 5. Casino Hold'em casino-holdem

通過：Ante 表 100/20/10/3/2/1；AA 7（一對 A 到順）/20/30/40/50/100；合格 44+；Ante 25–500、AA 10–100、決策 30 秒逾時棄牌；spot `ante/call/aa` 都有；優勢 2.16 / 6.26；教學 20 步，三個情境都有淨贏與拿回，AA 看前 5 張；提示用 §4 的三條量化策略。

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| 同牌型的 why | 見 §1 | 「你的 一對 K 比較大」沒說踢腳 | 低 | `src/games/casino-holdem.js:542` |

## 6. Ultimate Texas Hold'em ultimate-holdem

通過：Blind 500/50/10/3/1.5/1、其他 push；Trips 50/40/30/8/7/4/3（決議保留，優勢 3.50%）；Ante/Blind 25–500、Trips 10–100、每階段 30 秒（翻牌前、翻牌後逾時過牌，河牌逾時棄牌）；spot `ante/blind/play/trips`；狀態機只能加注一次；教學 26 步，含 4× 表與 3 題測驗；`checkBroke(2×min)`（CR-4）。

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| 莊不合格的算式 | 06 §1-5 | `payout-noqual` 只寫淨贏 RM 150，沒寫拿回（應為 RM 350） | 低 | `src/games/ultimate-holdem.js:777` 補「拿回 RM 350」 |
| 同牌型的 why | 見 §1 | `ultimate-holdem.js:659` 同樣句型 | 低 | 補踢腳說明 |

## 7. Three Card Poker three-card-poker

通過：Ante Bonus 1/4/5；Pair Plus 1/4/6/30/40；Q 高合格；Q-6-4；25–500、30 秒逾時棄牌；spot `ante/play/pairPlus`；優勢 2.32 best / 3.37；教學 22 步，順子 > 同花有獨立一步；桌面印字與賠付表都有。

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| 「別押」步 | 06 §1-7：strategy 段要有「別押」 | `strategy-dont` 標題是「別這樣做」，講的是行為，沒點名哪一注別押 | 低 | `src/games/three-card-poker.js:494`：改成「別押：只押 Ante 不押 Pair Plus 時…」或明講 Ante/Play 3.37% 較差 |
| strategy 段開頭步 | 06 §1-3 | 缺 | 低 | `three-card-poker.js:484` |
| 術語格式 | 06 §1-4 | 教學 body 內完全沒用 `<i class="en">`（只有標題有）；`flow-hands-off` 只寫 No more bets，沒附中文 | 低 | 第一次在 body 出現時補「停止下注 No more bets」 |
| Ante Bonus、Pair Plus 算式 | 06 §1-5 | `payout-ante-bonus` 只寫 +RM 100；`payout-pairplus` 沒標「淨贏」 | 低 | 補齊淨贏與拿回 |

## 8. Pai Gow Poker paigow-poker

通過：扣 5% 佣、copy 歸莊、Foul；Fortune 2/3/4/5/25/50/150/400；RM 50–3,000、Fortune 10–500（00-common 已補）、排牌 60 秒逾時套房規；spot `main/fortune`；教學 30 步，大綱全部涵蓋（骰子決定起手位、不可露牌、41% push）；提示顯示房規條號。

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| 同牌型的 why | 03 §6 | 「你的 K 高牌 < 莊的 K 高牌 → 莊贏」，兩邊名稱相同，新手看不懂（牌九高牌局很多） | 中 | `src/games/paigow-poker.js:484`：同類別時列出第一張不同的牌（例：「第 4 張 3 < 6」） |
| houseEdge 沒有 Fortune 列 | 00-common 備註：Fortune ≈ 8.6%（模擬） | 陣列只有 2.84 一列，但教學與提示都用 8.6% | 低 | 比照 caribbean-stud 加 `{bet:'Fortune 旁注', edge:8.6, approx:true}` |

## 9. 三公 three-pictures

通過：B 方案已實作（比點數 → 公數，全同莊贏，不比單張）；玩家贏 3:1/2:1/1:1，莊 9 點或三公時輸 2/3 倍；houseEdge 4.17 approx；`checkBroke(150)`；RM 50–3,000、倒數 15；spot `seat-1..3`；桌面印字與規則牌兩行都有；教學 24 步，同點規則寫「不比單張大小」。

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| 協調者決議文字與實作相反 | README 決議：「莊勝一律收 1 倍（`bankerMultiplier=false`），優勢約 4.17%」 | 實作 `bankerMultiplier: true`（`src/games/three-pictures.js:18`）；規格 §2 已註明「false 會變成玩家 +7.42%」。依 CR-1 的枚舉表，只有 true 才得到 4.17%，所以實作是對的，是決議文字自相矛盾。 | 中 | 不用改程式。請協調者把 README 的決議改成「莊贏按莊牌型收（`bankerMultiplier=true`）」，追認這個做法 |
| 優勢說明用詞 | — | `strategy-edge` 寫「≈ 4.17%（模擬值）」，下一句卻說「由電腦逐一列舉」（`three-pictures.js:448`） | 低 | 改成「精確列舉 4.17%」 |
| 算點練習 | §5「算點練習 3 題」 | payout-q1–q3 只是陳述，不是互動題（payout 段只有 `payout-try` 一個 action） | 低 | 可把 q1–q3 改成選項題（比照 baccarat `quiz`） |
| strategy 段開頭步 | 06 §1-3 | 缺 | 低 | `three-pictures.js:447` |

## 10. 番攤 fantan

通過：番 3、念 2（副號 push）、角 1、三門 1/3（決議）、單雙 1，全部 ×0.95；spotId 28 個（4 番、12 念、6 角、4 三門、單、雙），沒有缺也沒有多，每格都有中文、英文、賠率；50–3,000、倒數 20；houseEdge 念/角 2.5 best、單雙 2.5、三門 1.25、番 3.75，與 00-common 修訂一致；提示「每格小字 = 中獎機率與扣佣後 EV」與規格 §6 相符；口令「開三 Three」。

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| 排行榜的 best | 02-arch：排行榜取 best 或最小值 | best 標在念/角 2.50%，但三門 1.25% 更低，首頁顯示 2.50%（00-common 也這樣寫，所以一致） | 低 | 請協調者決定 best 要不要移到三門（策略步驟說三門「每次贏得很少」，也可以維持現狀） |
| 念、角的算式 | 06 §1-5 | `payout-nim` 只寫 RM 190，沒寫拿回；`payout-try` 的 RM 95 沒寫淨贏或拿回 | 低 | `src/games/fantan.js:463`、`:469` 補拿回 RM 290／RM 195 |
| strategy 段開頭步 | 06 §1-3 | 缺 | 低 | `fantan.js:475` |

## 11. 骰寶 sicbo

通過：大小/單雙 1、單點 1/2/3、雙骰 10、圍骰 180、全圍 30、總點 60/30/18/12/8/6/6、組合 5；spotId 52 個齊全；每格有中文、英文、賠率，提示開啟時另顯示機率與優勢；真實模式大小/單雙 25–3,000，其他單點 1,000、總點與組合 500、雙骰 300、圍骰與全圍 100，倒數 20；houseEdge 13 列與 00-common 修訂版（圍骰 16.20、總點 9/12 18.98）一致；教學大綱全部涵蓋。

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| strategy 段開頭步 | 06 §1-3 | 缺 | 低 | `src/games/sicbo.js:519` |
| 手機格寬 | 03 §1 | 總點列約 46px（CR 已說明） | 低 | 見 §1 |

## 12. 輪盤 roulette

通過：WHEEL 順序、紅號集合、賠率 35/17/11/11/8/8/5/2/2/1；spot 157 個＝37 直、60 分、12 街、2 三數、22 角＋首四、11 線、12 外注（CR-R1 說明「3 首三」應為 2）；真實模式外注 25–3,000、內注每格 10、內注合計 ≥ 25、直注 ≤ 500、倒數 20，並用 `closeAt` 在剩 5 秒喊 No more bets（核心 CR 已接上）；dolly；教學 32 步，7 種內注各一步 action，輪盤順序與個人色碼籌碼都有；提示「賠率 · 命中 n/37」。

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| 號碼格與熱區的標示 | 03 §4：每格要有中文、英文、賠率 | 37 個號碼格只有「17 35:1」；108 個熱區沒有文字，只有 title/aria-label；桌面上方有一行圖例（CR-R4） | 低 | 請協調者追認 CR-R4（手機寬度放不下），或在圖例補齊每種內注的中英文 |
| 小／大格 | 03 §4 | `low`、`high` 格只有「小 1–18」「大 19–36」，沒有 LOW/HIGH | 低 | `src/games/roulette.js:38-39` 的 en 改成「1–18 LOW」「19–36 HIGH」 |
| 規格 §8 數字 | — | 規格仍寫「2 三數 Trio」，已與實作一致（I1 已修） | — | — |

## 13. 德州撲克現金桌 poker-room

通過：盲注 5/10、抽水 5% 上限 50、No flop no drop、抽水取整（CR-5）；買入 400–1,000；真實模式行動 30 秒（逾時過牌或棄牌）；`limitsLabel` 顯示「買入 RM 400–1,000 · 盲注 RM 5/10」；教學 27 步 ≥ 16，大綱全部涵蓋（string bet、口頭宣告、牌不離桌、邊池實例、起手牌表、位置、底池賠率）；提示顯示勝率、底池賠率、建議與一句理由；AI 三種性格。沒有 data-bet（CR-1，桌面是動作列＋座位，驗收改看這兩者）。

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| 同牌型的 why | 03 §6、§5 | e2e 實測：「Hafiz 的 兩對 10 和 8 大過 你的 兩對 10 和 8」，沒說是踢腳 A 贏 7 | 中 | `src/games/poker-room.js:674`：兩邊 `cat` 相同時，比對 `best5` 補「牌型相同，比踢腳：A > 7」 |
| 真實模式 modal | 規格 §6：行動 30 秒倒數 | modal 寫「倒數 30 秒」，看起來像下注倒數 | 低 | 核心 modal 支援 `def.countdownLabel`，這款傳「每次行動 30 秒」 |
| strategy 段開頭步 | 06 §1-3 | 標題「莊家優勢？」，缺「這段你會學到」 | 低 | `poker-room.js:1404` |

## 14. 3 軸經典機 slot-classic

通過：1000/200/50/10/2/1/0；只算中線；每注 0.10–5 × 1–5 credits、上限 25；RTP 精確 90.00%；教學 21 步 ≥ 10（大綱全部涵蓋：TITO、MAX BET、押大不改變比例、停損、沒有快出了）；練習面板寫「未中獎，本次投入 RM x」；真實模式不倒數。

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| strategy 段開頭步 | 06 §1-3 | 第一步是「RTP 是什麼」 | 低 | `src/games/slot-classic.js:374` |

## 15. 5 軸 20 線影片機 slot-video

通過：賠付表與 §2 逐格一致；LINES_20 與 §3 一致；免費轉 10/15/20，觸發時即時獎總注 ×2；每線注 0.10–5；真實 2–100；RTP 精確 94.05%；教學大綱全部涵蓋（倍數 × 每線注、兩線加總、免費轉是 RTP 的一部分）。

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| WILD 5 連 1000× 不可能出現 | §2「WILD 5 連 1000×（只出現在軸 2–4 可選）」 | 採用「軸 2–4」，所以 `W:{5:1000}` 永遠不會中，但仍列在賠付表（Pay Table 有註明） | 低 | 規格二選一：拿掉 5 連 WILD，或讓軸 1、5 也有 Wild（需要重調 strips） |
| 算式 | 06 §1-5 | `payout-one`、`payout-two` 沒寫「拿回」；`payout-wild` 淨贏和拿回都沒寫 | 低 | 補齊 |
| strategy 段開頭步 | 06 §1-3 | 缺 | 低 | `src/games/slot-video.js:532` |

## 16. Hold & Spin slot-holdspin

通過：6 顆觸發、3 次再轉且有新球重置、每格 8%、面額分佈與 §3.4 完全一致、MINOR = 總注 × 50、全滿加 GRAND；限注 2–100；RTP 精確 94.57%；教學大綱全部涵蓋。

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| MAJOR/GRAND 金額隨注額縮放 | §4：MAJOR 種子 RM 500、GRAND RM 5,000（固定 RM） | CR-2 自行決定以總注 RM 2 為基準等比縮放：派彩 = 儲存值 × 總注 ÷ 2（`src/games/slot-holdspin.js:301`、`:311`、`:317`）。協調者決議**沒有**處理這個 CR。 | 中 | 請協調者追認，並把 §4 改成「以總注 RM 2 為基準等比換算」；教學 `layout-jackpots` 的「MAJOR 從 RM 500 起」也要註明「總注 RM 2 時」 |
| 「別押」 | 06 §1-7 | 是「該做 / 別做」（`:722`），講的是行為（老虎機沒有旁注可押） | 低 | 可接受；標題可改成「該押 / 別押：每線注大小」 |
| 金球加總算式 | 06 §1-5 | `payout-sum` 只寫 = RM 50，沒寫淨贏（總注 RM 2 → 淨贏 RM 48） | 低 | `slot-holdspin.js:702` |

## 17. 四級累積獎金機 slot-progressive

通過：種子 20/50/500/10,000、成長 0.5/0.5/0.8/1.2%、輪盤 12 格（GRAND 1、MAJOR 1、MINOR 4、MINI 6）、非最大注時 GRAND 格變 MAJOR、獎金牌標「僅最大注」；限注 2–100；最大注 RTP 92.19%；教學大綱全部涵蓋（一定要最大注有 action）。

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| 非最大注的輪盤獎金打折 | §1–2 只寫「非最大注時 GRAND 格替換為 MAJOR」，獎金是固定 RM | CR-2 自行決定：獎金 = 獎池 × (總注 ÷ RM 100)（`src/games/slot-progressive.js:119-120`），非最大注 RTP 86.64%。協調者決議**沒有**處理。 | 中 | 請協調者追認，並在 §2 補「非最大注按 總注/RM 100 比例派彩」；教學 `payout-nonmax` 已有說明 |
| 算式 | 06 §1-5 | `payout-line`、`payout-nonmax` 沒標淨贏或拿回 | 低 | 補齊 |

## 18. 視訊撲克 video-poker

通過：9/6 賠付表（皇家 1–4 枚每枚 250、5 枚每枚 800）；每枚 0.20–5 × 1–5 枚；不倒數；RTP 簡化策略約 99.4%（best 0.46）；教學 21 步／8 action，含 15 條策略、永遠押 5 枚、9/6 對 8/5、double up 本機不做；練習面板比較「你留的」和「建議留的」並附 EV；教學不扣款。沒有 data-bet（CR-VP2，由賠付表列 `tr[data-hand]` 代替）。

| 項目 | 規格 | 實作 | 嚴重度 | 建議修法 |
|---|---|---|---|---|
| 教學 body 長度 | 06 §1-1：每步 ≤ 80 中文字 | `strategy-table` 有 117 個中文字（15 條列表） | 低 | `src/games/video-poker.js:680`：拆成「已成牌／聽牌」兩步，或改用 `LG.ui.table` 渲染 |

---

## 彙總：高

1. **教學在餘額不足時卡死**（核心）：`src/core/32-modes.js`（ctx.bank／教學模式）、`src/core/21-bets.js:139`。實測 baccarat、blackjack、sicbo、three-card-poker 在餘額 RM 5 時放籌碼的 action 無法完成，「下一步」一直鎖住。修法：教學改用沙盒 bank，或偵測到餘額不足時在教學步驟內提供「重置籌碼」。

## 彙總：中

1. 教學會動到真實餘額，blackjack 教學局固定 +RM 100 可以重複賺：`src/games/blackjack.js:992` 附近（demo 局），與「高」第 1 條一起處理（沙盒 bank）。
2. baccarat 免佣桌（super6/tiger）策略步驟仍說「該押：莊」，註腳寫 1.06%：`src/games/baccarat.js:685`、`:687`。
3. poker-room 同牌型的「為什麼」沒講踢腳：`src/games/poker-room.js:674`。
4. paigow-poker 同牌型的「為什麼」看不出差在哪：`src/games/paigow-poker.js:484`。
5. slot-holdspin 的 MAJOR/GRAND 隨注額縮放，與規格固定 RM 不符、CR-2 沒有決議：`src/games/slot-holdspin.js:301`、`:311`、`:317`（需要協調者追認並改 `slot-holdspin.md` §4）。
6. slot-progressive 非最大注的獎金按比例打折，規格沒有、CR-2 沒有決議：`src/games/slot-progressive.js:119-120`（需要協調者追認並改 `slot-progressive.md` §2）。
7. 三公決議文字（`bankerMultiplier=false` ⇒ 4.17%）自相矛盾；實作 `src/games/three-pictures.js:18`（true）才對。只需改 `docs/change-requests/README.md` 決議文字，不用改程式。

低：共約 30 條，列在各節表格裡。其中最值得順手修的是：9 款補 strategy 段的「這段你會學到」；各款付款步驟補齊「淨贏／拿回」；`src/core/32-modes.js:362` 老虎機 modal 的荷官條列；`src/core/31-tutorial.js:96` 完成按鈕補「試 10 局」。
