import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, normalizeWord, randomIndex } from '../public/assets/engine.js';

function dataset(count = 1005) {
  const words = Array.from({ length: count }, (_, i) => `mot${i}`);
  words[0] = 'étoile'; words[1] = 'astre'; words[2] = 'lune';
  const vectors = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const angle = (i / (count - 1)) * Math.PI;
    vectors[i * 2] = Math.cos(angle);
    vectors[i * 2 + 1] = Math.sin(angle);
  }
  return { id: 'fixture-math-only', words, vectors, dimensions: 2, targets: [0] };
}
function started(data = dataset()) { const game = new Game(data); game.start(); return game; }

test('NFC, accents, case and surrounding whitespace are normalized without ambiguous substitution', () => {
  assert.equal(normalizeWord('  E\u0301TOILE  '), 'étoile');
  assert.notEqual(normalizeWord('etoile'), 'étoile');
  assert.equal(normalizeWord(' deux   mots '), 'deux mots');
});
test('self is 100 and 1000, cold temperatures can be negative', () => {
  const game = started();
  assert.equal(game.scores[0], 100);
  assert.equal(game.ranks[0], 1000);
  assert.equal(game.scores[1004], -100);
  assert.equal(game.ranks[1004], 0);
  assert.equal(game.nearest.length, 1000);
  assert.equal(game.ranks[999], 1);
});
test('rank uses unrounded scores even when displayed temperatures are identical', () => {
  const game = started();
  assert.ok(game.scores[1] > game.scores[2]);
  assert.equal(game.scores[1].toFixed(2), game.scores[2].toFixed(2));
  assert.equal(game.ranks[1], 999);
  assert.equal(game.ranks[2], 998);
});
test('ties follow vocabulary order, target always first even for identical vectors', () => {
  const data = dataset();
  data.vectors.set([1, 0], 2); data.vectors.set([1, 0], 4);
  data.targets = [2];
  const game = started(data);
  assert.deepEqual(game.nearest.slice(0, 3), [2, 0, 1]);
});
test('cosine is symmetric', () => {
  const data = dataset();
  const a = started(data);
  const b = started({ ...data, targets: [340] });
  assert.equal(a.scores[340], b.scores[0]);
});
test('unknown, empty and duplicate guesses never increase attempts', () => {
  const game = started();
  assert.throws(() => game.guess(''), /Écrivez/);
  assert.throws(() => game.guess('etoile'), /dictionnaire/);
  const original = game.guess('  LUNE  ').state.entries[0];
  const before = game.guess('astre');
  const repeated = game.guess('lune');
  assert.equal(repeated.state.attempts, 2);
  assert.equal(repeated.state.lastSequence, 0);
  assert.deepEqual(repeated.state.entries, before.state.entries);
  assert.deepEqual(repeated.snapshot.entries, before.snapshot.entries);
  assert.deepEqual(repeated.state.entries[repeated.state.lastSequence], original);
});
test('winning and losing reveal true top 1000 and prohibit further guesses', () => {
  const game = started();
  const win = game.guess('E\u0301TOILE');
  assert.equal(win.state.outcome, 'won');
  assert.equal(win.state.answer, 'étoile');
  assert.equal(win.state.neighbors[0].progression, 1000);
  assert.equal(win.state.neighbors.length, 1000);
  assert.throws(() => game.hint(), /terminée/);
  game.start();
  const loss = game.giveUp();
  assert.equal(loss.state.outcome, 'given-up');
  assert.equal(loss.state.answer, 'étoile');
  assert.throws(() => game.guess('lune'), /terminée/);
});
test('hints advance, remain distinct, exclude answer, and are counted separately', () => {
  const game = started();
  let best = 0;
  for (let i = 0; i < 8; i++) {
    const result = game.hint();
    const entry = result.state.entries.at(-1);
    assert.notEqual(entry.word, 'étoile');
    if (best < 999) assert.ok(entry.progression > best);
    else assert.ok(entry.progression < 1000); // At rank 999 the next unused hint cannot be closer.
    best = entry.progression;
    assert.equal(result.state.attempts, 0);
    assert.equal(result.state.hints, i + 1);
    const repeated = game.guess(entry.word);
    assert.equal(repeated.state.hints, i + 1);
    assert.equal(repeated.state.attempts, 0);
    assert.deepEqual(repeated.state.entries, result.state.entries);
  }
});
test('re-entering an earlier hint preserves its kind, order and counters', () => {
  const game = started();
  const hint = game.hint().state.entries[0];
  const before = game.guess('lune');
  const repeated = game.guess(hint.word);
  assert.equal(repeated.state.attempts, 1);
  assert.equal(repeated.state.hints, 1);
  assert.equal(repeated.state.lastSequence, 0);
  assert.deepEqual(repeated.state.entries, before.state.entries);
  assert.deepEqual(repeated.state.entries[repeated.state.lastSequence], hint);
  assert.equal(hint.kind, 'hint');
  assert.equal(hint.attempt, null);
});
test('exhausted hints do not reveal the target or mutate the game', () => {
  const game = started(dataset(3));
  game.hint(); game.hint();
  assert.throws(() => game.hint(), /déjà été découverts/);
  assert.equal(game.result().state.hints, 2);
  assert.equal(game.result().state.outcome, 'playing');
});
test('save and restore recalculate scores and preserve all entries, hints and outcome', () => {
  const game = started();
  game.guess('lune'); game.hint();
  const original = game.guess('étoile');
  const copy = new Game(dataset());
  const restored = copy.start(JSON.parse(JSON.stringify(original.snapshot)));
  assert.ok(restored.restored);
  assert.deepEqual(restored.state, original.state);
  assert.deepEqual(restored.snapshot, original.snapshot);
});
test('recalled entries survive reload and old or invalid selections fall back without losing the game', () => {
  const game = started();
  game.guess('lune'); game.guess('astre');
  const recalled = game.guess('  LUNE  ');
  const copy = new Game(dataset());
  const restored = copy.start(JSON.parse(JSON.stringify(recalled.snapshot)));
  assert.ok(restored.restored);
  assert.deepEqual(restored.state, recalled.state);
  for (const lastSequence of [undefined, null, -1, 1005, 0.5, '0']) {
    const fallback = copy.start({ ...recalled.snapshot, lastSequence });
    assert.ok(fallback.restored);
    assert.equal(fallback.state.attempts, 2);
    assert.equal(fallback.state.lastSequence, 1);
    assert.deepEqual(fallback.state.entries, recalled.state.entries);
  }
});
test('incompatible and malformed saves reset safely', () => {
  const game = started();
  const saved = game.guess('lune').snapshot;
  for (const invalid of [
    { ...saved, dataId: 'obsolete' }, { ...saved, target: -1 },
    { ...saved, entries: [{ index: 0, kind: 'hint' }] },
    { ...saved, entries: [...saved.entries, ...saved.entries] },
    { ...saved, outcome: 'won' }, { ...saved, entries: null },
  ]) {
    assert.ok(game.start(invalid).reset);
    assert.equal(game.entries.length, 0);
  }
});
test('random selection rejects biased tail values and can reach each target', () => {
  const draws = [0xffffffff, 2];
  assert.equal(randomIndex(3, () => draws.shift()), 2);
  for (let i = 0; i < 3; i++) assert.equal(randomIndex(3, () => i), i);
  assert.throws(() => randomIndex(0));
  const data = dataset(); data.targets = [0, 1, 2];
  for (let i = 0; i < 3; i++) {
    const game = new Game(data, () => i); game.start(); assert.equal(game.target, i);
  }
});
test('new game clears state and hints', () => {
  const game = started(); game.guess('lune'); game.hint();
  const fresh = game.start();
  assert.equal(fresh.state.attempts, 0);
  assert.equal(fresh.state.hints, 0);
  assert.equal(fresh.state.outcome, 'playing');
  assert.equal(fresh.state.answer, null);
  assert.equal(fresh.state.lastSequence, null);
});
