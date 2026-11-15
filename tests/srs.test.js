import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { review, newCardState, DEFAULT_PARAMS, State, preview } from '../srs.js';

const ref = JSON.parse(readFileSync(new URL('./fsrs-reference.json', import.meta.url), 'utf8'));
const DAY = 86400000;

for (const seq of ref.sequences) {
  test(`FSRS matches ts-fsrs: ${seq.name}${seq.fuzz ? ' (fuzz on)' : ''}`, () => {
    const params = { ...DEFAULT_PARAMS, enableFuzz: seq.fuzz, maximumInterval: 365 };
    let card = newCardState(seq.results[0].now);
    for (const [i, r] of seq.results.entries()) {
      card = review(card, r.rating, r.now, params);
      const where = `step ${i + 1}`;
      // Only intended difference: SPEC caps at 365 days; ts-fsrs can overshoot its cap by a day.
      const refDue = Math.min(r.due, r.now + 365 * DAY);
      assert.ok(Math.abs(card.due - refDue) / DAY <= 0.01, `${where}: due ${new Date(card.due).toISOString()} vs ${new Date(refDue).toISOString()}`);
      assert.ok(Math.abs(card.stability - r.stability) < 1e-6, `${where}: stability ${card.stability} vs ${r.stability}`);
      assert.ok(Math.abs(card.difficulty - r.difficulty) < 1e-6, `${where}: difficulty`);
      assert.equal(card.state, r.state, `${where}: state`);
      assert.equal(card.lapses, r.lapses, `${where}: lapses`);
    }
  });
}

test('learning steps: new card Again = 1 min, Good = 10 min', () => {
  const now = Date.UTC(2026, 0, 1, 10);
  const p = preview(newCardState(now), now, DEFAULT_PARAMS);
  assert.equal(p[1].due - now, 60000);
  assert.equal(p[3].due - now, 600000);
  assert.equal(p[3].state, State.Learning);
  assert.equal(p[4].state, State.Review);
});

test('maximum interval is 365 days', () => {
  let card = newCardState(0);
  let now = Date.UTC(2026, 0, 1, 10);
  for (let i = 0; i < 20; i++) { card = review(card, 4, now, DEFAULT_PARAMS); now = card.due; }
  assert.ok(card.scheduledDays <= 365);
});
