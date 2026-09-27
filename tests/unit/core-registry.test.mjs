// 核心：registry 的變體別優勢（variants[i].houseEdge）、limitsFor、gameList 排序（Wave 3 整合）
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ games: ['baccarat', 'sicbo', 'poker-room'] });

test('bestEdge：無 variantId 用 def.houseEdge；有 variantId 用 variants[i].houseEdge', () => {
  const def = LG.games.baccarat;
  assert.equal(LG.bestEdge(def).edge, 1.06);
  assert.equal(LG.bestEdge(def, 'classic').edge, 1.06);
  assert.equal(LG.bestEdge(def, 'squeeze').edge, 1.06);
  assert.equal(LG.bestEdge(def, 'super6').edge, 1.46);
  assert.equal(LG.bestEdge(def, 'tiger').edge, 1.46);
  assert.equal(LG.bestEdge(def, 'nope').edge, 1.06, '未知變體回到 def');
  assert.ok(LG.edgesFor(def, 'tiger').some((x) => x.bet.en === 'Big Tiger'));
  assert.ok(!LG.edgesFor(def, 'classic').some((x) => x.bet.en === 'Super 6'));
  const v = LG.variantEdges(def);
  assert.deepEqual(v.map((x) => [x.variant.id, x.best.edge]), [['classic', 1.06], ['super6', 1.46], ['tiger', 1.46], ['squeeze', 1.06]]);
  assert.deepEqual(LG.variantEdges(LG.games.sicbo), [], '沒有變體別優勢');
});

test('gameList 依 order 排序；poker-room limitsLabel', () => {
  assert.deepEqual(LG.gameList('table').map((d) => d.id), ['baccarat', 'sicbo']);
  assert.equal(LG.games['poker-room'].limitsLabel, '買入 RM 400–1,000 · 盲注 RM 5/10');
  assert.deepEqual(LG.limitsFor(LG.games['poker-room'], 'real'), { min: 400, max: 1000 });
});
