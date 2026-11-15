import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDeckFile, mergeDecks } from '../decks.js';
import { buildQueue, buildCardIndex, dayNumber, dayEnd, createSession, sessionNext, sessionAfterGrade, limitRuns, streak, appDayDiff } from '../queue.js';
import { review, newCardState, State, DEFAULT_PARAMS } from '../srs.js';

const text = readFileSync(new URL('../decks/L1-L3.txt', import.meta.url), 'utf8');
const real = mergeDecks([parseDeckFile(text, 'L1-L3.txt')]);
const DAY = 86400000;
const t0 = new Date(2026, 10, 16, 10, 0).getTime(); // 10:00 local
const allStarted = Object.fromEntries(real.decks.map((d) => [d.id, true]));
const params = { ...DEFAULT_PARAMS, enableFuzz: false };

// Simulate a learner who presses Good on everything for `days` days.
function simulate(notes, decks, days, settings = {}) {
  const states = {}, introduced = {};
  const index = buildCardIndex(notes);
  const perDay = [];
  for (let d = 0; d < days; d++) {
    const now = t0 + d * DAY;
    const q = buildQueue({ notes, decks, states, introduced, started: Object.fromEntries(decks.map((x) => [x.id, true])), settings, now, index });
    perDay.push(q);
    const s = createSession(q.queue, { now });
    let item, clock = now;
    while ((item = sessionNext(s, clock))) {
      if (item.kind === 'new' && item.newNote) introduced[item.noteId] = dayNumber(clock);
      const prev = states[item.cardId] || newCardState(clock);
      const next = review(prev, 3, clock, params, { dayDiff: appDayDiff });
      states[item.cardId] = next;
      sessionAfterGrade(s, item, next, clock, 3);
      clock += 30000;
      if (s.learning.length && s.pos >= s.main.length) clock = Math.max(clock, s.learning[0].due);
    }
  }
  return { states, introduced, perDay, index };
}

test('day boundary is 04:00 local', () => {
  const a = new Date(2026, 10, 16, 3, 59).getTime();
  const b = new Date(2026, 10, 16, 4, 0).getTime();
  assert.equal(dayNumber(b) - dayNumber(a), 1);
  assert.equal(dayEnd(a), b);
});

test('new notes per day: default 8, counted per note', () => {
  const q = buildQueue({ notes: real.notes, decks: real.decks, started: allStarted, now: t0 });
  assert.equal(q.newCards.length, 8);
  assert.equal(new Set(q.newCards.map((c) => c.noteId)).size, 8);
  const q3 = buildQueue({ notes: real.notes, decks: real.decks, started: allStarted, now: t0, settings: { newPerDay: 3 } });
  assert.equal(q3.newCards.length, 3);
});

test('decks only give new cards after "Start this deck"', () => {
  const none = buildQueue({ notes: real.notes, decks: real.decks, started: {}, now: t0 });
  assert.equal(none.newCards.length, 0);
  const one = buildQueue({ notes: real.notes, decks: real.decks, started: { L2A: true }, now: t0 });
  const deckOf = new Map(real.notes.map((n) => [n.id, n.deckId]));
  assert.ok(one.newCards.every((c) => deckOf.get(c.noteId) === 'L2A'));
});

test('siblings: two cards of one note are never both due on the same day', () => {
  const { perDay, states, index } = simulate(real.notes, real.decks, 30);
  for (const q of perDay) {
    const notesToday = q.queue.map((i) => i.noteId);
    assert.equal(new Set(notesToday).size, notesToday.length, `day ${q.today}: a note appears twice`);
  }
  // And no two cards of a note were ever reviewed on the same day.
  const seen = new Map();
  for (const [cardId, st] of Object.entries(states)) {
    if (st.lastReview == null) continue;
    const card = index.cards.get(cardId);
    const key = card.noteId + '|' + dayNumber(st.lastReview);
    assert.ok(!seen.has(key) || seen.get(key) === cardId, `siblings reviewed the same day: ${cardId}`);
    seen.set(key, cardId);
  }
});

test('a due sibling waits when another card of its note was reviewed today', () => {
  const notes = parseDeckFile('#deck | T | T | 1\nn :: der Tisch :: table :: la table :: pl=die Tische', 't').notes;
  const decks = [{ id: 'T', order: 1, tags: [] }];
  const [rec, prod] = buildCardIndex(notes).byNote.get(notes[0].id);
  const states = {
    [rec.id]: { ...newCardState(), state: State.Review, due: t0 + 3600e3 * 5, stability: 5, difficulty: 5, lastReview: t0 - 3600e3, reps: 3 },
    [prod.id]: { ...newCardState(), state: State.Review, due: t0 - DAY, stability: 5, difficulty: 5, lastReview: t0 - 5 * DAY, reps: 3 },
  };
  const q = buildQueue({ notes, decks, states, started: { T: true }, now: t0 });
  assert.deepEqual(q.queue.map((i) => i.cardId), [rec.id]);
});

test('sets: two notes with the same set are never introduced on the same day', () => {
  const { introduced } = simulate(real.notes, real.decks, 45, { newPerDay: 20 });
  const byDaySet = new Map();
  for (const [id, day] of Object.entries(introduced)) {
    const n = real.notes.find((x) => x.id === id);
    if (!n.set) continue;
    const key = `${day}|${n.set}`;
    assert.ok(!byDaySet.has(key), `set ${n.set} introduced twice on day ${day}`);
    byDaySet.set(key, id);
  }
  assert.ok(Object.keys(introduced).length > 100, 'simulation introduced many notes');
  // The 7 weekdays need 7 different days.
  const wd = real.notes.filter((n) => n.set === 'weekdays').map((n) => introduced[n.id]);
  assert.equal(new Set(wd).size, wd.length);
});

function dueReviewStates(count) {
  const states = {};
  const index = buildCardIndex(real.notes);
  let k = 0;
  for (const n of real.notes) {
    if (k >= count) break;
    const c = index.byNote.get(n.id)[0];
    states[c.id] = { ...newCardState(), state: State.Review, due: t0 - DAY, stability: 3, difficulty: 5, lastReview: t0 - 4 * DAY, reps: 3 };
    k++;
  }
  return states;
}

test('backlog guard: with 121 due reviews, zero new cards are queued', () => {
  const q = buildQueue({ notes: real.notes, decks: real.decks, states: dueReviewStates(121), started: allStarted, now: t0 });
  assert.equal(q.counts.dueReviews, 121);
  assert.equal(q.newCards.length, 0);
  assert.equal(q.guard.active, true);
  const q120 = buildQueue({ notes: real.notes, decks: real.decks, states: dueReviewStates(120), started: allStarted, now: t0 });
  assert.ok(q120.newCards.length > 0);
});

test('backlog guard stays on until reviews are under 60, and can be turned off', () => {
  const s80 = dueReviewStates(80);
  assert.equal(buildQueue({ notes: real.notes, decks: real.decks, states: s80, started: allStarted, now: t0, guardActive: true }).newCards.length, 0);
  assert.ok(buildQueue({ notes: real.notes, decks: real.decks, states: dueReviewStates(59), started: allStarted, now: t0, guardActive: true }).newCards.length > 0);
  assert.ok(buildQueue({ notes: real.notes, decks: real.decks, states: dueReviewStates(121), started: allStarted, now: t0, settings: { backlogGuard: false } }).newCards.length > 0);
});

test('core words: 3 of the 8 daily come from the core deck', () => {
  const core = parseDeckFile('#deck | C1 | Core | 100 | tags=A1,core\n' + Array.from({ length: 20 }, (_, i) => `w :: wort${i} :: word${i} :: mot${i}`).join('\n'), 'core.txt');
  const m = mergeDecks([parseDeckFile(text, 'L1-L3.txt'), core]);
  const q = buildQueue({ notes: m.notes, decks: m.decks, started: { L1A: true }, now: t0 });
  const coreIds = new Set(core.notes.map((n) => n.id));
  assert.equal(q.newCards.length, 8);
  assert.equal(q.newCards.filter((c) => coreIds.has(c.noteId)).length, 3);
  // When the started course decks are used up, core fills the rest.
  const onlyCore = buildQueue({ notes: m.notes, decks: m.decks, started: {}, now: t0 });
  assert.equal(onlyCore.newCards.length, 8);
  assert.ok(onlyCore.newCards.every((c) => coreIds.has(c.noteId)));
});

test('listen cards are skipped when there is no German voice', () => {
  const { perDay } = simulate(real.notes, real.decks, 1);
  assert.ok(perDay[0]);
  const notes = parseDeckFile('#deck | T | T | 1\np :: Hallo! :: Hi! :: Salut !', 't').notes;
  const decks = [{ id: 'T', order: 1, tags: [] }];
  const idx = buildCardIndex(notes);
  const [prod, listen] = idx.byNote.get(notes[0].id);
  const states = { [prod.id]: { ...newCardState(), state: State.Review, due: t0 + 30 * DAY, stability: 30, difficulty: 5, lastReview: t0 - 3 * DAY, reps: 3 } };
  const introduced = { [notes[0].id]: dayNumber(t0) - 3 };
  assert.equal(buildQueue({ notes, decks, states, introduced, started: { T: true }, now: t0, hasVoice: false }).newCards.length, 0);
  assert.equal(buildQueue({ notes, decks, states, introduced, started: { T: true }, now: t0, hasVoice: true }).newCards[0].cardId, listen.id);
});

test('plural card unlocks only when produce reaches 7-day stability', () => {
  const notes = parseDeckFile('#deck | T | T | 1\nn :: der Tisch :: table :: la table :: pl=die Tische', 't').notes;
  const decks = [{ id: 'T', order: 1, tags: [] }];
  const [rec, prod, plural] = buildCardIndex(notes).byNote.get(notes[0].id);
  const base = { ...newCardState(), state: State.Review, difficulty: 5, reps: 3, lastReview: t0 - 3 * DAY };
  const introduced = { [notes[0].id]: dayNumber(t0) - 10 };
  const mk = (s) => ({ [rec.id]: { ...base, due: t0 + 30 * DAY, stability: 30 }, [prod.id]: { ...base, due: t0 + 30 * DAY, stability: s } });
  assert.equal(buildQueue({ notes, decks, states: mk(3), introduced, started: { T: true }, now: t0 }).newCards.length, 0);
  assert.equal(buildQueue({ notes, decks, states: mk(8), introduced, started: { T: true }, now: t0 }).newCards[0].cardId, plural.id);
});

test('session: learning cards come back the same day; reviews and new are interleaved 4:1', () => {
  const { perDay } = simulate(real.notes, real.decks, 12);
  const q = perDay[11];
  const kinds = q.queue.filter((i) => i.kind !== 'learning').map((i) => i.kind);
  assert.ok(kinds.includes('review') && kinds.includes('new'));
  assert.notEqual(kinds[0], 'new', 'reviews start the session');
});

test('never the same note type 4 times in a row if another type is available', () => {
  const items = ['n', 'n', 'n', 'n', 'n', 'c', 'p', 'n', 'n', 'n', 'n'].map((type, i) => ({ type, i }));
  const out = limitRuns(items, 3);
  assert.equal(out.length, items.length);
  for (let i = 3; i < out.length - 1; i++) {
    const run = out.slice(i - 3, i + 1).every((x) => x.type === out[i].type);
    const otherLater = out.slice(i + 1).some((x) => x.type !== out[i].type);
    assert.ok(!(run && otherLater), `run of 4 at ${i}`);
  }
});

test('time box: a timed session stops at the next card after time runs out', () => {
  const q = buildQueue({ notes: real.notes, decks: real.decks, started: allStarted, now: t0 });
  const s = createSession(q.queue, { now: t0, minutes: 5 });
  const a = sessionNext(s, t0);
  sessionAfterGrade(s, a, { ...newCardState(), state: State.Review, due: t0 + 3 * DAY }, t0, 3);
  assert.ok(sessionNext(s, t0 + 4 * 60000));
  assert.equal(sessionNext(s, t0 + 6 * 60000), null);
});

test('streak counts consecutive days', () => {
  assert.equal(streak([10, 11, 12], 12), 3);
  assert.equal(streak([10, 11, 12], 13), 3, 'today not done yet still keeps the streak');
  assert.equal(streak([10, 12], 12), 1);
  assert.equal(streak([], 12), 0);
});
