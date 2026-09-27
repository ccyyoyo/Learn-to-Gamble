# Ultimate Texas Hold'em（id: `ultimate-holdem`）

## 1. 規則
- 1 副牌。開局押 **Ante** 與 **Blind**（同額，必押），可加 **Trips** 旁注。
- 玩家 2 張、莊 2 張暗、公共牌 5 張分三階段翻。
- 決策：
  1. 翻牌前：**Check** 或 **Raise 3× / 4× Ante**（Play 注）
  2. 翻牌後（若尚未 raise）：Check 或 **Raise 2×**
  3. 河牌後（若尚未 raise）：**Raise 1×** 或 **Fold**（輸 Ante+Blind；Trips 仍結算）
- 莊 **合格：一對以上**。不合格：Ante push；Blind/Play 仍比牌。
- 玩家勝：Play 1:1、Ante 1:1（莊合格時）、Blind 依表（順以上才賠，否則 push）。莊勝：輸全部。平手 push。

## 2. 賠付
| Blind | | Trips | |
|---|---|---|---|
| 皇家同花順 | 500:1 | 皇家 | 50:1 |
| 同花順 | 50:1 | 同花順 | 40:1 |
| 四條 | 10:1 | 四條 | 30:1 |
| 葫蘆 | 3:1 | 葫蘆 | 8:1 |
| 同花 | 3:2 | 同花 | 7:1 |
| 順 | 1:1 | 順 | 4:1 |
| 其他勝 | push | 三條 | 3:1 |
Ante 優勢 2.19%（以 Ante 計）；Trips（此表 50/40/30/8/7/4/3）**3.50%**（7 張精確機率；1.90% 對應的是 8/6/5 的另一張表，Wave 3 決議保留此賠付表、改優勢數字）。spotId：`ante`, `blind`, `trips`, `play`。

## 3. 桌面配置
```
┌──────────────────────────────────────┐
│      莊家 DEALER 兩張                 │
│  公共牌 [F][F][F] [T] [R]             │
│      你 YOU 兩張                      │
│  (TRIPS)   (BLIND)  (ANTE)   (PLAY)   │  Blind/Ante 相鄰同大小；Play 在最前
└──────────────────────────────────────┘
動作列依階段：翻牌前 [Check][3×][4×]；翻牌後 [Check][2×]；河牌 [Fold][1×]
```

## 4. 策略（提示用）
- 翻牌前 4×：任 A；K-2s+ / K-5o+；Q-6s+ / Q-8o+；J-8s+ / J-10o；對子 33+。
- 翻牌後 2×：兩對以上；用到手牌的一對（非純公共對）；四張同花且手牌含 10+ 同花。
- 河牌 1×：用到手牌的一對以上 → 1×；否則莊家能贏你的單張 outs（剩餘 45 張中配公共牌嚴格贏過你的張數）< 21 → 1×；否則 Fold。
  （原文「公共牌無對」條件拿掉：照原文優勢約 6.2%，拿掉後約 2.4%，見 `docs/change-requests/ultimate-holdem.md` CR-1。）
- 翻牌後「用到手牌的一對」含口袋 2-2。

## 5. 教學大綱（≥ 14 步）
layout、flow（三階段只能 raise 一次、越早 raise 倍數越大、Blind 必押）、payout（Blind 只在順以上才賠、莊不合格 Ante push 的情境計算）、strategy（表格 + 3 題）。

## 6. 真實模式
Ante/Blind RM 25–500；Trips RM 10–100；每階段 30 秒，超時視為 Check / Fold。

## 7. 驗收測試
- 流程狀態機：raise 後不可再 raise；河牌只能 1× 或 Fold。
- 結算：莊不合格且玩家順 → Ante push、Play +1、Blind +1。
- 4× 表邊界：K-5o 4×，K-4o check；Q-8o 4×，Q-7o check。
- Monte Carlo 優勢 1.5%–3%。
