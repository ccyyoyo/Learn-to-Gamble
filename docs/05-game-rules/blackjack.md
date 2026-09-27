# 21 點 Blackjack（id: `blackjack`）

## 1. 規則（雲頂大眾桌近似）
- 6 副牌牌靴，切牌約剩 1 副時重洗。
- 莊家 **軟 17 停牌（S17）**；莊家一張明牌一張暗牌（Hole card），先檢查 BJ 只在明牌為 A 時提供保險。
- Blackjack 賠 3:2；莊 BJ 玩家 BJ → 平手 push。
- 加倍 Double：任兩張可加倍（Double any two），加倍後只拿一張。分牌後可加倍（DAS）。
- 分牌 Split：同點數（10 值皆可）可分，最多分 3 次（4 手）；分 A 只拿一張，分 A 後 A+10 算 21 非 BJ。
- 保險 Insurance：莊明牌 A，可押主注一半，賠 2:1。
- 無投降（No surrender）。爆牌 Bust > 21。
- 平手 push 退注。莊家爆牌所有未爆玩家贏。

## 2. 賠率
| 結果 | 賠付 |
|------|------|
| 贏 | 1:1 |
| Blackjack | 3:2（RM 50 → +75） |
| 保險中 | 2:1 |
| 平手 | push |

## 3. 桌面配置（半圓桌，5 個玩家格；玩家只坐一格，其他格空著顯示以對照現場）
```
┌────────────────────────────────────────────┐
│           莊家 DEALER 牌區  [牌靴 Shoe] [棄牌 Discard] │
│   "BLACKJACK PAYS 3 TO 2 · DEALER STANDS ON SOFT 17"  │  <- 桌面印字，教學要讀給玩家
│   "INSURANCE PAYS 2 TO 1"（弧形保險線）               │
│  (座位1)  (座位2)  [座位3 你 YOU]  (座位4)  (座位5)  │  每格：主注圓圈 + 上方牌位
│   主注圈 [data-bet="main"]  分牌後出現 main-2..main-4；保險格 [data-bet="insurance"]│
└────────────────────────────────────────────┘
動作列：加牌 Hit | 停牌 Stand | 加倍 Double | 分牌 Split | 保險 Insurance / 不保
真實模式按鈕上加手勢文字：Hit「指尖敲桌」Stand「手掌橫掃」Double/Split「加籌碼在旁，比 1 / 2」
```

## 4. 一局流程
1. 下注（真實倒數 15 秒）→ No more bets
2. 發牌：玩家一張、莊明牌、玩家一張、莊暗牌
3. 莊明牌 A → 詢問保險（5 秒）；莊 BJ → 結算
4. 玩家 BJ → 立即賠 3:2（若莊非 A/10）
5. 玩家行動（每手依序），爆牌立即收注
6. 莊家開暗牌、按 S17 補牌
7. 結算；練習：resultPanel 顯示每手：牌/點數/莊點數/結果/賠付式/為什麼（引用策略表）

## 5. 基本策略（6 副、S17、DAS、無投降）— `LG.blackjack.STRATEGY_TABLE`
硬牌 Hard（玩家 vs 莊明牌 2 3 4 5 6 7 8 9 T A）：
```
17+ : S S S S S S S S S S
16  : S S S S S H H H H H
15  : S S S S S H H H H H
13-14: S S S S S H H H H H
12  : H H S S S H H H H H
11  : D D D D D D D D D H   (S17 六副：11 vs A 加牌)
10  : D D D D D D D D H H
9   : H D D D D H H H H H
5-8 : H
```
軟牌 Soft：
```
A9  : S
A8  : S S S S S S S S S S   (S17：A8 vs 6 停)
A7  : S Ds Ds Ds Ds S S H H H   (Ds=加倍否則停)
A6  : H D D D D H H H H H
A4-A5: H H D D D H H H H H
A2-A3: H H H D D H H H H H
```
對子 Pairs：
```
AA  : P 全
TT  : S 全
99  : P P P P P S P P S S
88  : P 全
77  : P P P P P P H H H H
66  : P P P P P H H H H H
55  : 視為 10
44  : H H H P P H H H H H  (DAS)
33  : P P P P P P H H H H
22  : P P P P P P H H H H
```
教學要講：「這張表背 5 條就夠用：12–16 對莊 2–6 停；對 7–A 加牌到 17；11 加倍；A/8 一定分；10/5 不分。」

## 6. 教學大綱（≥ 14 步）
layout：桌面印字含義、主注圈、保險線、牌靴與棄牌盒、座位與「第三壘 Third base」。
flow：下注、發牌順序、暗牌、保險詢問、輪到你時手勢、不能用手碰牌（牌靴桌）、莊家 S17。
payout：BJ 3:2 計算、加倍/分牌需加多少籌碼、保險 2:1 為什麼通常不划算（莊 BJ 機率 ≈ 31%）。
strategy：策略表互動（出 5 題）、預算、不要「跟感覺」、別買保險。

## 7. 練習模式提示
- 提示開啟：動作列上方顯示「建議：停牌 Stand（表：16 vs 6）」，偏離建議時 resultPanel「為什麼」引用表格。

## 8. 真實模式
- 限注 RM 50–3,000；下注倒數 15 秒；行動每手 20 秒無操作 = 停牌。
- 口令：Place your bets / No more bets / Insurance? / Blackjack / Dealer has 19 / Push。

## 9. 驛收測試
- `value()`：A+K = BJ；A+A+9 = 21 soft；K+Q+5 = bust。
- 基本策略表 30 個抽樣格與本文一致。
- dealerPlay：S17 停於 A+6；硬 16 補牌。
- 分牌最多 4 手；分 A 各一張；分 A 後 A+K 賠 1:1。
- Monte Carlo 20 萬手用基本策略：莊家優勢 0.3%–0.7%。
- e2e：加倍、分牌、保險流程可完成。
