# 05-00 共用規則與參數

## 1. 遊戲 id 與檔名
| id | 名稱 | 分類 | 規格書 |
|----|------|------|--------|
| baccarat | 百家樂 Baccarat（4 變體） | table | `baccarat.md` |
| blackjack | 21 點 Blackjack | table | `blackjack.md` |
| roulette | 輪盤 Roulette（單零） | table | `roulette.md` |
| sicbo | 骰寶 Sic Bo | table | `sicbo.md` |
| three-pictures | 三公 Three Pictures | table | `three-pictures.md` |
| fantan | 番攤 Fan Tan | table | `fantan.md` |
| caribbean-stud | Caribbean Stud Poker | poker-table | `caribbean-stud.md` |
| three-card-poker | Three Card Poker | poker-table | `three-card-poker.md` |
| casino-holdem | Casino Hold'em | poker-table | `casino-holdem.md` |
| ultimate-holdem | Ultimate Texas Hold'em | poker-table | `ultimate-holdem.md` |
| paigow-poker | Pai Gow Poker 牌九撲克 | poker-table | `paigow-poker.md` |
| slot-classic | 3 軸經典機 | slots | `slot-classic.md` |
| slot-video | 5 軸 20 線影片機 | slots | `slot-video.md` |
| slot-holdspin | Hold & Spin 機 | slots | `slot-holdspin.md` |
| slot-progressive | 四級累積獎金機 | slots | `slot-progressive.md` |
| video-poker | 視訊撲克 Jacks or Better | slots | `video-poker.md` |
| poker-room | 德州撲克現金桌 | poker-room | `poker-room.md` |

## 2. 籌碼與金額
- 面額：RM 10 / 25 / 50 / 100 / 500 / 1000。老虎機與視訊撲克不用籌碼，用「每線 / 每注金額」面板（RM 0.10 起）。
- 開場 RM 1,000。餘額可為小數（老虎機），顯示到兩位。

## 3. 雲頂大眾區限注（近似，現場以桌上標示為準）
| 遊戲 | 真實模式最低 | 真實模式最高 | 備註 |
|------|------|------|------|
| 百家樂 | RM 50 | RM 5,000 | 旁注（對子/老虎）RM 10–1,000；和 RM 10–500 |
| 21 點 | RM 50 | RM 3,000 | |
| 輪盤 | 外注 RM 25；內注每格 RM 10，內注合計 ≥ RM 25 | 直注 RM 500；外注 RM 3,000 | |
| 骰寶 | RM 25 | 大小/單雙 RM 3,000；其他依賠率遞減 | |
| 三公 | RM 50 | RM 3,000 | |
| 番攤 | RM 50 | RM 3,000 | |
| Caribbean Stud | Ante RM 25 | Ante RM 500 | 累積獎金旁注固定 RM 5 |
| Three Card Poker | Ante / Pair Plus RM 25 | RM 500 | |
| Casino Hold'em | Ante RM 25 | RM 500 | AA 旁注 RM 10–100 |
| Ultimate Texas Hold'em | Ante RM 25（Blind 同額） | RM 500 | Trips RM 10–100 |
| Pai Gow Poker | RM 50 | RM 3,000 | Fortune 旁注 RM 10–500（不可單押） |
| 老虎機 | 每線 RM 0.10 | 每線 RM 5 | 累積獎金機 Grand 只在最大注 |
| 視訊撲克 | 每枚 RM 0.20 | 每枚 RM 5；1–5 枚 | |
| 撲克室 | 盲注 RM 5 / RM 10 | 買入 RM 400–1,000 | 抽水 5%，上限 RM 50，No flop no drop |

練習模式：最低 RM 10、最高 RM 100,000（不設實質上限）。

## 4. 莊家優勢總表（排行榜用，`best: true` 為卡片與排行榜顯示值）
| 遊戲 | 注別 | 優勢 | 備註 |
|------|------|------|------|
| video-poker | Jacks or Better 9/6 最佳策略 | 0.46% | RTP 99.54% |
| blackjack | 基本策略（6 副、S17、DAS、無投降） | 0.41% | |
| baccarat | 莊 Banker（5% 佣） | 1.06% | 閒 1.24%；和 8:1 14.36%；對子 11:1 10.36% |
| baccarat/super6 | 莊（免佣、贏 6 點半賠） | 1.46% | Super 6 旁注 12:1 29.98% |
| baccarat/tiger | 莊（贏 6 點半賠） | 1.46% | Tiger 7.66%、Big Tiger 6.03%、Small Tiger 5.36%、Tiger Tie 9.9%、Tiger Pair 8.9%（近似） |
| casino-holdem | Ante | 2.16% | AA 旁注 6.26% |
| ultimate-holdem | Ante（最佳策略） | 2.19% | Trips 3.50%（本桌賠付表 50/40/30/8/7/4/3） |
| three-card-poker | Pair Plus（1-4-6-30-40） | 2.32% | Ante/Play 3.37% |
| fantan | 念 Nim / 角 Kwok（5% 佣） | 2.50% | 單雙 2.50%；三門 Nga Tan（1:3）1.25%；番 Fan 3.75% |
| roulette | 所有注（單零） | 2.70% | |
| sicbo | 大 / 小 Big / Small | 2.78% | 單點 7.87%；全圍 13.89%；圍骰（180:1）16.20%；組合 16.67%；雙骰 18.52%；總點 9.72%–18.98%（9/12 最高） |
| paigow-poker | 玩家不做莊 | 2.84% | Fortune 旁注 ≈ 8.6%（模擬） |
| three-pictures | 主注 | ≈4.2%（模擬值；精確枚舉 4.17%） | 比點數 → 公數，全同莊贏（不比單張）；莊 9 點/三公贏收 2/3 倍 |
| caribbean-stud | Ante（最佳策略） | 5.22% | 累積獎金旁注：獎池 RM 100,000 時 ≈ 86%，需 RM 1.58M 才打平 |
| slot-holdspin | 總體 | 5.5% | RTP 94.5% |
| slot-video | 總體 | 6.0% | RTP 94.0% |
| slot-progressive | 總體（最大注） | 8.0% | RTP 92.0%（非最大注更低） |
| slot-classic | 總體 | 10.0% | RTP 90.0% |
| poker-room | 無莊家優勢 | 抽水 5%（≤ RM 50） | 排行榜最下方另列 |

## 5. 荷官口令（所有遊戲共用；遊戏規格可補充）
| 時機 | 中文 | English |
|------|------|---------|
| 開始下注 | 請下注 | Place your bets |
| 停止下注 | 停止下注 | No more bets |
| 發牌 | 發牌 | Cards coming / Dealing |
| 咪牌時要牌 | 請開牌 | Card please |
| 結算 | 派彩 | Paying out |
| 洗牌 | 洗牌 | Shuffling |
| 撲克桌遊叫牌 | 請決定：跟 或 棄 | Play or fold? |

## 6. 「不能碰籌碼」的時機（教學必講）
- 「No more bets」之後到派彩完成前，不可碰任何桌上籌碌。
- 荷官派彩時不可伸手拿籌碌；等荷官說「派彩完成」或手勢示意。
- 21 點：手牌只能用手勢（加牌：點桌；停牌：手橫掃；加倍/分牌：加籌碼在旁邊，比 1 或 2）。真實模式動作列按鈕標示手勢文字。
- 撲克桌遊：Ante 放好後不可再碰，只能在指定格加 Play/Raise。

## 7. 牌值速查
- 百家樂/三公：A=1，2–9 面值，10/J/Q/K=0（三公中 J/Q/K 為「公 Picture」）。
- 21 點：A=1 或 11，J/Q/K=10。
- 撲克：2 < 3 < … < K < A；A 可作 A-2-3-4-5 最小順。
