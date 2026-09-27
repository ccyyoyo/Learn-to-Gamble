// 示範遊戲 _demo：結算邏輯與教學步驟規範（也是遊戲代理寫單元測試的範例）
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const CORE = ['00-', '01-', '02-', '03-', '04-', '05-', '06-', '20-', '21-', '22-', '30-', '31-', '32-', '33-', '40-', '50-'];
const LG = loadLG({ core: CORE, games: ['_demo'] });
const def = LG.games._demo;
const { settle, outcomeOf, PAYS } = def.logic;
const C = (id) => ({ rank: id[0], suit: id[1], id });

test('_demo 註冊與 houseEdge', () => {
  assert.equal(def.category, 'table');
  assert.equal(LG.bestEdge(def).edge, 3.08);
  assert.deepEqual(LG.limitsFor(def, 'real'), { min: 25, max: 500 });
  assert.deepEqual(LG.limitsFor(def, 'tutorial'), { min: 10, max: 100000 });
});

test('_demo settle：大贏 0.8、小贏 1.1、兩邊押', () => {
  assert.equal(outcomeOf(C('8S')), 'hi');
  assert.equal(outcomeOf(C('7S')), 'lo');
  assert.equal(outcomeOf(C('AS')), 'hi');
  let r = settle([['hi', 100]], C('QH'));
  assert.deepEqual([r.returned, r.net], [180, 80]);
  r = settle([['lo', 25]], C('2C'));
  assert.deepEqual([r.returned, r.net], [52.5, 27.5]);
  r = settle([['hi', 100], ['lo', 25]], C('TD'));
  assert.deepEqual([r.wagered, r.returned, r.net], [125, 180, 55]);
  assert.match(r.lines[0].formula, /RM 100 × 0.8 = \+RM 80/);
});

test('_demo 莊家優勢 = 3.08%（精確計算）', () => {
  const pHi = 7 / 13, pLo = 6 / 13;
  const evHi = pHi * PAYS.hi - pLo;
  const evLo = pLo * PAYS.lo - pHi;
  assert.ok(Math.abs(-evHi * 100 - 3.08) < 0.01);
  assert.ok(Math.abs(-evLo * 100 - 3.08) < 0.01);
});

test('_demo 教學步驟符合規範（≥12 步、四段、≥3 action）', () => {
  const inst = def.create({ ...fakeCtx() });
  const steps = inst.tutorialSteps();
  const lint = LG.tutorial.lint(steps);
  assert.deepEqual(lint.problems, []);
  assert.ok(lint.ok);
});

function fakeCtx() {
  return {
    gameId: '_demo', def, mode: 'tutorial', variant: 'classic', limits: { min: 10, max: 100000 }, denoms: def.denoms,
    bank: LG.bank, stats: LG.stats, hints: false, isReal: false, isPractice: false, isTutorial: true,
    alive: () => true, on() {}, wait: () => Promise.resolve(), later() {}, explain() {}, recordRound() {},
    dealer: { say() {} }, bettingWindow: () => ({ cancel() {} }), nextRound() {}, checkBroke: () => false, strategyPanel() {},
  };
}
