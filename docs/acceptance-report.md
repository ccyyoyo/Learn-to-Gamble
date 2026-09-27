# 驗收報告（Wave 3 · 整合代理 I1）

- 日期：2026-09-27
- 基準：HEAD `53f0ae9` + Wave 3 整合修改（未 commit）
- 對照：`docs/07-test-plan.md` §4 手動驗收清單、`docs/change-requests/*`、`docs/spec-audit.md`（審查代理 I2）

## 1. 測試結果

| 項目 | 指令 | 結果 |
|---|---|---|
| 建置 | `node build.mjs` | `index.html` **955 KB**（40 js、18 css；上限 1.5 MB） |
| 單元測試 | `npm test` | **274 pass / 0 fail**（排除 `[slow]`） |
| 單元＋模擬 | `npm run test:slow` | **296 pass / 0 fail** |
| e2e | `npm run e2e` | **114 passed / 0 failed**（17 款遊戲＋首頁／核心） |
| 截圖 | Playwright 390×844，`localStorage.clear()` 後等 `data-ready` | `docs/screens/home.png` 與 17 款遊戲練習模式 `docs/screens/<id>.png`（整頁） |

與 Wave 2 相比：`_demo` 刪除（−4 單元、−10 e2e），新增 `core-registry.test.mjs`、bank 沙盒、`LG.poker.kicker` 單元測試，首頁 e2e 改用 sicbo / baccarat 並新增「不倒數與 limitsLabel」「No more bets 停留 600ms」「教學沙盒」「自訂破產門檻」情境。

## 2. 手動驗收清單（07-test-plan §4）

- [x] **`index.html` 雙擊離線可開（file://），無 console error**：e2e 與截圖腳本都以 `file://` 開啟；首頁與 17 款 × 三模式都沒有 console error / pageerror（e2e 會把任何 console error 判為失敗）。沒有外部 URL、CDN、fetch。
- [x] **手機 390×844：無橫向溢出，觸控目標 ≥ 44px**：18 個頁面 `scrollWidth = 390`。整合時把 `.lg-btn--sm`、變體列、分頁籤、老虎機 ± 按鈕統一提高到 44px；變體列在手機改為換行，不再橫捲。例外列在 §5「已知限制」（輪盤格線熱區 24px、影片機線號 22px、番攤念格寬 39px）。
- [x] **首頁：四區、17 張卡、完成度環、餘額、排行榜由低到高、撲克室在最下**：卡片照 `00-common.md` §1 順序（`def.order`，e2e 驗證完整順序）。排行榜 16 列由低到高，數字格式與 00-common §4 一致（桌遊兩位小數、老虎機一位、視訊撲克 RTP 99.54%），撲克室另列最下。百家樂卡片顯示變體資訊「傳統 1.06% · 免佣 1.46% · 老虎 1.46% · 咪牌 1.06%」，排行榜注別欄附「免佣 / 老虎：莊（免佣…）1.46%」。
- [x] **每款遊戲：教學 ≥ 12 步、四段齊、≥ 3 個 action；練習 resultPanel 四段；真實：倒數／口令／只顯金額／破產覆蓋層**：
  教學步數（action 數）：baccarat 26(7)、blackjack 32(8)、roulette 32(8)、sicbo 24(4)、three-pictures 24(4)、fantan 24(4)、caribbean-stud 22(4)、three-card-poker 22(3)、casino-holdem 20(3)、ultimate-holdem 26(6)、paigow-poker 30(4)、slot-classic 21(4)、slot-video 23(3)、slot-holdspin 22(4)、slot-progressive 21(4)、video-poker 22(8)、poker-room 27(3，要求 ≥ 16)。`LG.tutorial.lint` 17/17 無問題；每段開頭都有「這段你會學到」。
  練習結果面板四段由各款 e2e 驗證；真實模式倒數＋「Place your bets / No more bets」口令、只閃金額、破產覆蓋層由 e2e 驗證（老虎機與視訊撲克依設計不倒數，進場 modal 顯示「不倒數」）。
- [x] **重整頁面後餘額、進度、統計保留；重置籌碼只重置餘額**：首頁 e2e「練習一局＋重整」驗證餘額與統計；`core-store.test.mjs` 驗證 `bank.reset()` 只動餘額。教學模式改用示範籌碼沙盒，不會寫入真實餘額。
- [x] **所有金額顯示 `RM` 前綴且千分位**：以 Playwright 掃描 18 頁 × 練習／真實模式的所有文字節點，千分位數字前都有 `RM`（範圍寫法「RM 50 – 5,000」依核心格式，第一個數字帶 RM）。程式內沒有 `元`、`$`、`MYR` 等其他幣別寫法；金額一律 `LG.money.fmt`。
- [x] **英文術語出現在每個下注格**：截圖稽核腳本檢查所有 `[data-bet]` 內文或 `title/aria-label` 都有英文。例外依 CR 追認：輪盤 108 個格線熱區的英文放在 `title/aria-label` 與桌面圖例（CR-R4）；撲克室、視訊撲克、老虎機沒有下注格（改以動作列／賠付表列帶英文，CR-1 / CR-VP2）。
- [x] **老虎機轉軸有動畫、Pay Table 按鈕開表**：四台老虎機 e2e 都驗證 SPIN 動畫完成後結算與「賠付表 Pay Table」modal。
- [x] **`index.html` < 1.5 MB**：955 KB。

## 3. 已處理的 change-requests

| 來源 | 項目 | 處理 |
|---|---|---|
| README 決議 | three-pictures B 方案 | **接受（更正決議文字）**：取消最高單張比較；莊贏按莊牌型收（`bankerMultiplier=true`）。精確枚舉 4.17%、MC 100 萬局 4.16%，houseEdge 4.17 approx；規格、00-common（≈4.2%）、README 決議文字已改一致。原文字的 `false` 會讓玩家 +7.42%。 |
| README 決議 | fantan 三門 1:3（1.25%） | 接受：`fantan.md` §2/§5、00-common 更新（best 仍為念/角 2.50%，與 00-common 一致）。 |
| README 決議 | sicbo 00-common 數字 | 接受：00-common 備註改為圍骰 16.20%、總點 9.72–18.98% 等枚舉值。 |
| README 決議 | caribbean-stud Progressive | 接受：規格備註「獎池 RM 100,000 時約 86%，需 RM 1.58M 才打平」；教學文字同步。 |
| README 決議 | UTH Trips 3.50% | 接受：保留賠付表，`ultimate-holdem.md` 與 00-common 改 3.50%，提示文字改 3.50%。 |
| README 決議 | casino-holdem / UTH 策略文字 | 接受：兩份規格 §4 改成 CR 實際實作的量化規則。 |
| baccarat CR-1 / CR-2 | 免佣桌提示、旁注實際優勢 | 接受；另修 I2 指出的免佣桌策略步驟（「該押：閒（1.24% < 莊 1.46%）」、高亮閒＋莊、註腳依變體）。 |
| baccarat CR-3 | 變體別 houseEdge | 接受：核心 `variants[i].houseEdge`、`LG.edgesFor/bestEdge(def, variantId)/variantEdges`，首頁卡片與排行榜顯示變體資訊。 |
| blackjack CR-1 | No more bets 被蓋掉 | 接受：核心 `dealer.say` 讓「No more bets」至少停留 600ms（×LG.speed），之後的口令排隊。 |
| blackjack CR-2 | MC 誤差 | 保留（說明性質，測試已處理）。 |
| blackjack 給整合 | 教學用真實餘額 | 接受：教學沙盒（見 I2 高項）。 |
| caribbean / three-card / casino / UTH | 自加 500ms 延遲 | 移除（核心已處理口令停留）。 |
| casino-holdem CR-3、UTH CR-4、three-pictures CR-2 | 破產門檻 | 接受：`ctx.checkBroke(minNeeded)`；三公 3×min、UTH 2×min、Casino Hold'em 3×min。 |
| casino-holdem CR-2、UTH CR-3 | 逾時、資金預留假設 | 保留（合理假設，已寫在 CR）。 |
| core-a CR-A1–A8 | 語意補充 | 保留（合約補充，02-architecture 已同步新 API）。 |
| core-b CR-1 | `npm test` 排除 slow | 已在 Wave 2 修好（`--test-skip-pattern`），保留。 |
| fantan CR-2 | 對號角放外圈 | 保留。 |
| paigow CR-1 / CR-2 | Fortune 限注 RM 10–500、≈8.6% | 接受：00-common §3/§4、`paigow-poker.md` §6 補上；houseEdge 加 Fortune 一列（approx）。 |
| paigow CR-3 | actionBar.set 洗掉高亮 | 接受：核心 `actionBar` 只替換自己加的 class。遊戲內 `button(id)` 繞法可保留。 |
| poker-room CR-1/2/4/5/6 | 無下注格、買入金流、不用 bettingWindow 等 | 保留（驗收以動作列與座位代替下注格）。 |
| poker-room CR-3 | `def.limitsLabel` | 接受：顯示「買入 RM 400–1,000 · 盲注 RM 5/10」；另加 `def.countdownText`「每次輪到你行動倒數 30 秒」。 |
| roulette R1 | 157 / 2 三數 | 接受：`roulette.md` §8 改為 145 內注（2 三數）＋ 12 外注。 |
| roulette R2 | 內注限額假設 | 保留。 |
| roulette R3 | `bettingWindow.closeAt` | 接受：核心實作 `closeAt`＋`onNoMoreBets`，輪盤已改用。 |
| roulette R4 | 號碼格標示 | 追認（README）。另把小/大格英文改為「1–18 LOW」「19–36 HIGH」。 |
| roulette R5 | `.lg-spot--hl` position | 接受：核心不再設 position；輪盤覆寫移除。 |
| sicbo CR-1 / CR-2 | 00-common 數字、限注假設 | 接受 / 保留。 |
| slot-classic / slot-video / slot-holdspin / slot-progressive CR-1、video-poker CR-VP1 | 進場 modal「倒數 N 秒」 | 接受：`def.countdown === 0` 或 `category === 'slots'` 顯示「不倒數」（`def.startHint` 補充），並依類型換掉「No more bets」條列；遊戲內 DOM 改寫移除，改用 `def.limitsLabel` 顯示「每轉 RM 0.10 – RM 25.00」等。 |
| slot-holdspin CR-2 | MAJOR/GRAND 隨注額換算 | 追認（README），寫入 `slot-holdspin.md` §4。 |
| slot-progressive CR-2 | 非最大注按比例派彩 | 追認（README），寫入 `slot-progressive.md` §2。 |
| slot-* / video-poker 其他 | 限注、RTP、策略解讀 | 保留。 |
| three-card-poker CR-1 | 規則假設 | 保留。 |
| I2 高 | 教學餘額不足卡死 | 修正：`LG.bank.sandbox()`，教學固定 RM 1,000 示範籌碼，不寫 store；e2e 驗證真實餘額 RM 5 時教學可完成且真實餘額不變。 |
| I2 中 | 同牌型「為什麼」沒說踢腳 | 修正：新增 `LG.poker.kicker(a, b)`；poker-room、paigow（高手/低手；順子除外）、casino-holdem、UTH、caribbean-stud、three-card-poker 的結果說明都補「牌型相同，比踢腳 Kicker：A > 7」等。 |
| I2 低（部分） | 完成鈕、strategy 開頭步、Caribbean 旁注賠率、視訊撲克策略表拆兩步、算式補淨贏/拿回（UTH、fantan、baccarat）、三公優勢用詞 | 修正。其餘低項列入 §5。 |

## 4. 整合時的其他修正

- 核心：`ctx.limitsLabel`、`def.startHint`、`def.countdownText`；進場 modal 條列依類型；教學完成鈕「完成！去練習模式試 10 局」。
- 首頁：優勢數字格式與 00-common 一致；卡片顯示變體資訊。
- 版面：變體列換行；按鈕 44px；骰寶圍骰格「圍＋三顆小骰」在手機上換行（原本重疊）；番攤念格的提示小字改三行（原本溢出到隔壁格）。
- 刪除 `src/games/_demo.js`、`_demo.css`、`tests/unit/core-demo.test.mjs`；文件改為「參考 `src/games/sicbo.js`」。

## 5. 已知限制

- **觸控目標例外**：輪盤格線熱區 24×24px（分、街、角、線注，照現場籌碼壓線的放法；可點號碼格下直注）；影片機左右線號 22px（只用來亮線）；番攤念格 39–43px 寬（高度 107–199px）；骰寶總點格約 46px 寬。
- **撲克室／視訊撲克／老虎機沒有 `data-bet` 下注格**：以動作列、賠付表列、betPanel 代替（CR 已說明）。
- **三公規則**：採「莊贏按莊牌型收」（莊 9 點輸 2 倍、三公輸 3 倍），與原規格「莊勝輸 1 倍」不同，所以下注要保留 3 倍注額。
- **影片機 5 連 WILD 1000×**：Wild 只在軸 2–4，所以賠付表上的 5 連 Wild 不可能出現（Pay Table 有註明）。
- **番攤排行榜代表值**：維持念/角 2.50%（與 00-common 一致），三門 1.25% 其實更低。
- **I2 其餘低項未處理**：三公算點練習仍是陳述而非互動題；百家樂教學沒提燒牌；三張撲克教學 body 少用 `<i class="en">`；部分老虎機付款步驟沒寫「拿回」；Hold & Spin／累積獎金機「別押」步驟講的是行為；blackjack 規格未註明明牌 10 也偷看。
- **教學沙盒**：教學期間選單的「重置籌碼」只重置示範籌碼；撲克室教學本來就用自己的示範籌碼。
- **撲克室練習模式**：買入後 topbar 餘額顯示桌下剩餘金額（例如全買入時 RM 0），桌上籌碼在座位上顯示。
- 截圖為練習模式初始畫面（撲克室為買入後），沒有涵蓋結果面板與教學工作表的每一步。
