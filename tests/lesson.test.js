import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeckFile } from '../decks.js';
import { buildCardIndex } from '../queue.js';
import { newCardState, State } from '../srs.js';
import { pickWarmup, planLesson, nextStep, hasWork, STEPS } from '../lesson.js';

const DAY = 86400000;
const now = new Date(2026, 10, 16, 10).getTime();
const notes = parseDeckFile('#deck | T | T | 1\n' + [
  'n :: der Tisch :: table :: la table', 'n :: die Lampe :: lamp :: la lampe', 'w :: auch :: too :: aussi',
  'p :: Hallo! :: Hi! :: Salut !', 'c :: Ich {{bin}} da. :: I am here. :: Je suis là.', 'v :: lernen :: to learn :: apprendre',
].join('\n'), 't').notes;
const { byNote } = buildCardIndex(notes);
const rev = (stability, lastDaysAgo) => ({ ...newCardState(), state: State.Review, stability, difficulty: 5, reps: 3, lastReview: now - lastDaysAgo * DAY, due: now + 5 * DAY });

test('warm-up: learnt word notes only, best remembered first, excluding today\'s due notes', () => {
  const [tisch, lampe, auch, hallo, cloze, lernen] = notes;
  const states = {
    [byNote.get(tisch.id)[0].id]: rev(30, 1),
    [byNote.get(lampe.id)[0].id]: rev(2, 6),
    [byNote.get(auch.id)[0].id]: rev(10, 1),
    [byNote.get(cloze.id)[0].id]: rev(50, 1),       // cloze: never in warm-up
    [byNote.get(hallo.id)[0].id]: rev(40, 1),
    [byNote.get(lernen.id)[0].id]: { ...newCardState(), state: State.Learning, stability: 1, difficulty: 5, lastReview: now, due: now },
  };
  const w = pickWarmup({ notes, states, byNote, now, exclude: new Set([hallo.id]) });
  assert.deepEqual(w.map((n) => n.german), ['der Tisch', 'auch', 'die Lampe']);
  assert.deepEqual(pickWarmup({ notes, states: {}, byNote, now }), []);
});

test('lesson plan: steps in order; empty steps are skipped; finish always last', () => {
  const plan = planLesson({ reviews: 12, news: 8, warmup: 3, challenge: 9 });
  assert.deepEqual(plan.map((s) => s.id), STEPS.map((s) => s.id));
  assert.deepEqual(plan.map((s) => s.count), [3, 12, 8, 5, 1]);
  assert.equal(nextStep(plan), 0);
  assert.equal(nextStep(plan, 0), 1);

  const day1 = planLesson({ reviews: 0, news: 8, warmup: 0, challenge: 0 });
  assert.equal(day1[nextStep(day1)].id, 'new');
  assert.equal(day1[nextStep(day1, 2)].id, 'finish');
});

test('warm-up and challenge run once per day', () => {
  const plan = planLesson({ reviews: 4, news: 0, warmup: 3, challenge: 6, done: { warmup: true, challenge: true } });
  assert.equal(plan[nextStep(plan)].id, 'reviews');
  assert.equal(plan[nextStep(plan, 1)].id, 'finish');
  assert.ok(hasWork(plan));
  assert.ok(!hasWork(planLesson({ reviews: 0, news: 0, warmup: 3, challenge: 6, done: { warmup: true, challenge: true } })));
});

test('after finishing today, warm-up and challenge do not bring the lesson back', () => {
  const plan = planLesson({ reviews: 0, news: 0, warmup: 3, challenge: 5, done: { finished: true } });
  assert.ok(!hasWork(plan));
  const leftovers = planLesson({ reviews: 2, news: 0, warmup: 3, challenge: 5, done: { finished: true } });
  assert.equal(leftovers[nextStep(leftovers)].id, 'reviews');
});
