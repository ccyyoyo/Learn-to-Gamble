// 輪盤 Roulette：spot 集合、賠率、EV、結算、真實模式限注、教學規範。規格：docs/05-game-rules/roulette.md
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ games: ['roulette'] });
const def = LG.games.roulette;
const L = def.logic;

const SPEC_WHEEL = '0 32 15 19 4 21 2 25 17 34 6 27 13 36 11 30 8 23 10 5 24 16 33 1 20 14 31 9 22 18 29 7 28 12 35 3 26'.split(' ').map(Number);
const SPEC_RED = '1 3 5 7 9 12 14 16 18 19 21 23 25 27 30 32 34 36'.split(' ').map(Number);
const ids = [...L.SPOTS.keys()];
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

test('roulette 註冊、houseEdge、限注', () => {
  assert.equal(def.category, 'table');
  const best = LG.bestEdge(def);
  assert.equal(best.edge, 2.70);
  assert.equal(best.best, true);
  assert.ok(def.houseEdge.every((h) => h.edge === 2.70));
  assert.deepEqual(LG.limitsFor(def, 'real'), { min: 25, max: 3000 });
  assert.deepEqual(LG.limitsFor(def, 'practice'), { min: 10, max: 100000 });
  assert.equal(def.countdown, 20);
});

test('輪盤順序陣列與規格一致；紅黑集合正確', () => {
  assert.deepEqual([...L.WHEEL], SPEC_WHEEL);
  assert.equal(new Set(L.WHEEL).size, 37);
  assert.deepEqual([...L.WHEEL].sort((a, b) => a - b), range(0, 36));
  assert.deepEqual([...L.RED], SPEC_RED);
  assert.deepEqual([...L.spotNumbers('red')], SPEC_RED);
  assert.deepEqual([...L.spotNumbers('black')], range(1, 36).filter((n) => !SPEC_RED.includes(n)));
  assert.equal(L.colorOf(0), 'green');
  assert.equal(L.colorOf(17), 'black');
  assert.equal(L.colorOf(19), 'red');
  // 輪盤上紅黑交錯（0 之外相鄰兩格顏色不同）
  for (let i = 1; i < 36; i++) assert.notEqual(L.colorOf(L.WHEEL[i]), L.colorOf(L.WHEEL[i + 1]), `wheel ${i}`);
});

test('spot 數量：145 內注（37 直 + 60 分 + 12 街 + 2 三數 + 22 角 + 1 首四 + 11 線）+ 12 外注 = 157', () => {
  const count = {};
  for (const s of L.SPOTS.values()) count[s.type] = (count[s.type] || 0) + 1;
  assert.deepEqual(count, { straight: 37, split: 60, street: 12, trio: 2, corner: 22, first4: 1, line: 11, even: 6, dozen: 3, column: 3 });
  assert.equal(ids.length, 157);
  assert.equal(ids.filter((id) => L.SPOTS.get(id).inside).length, 145);
});

test('枚舉全部 spot：集合大小 ↔ 賠率（1→35, 2→17, 3→11, 4→8, 6→5, 12→2, 18→1），號碼 0–36', () => {
  const ODDS_BY_SIZE = { 1: 35, 2: 17, 3: 11, 4: 8, 6: 5, 12: 2, 18: 1 };
  for (const id of ids) {
    const nums = L.spotNumbers(id);
    assert.ok(Array.isArray(nums) && nums.length > 0, id);
    assert.equal(new Set(nums).size, nums.length, `${id} 無重複`);
    assert.ok(nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 36), id);
    assert.equal(L.payout(id), ODDS_BY_SIZE[nums.length], `${id} 賠率`);
    assert.equal(nums.length * (L.payout(id) + 1), 36, `${id} 公平賠率 36/n − 1`);
  }
  assert.equal(L.spotNumbers('nope'), null);
  assert.equal(L.payout('nope'), null);
});

test('spotId 命名與號碼集合（幾何獨立驗證）', () => {
  const row = (n) => Math.ceil(n / 3), col = (n) => (n - 1) % 3;
  for (let n = 0; n <= 36; n++) assert.deepEqual([...L.spotNumbers(`n-${n}`)], [n]);
  // 分注：同排左右相鄰，或上下相鄰；0 與 1/2/3
  const splits = ids.filter((id) => id.startsWith('split-'));
  assert.equal(splits.length, 60);
  for (const id of splits) {
    const [a, b] = id.split('-').slice(1).map(Number);
    assert.ok(a < b, `${id} 小號在前`);
    assert.deepEqual([...L.spotNumbers(id)], [a, b]);
    const ok = a === 0 ? [1, 2, 3].includes(b) : (b - a === 1 && row(a) === row(b)) || b - a === 3;
    assert.ok(ok, `${id} 相鄰`);
  }
  // 街注
  for (let r = 1; r <= 12; r++) assert.deepEqual([...L.spotNumbers(`street-${3 * r - 2}`)], [3 * r - 2, 3 * r - 1, 3 * r]);
  // 角注：左上最小號 n，{n, n+1, n+3, n+4}
  const corners = ids.filter((id) => /^corner-\d+$/.test(id) && id !== 'corner-0');
  assert.equal(corners.length, 22);
  for (const id of corners) {
    const n = Number(id.split('-')[1]);
    assert.ok(col(n) < 2 && row(n) < 12, id);
    assert.deepEqual([...L.spotNumbers(id)], [n, n + 1, n + 3, n + 4]);
  }
  assert.deepEqual([...L.spotNumbers('corner-17')], [17, 18, 20, 21]);
  assert.deepEqual([...L.spotNumbers('corner-0')], [0, 1, 2, 3]);
  // 線注
  for (let r = 1; r <= 11; r++) { const s = 3 * r - 2; assert.deepEqual([...L.spotNumbers(`line-${s}`)], range(s, s + 5)); }
  assert.deepEqual([...L.spotNumbers('line-16')], [16, 17, 18, 19, 20, 21]);
  assert.deepEqual([...L.spotNumbers('trio-0-1-2')], [0, 1, 2]);
  assert.deepEqual([...L.spotNumbers('trio-0-2-3')], [0, 2, 3]);
  assert.deepEqual([...L.spotNumbers('split-0-1')], [0, 1]);
  // 外注
  assert.deepEqual([...L.spotNumbers('odd')], range(1, 36).filter((n) => n % 2));
  assert.deepEqual([...L.spotNumbers('even')], range(1, 36).filter((n) => n % 2 === 0));
  assert.deepEqual([...L.spotNumbers('low')], range(1, 18));
  assert.deepEqual([...L.spotNumbers('high')], range(19, 36));
  assert.deepEqual([...L.spotNumbers('dozen-2')], range(13, 24));
  assert.deepEqual([...L.spotNumbers('col-1')], range(1, 36).filter((n) => n % 3 === 1));
  assert.deepEqual([...L.spotNumbers('col-3')], range(1, 36).filter((n) => n % 3 === 0));
  // 0 不在任何外注
  for (const id of ids) if (!L.SPOTS.get(id).inside) assert.ok(!L.spotNumbers(id).includes(0), id);
});

test('EV：37 個結果 × 所有 spot，每注 = −2.70%（= −1/37）', () => {
  for (const id of ids) {
    let net = 0;
    for (let n = 0; n <= 36; n++) net += L.settle([[id, 1]], n).net;
    const ev = net / 37;
    assert.ok(Math.abs(ev - (-1 / 37)) < 1e-9, `${id} EV ${ev}`);
    assert.equal((-ev * 100).toFixed(2), '2.70');
  }
});

test('派彩：直注中 RM 10 → +350；紅注遇 0 → 輸；外注遇 0 全輸', () => {
  let r = L.settle([['n-17', 10]], 17);
  assert.deepEqual([r.wagered, r.returned, r.net], [10, 360, 350]);
  assert.match(r.lines[0].formula, /RM 10 × 35 = \+RM 350/);
  assert.match(r.lines[0].formula, /拿回 RM 360/);
  r = L.settle([['red', 25]], 0);
  assert.deepEqual([r.returned, r.net], [0, -25]);
  assert.equal(r.lines[0].win, false);
  r = L.settle(['red', 'black', 'odd', 'even', 'low', 'high', 'dozen-1', 'col-1'].map((s) => [s, 25]), 0);
  assert.equal(r.net, -200);
  r = L.settle([['split-17-20', 10]], 20);
  assert.equal(r.net, 170);
  r = L.settle([['corner-0', 10]], 0);
  assert.equal(r.net, 80);
});

test('5 種內注 + 3 種外注同一球結算正確；派彩順序外注 → 內注', () => {
  const entries = [['n-17', 10], ['split-17-20', 10], ['street-16', 10], ['corner-17', 10], ['line-16', 10],
    ['red', 25], ['dozen-2', 25], ['col-2', 25]];
  // 17 黑：直+分+街+角+線 中；紅輸；第 2 打中；第 2 列（2,5,…,17）中
  let r = L.settle(entries, 17);
  assert.equal(r.wagered, 125);
  assert.equal(r.net, 350 + 170 + 110 + 80 + 50 - 25 + 50 + 50);
  assert.deepEqual(r.lines.slice(0, 3).map((l) => l.spot), ['red', 'dozen-2', 'col-2']);
  // 21 紅：角、線中；紅中；第 2 打中；21 是第 3 列
  r = L.settle(entries, 21);
  assert.equal(r.net, -10 - 10 - 10 + 80 + 50 + 25 + 50 - 25);
  // 0：全輸
  r = L.settle(entries, 0);
  assert.equal(r.net, -125);
});

test('荷官報號（中/英）與號碼描述', () => {
  assert.deepEqual(L.announce(17), { zh: '17 黑 單', en: 'Seventeen black odd' });
  assert.deepEqual(L.announce(0), { zh: '0 綠', en: 'Zero green' });
  assert.equal(L.announce(32).en, 'Thirty-two red even');
  assert.equal(L.numberWord(20), 'Twenty');
  assert.match(L.describe(17), /第 2 打 · 第 2 列/);
});

function fakeCtx(mode = 'tutorial') {
  const isReal = mode === 'real';
  return {
    gameId: 'roulette', def, mode, variant: null, limits: LG.limitsFor(def, mode), denoms: def.denoms,
    bank: LG.bank, stats: LG.stats, hints: false, isReal, isPractice: mode === 'practice', isTutorial: mode === 'tutorial',
    alive: () => true, on() {}, wait: () => Promise.resolve(), later() {}, explain() {}, recordRound() {},
    dealer: { say() {} }, bettingWindow: () => ({ cancel() {} }), nextRound() {}, checkBroke: () => false, strategyPanel() {},
  };
}

test('真實模式限注：外注 25–3,000、內注每格 ≥ 10、內注合計 ≥ 25、直注 ≤ 500', () => {
  const inst = def.create(fakeCtx('real'));
  const b = inst.bets;
  assert.equal(b.place('n-17', 500).ok, true);
  const over = b.place('n-17', 10);
  assert.equal(over.ok, false);
  assert.equal(over.reason, 'ABOVE_MAX');
  b.clear();
  // 外注低於 25
  b.place('red', 10);
  let v = b.validate();
  assert.equal(v.ok, false);
  assert.match(v.zh, /RM 25/);
  b.place('red', 15);
  assert.equal(b.validate().ok, true);
  assert.equal(b.place('red', 3000).ok, false, '外注上限 3,000');
  b.clear();
  // 內注合計 < 25
  b.place('n-17', 10); b.place('split-17-20', 10);
  v = b.validate();
  assert.equal(v.ok, false);
  assert.match(v.zh, /內注合計最低 RM 25/);
  b.place('corner-17', 10);
  assert.equal(b.validate().ok, true);
  // 外注 + 內注混合：內注合計仍需 ≥ 25
  b.clear(); b.place('red', 25); b.place('n-0', 10);
  assert.equal(b.validate().ok, false);
  b.clear();
  assert.equal(b.validate().ok, false, '沒下注');
});

test('練習模式：每格 RM 10 起，無內注合計限制', () => {
  const inst = def.create(fakeCtx('practice'));
  inst.bets.place('n-17', 10);
  assert.equal(inst.bets.validate().ok, true);
});

test('教學 ≥ 14 步、四段、每種內注各一個 action 步、highlight 指向存在的 spot', () => {
  const inst = def.create(fakeCtx('tutorial'));
  const steps = inst.tutorialSteps();
  const lint = LG.tutorial.lint(steps, { minSteps: 14 });
  assert.deepEqual(lint.problems, []);
  // 每段開頭是「這段你會學到」
  for (const sec of ['layout', 'flow', 'payout', 'strategy']) {
    const first = steps.find((s) => s.section === sec);
    assert.match(first.title, /這段你會學到/, sec);
  }
  // 每種內注放法各一步（action）
  const placed = steps.filter((s) => s.action && s.section === 'layout')
    .map((s) => s.highlight[0].match(/data-bet="([^"]+)"/)[1]);
  const types = new Set(placed.map((id) => L.SPOTS.get(id).type));
  assert.deepEqual([...types].sort(), ['corner', 'first4', 'line', 'split', 'straight', 'street', 'trio']);
  // action.check：沒放 → 提示字串；放了 → true
  const st = steps.find((s) => s.id === 'layout-split');
  assert.equal(typeof st.action.check(inst), 'string');
  inst.bets.place('split-17-20', 10);
  assert.equal(st.action.check(inst), true);
  // highlight 中的 data-bet 都存在
  for (const s of steps) for (const sel of s.highlight || []) {
    const m = sel.match(/data-bet="([^"]+)"/);
    if (m) assert.ok(L.SPOTS.has(m[1]), `${s.id} → ${m[1]}`);
  }
  // body ≤ 80 中文字（表格除外）
  for (const s of steps) {
    const txt = s.body.replace(/<table[\s\S]*<\/table>/, '').replace(/<[^>]+>/g, '');
    const zh = (txt.match(/[一-鿿]/g) || []).length;
    assert.ok(zh <= 80, `${s.id} 中文字 ${zh}`);
  }
  // 不教迷信：熱門號步驟標示只是紀錄
  assert.match(steps.find((s) => s.id === 'strategy-hot').body, /只是紀錄，不能預測/);
  assert.match(steps.find((s) => s.id === 'strategy-budget').body, /RM 500/);
});

test('[slow] Monte Carlo：紅注 20 萬球優勢 ≈ 2.70%', () => {
  LG.rng.seed(123);
  let net = 0;
  const N = 200000;
  for (let i = 0; i < N; i++) net += L.settle([['red', 1]], LG.rng.int(0, 36)).net;
  LG.rng.seed(null);
  const edge = (-net / N) * 100;
  assert.ok(edge > 2.0 && edge < 3.4, `edge ${edge}`);
});
