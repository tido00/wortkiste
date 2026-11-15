// lesson.js: the guided daily lesson (SPEC Part C). Pure functions, no DOM.
// Steps: warm-up -> reviews -> new words -> challenge -> finish, with "Skip to…".

import { State, retrievability } from './srs.js';

export const STEPS = Object.freeze([
  { id: 'warmup', title: 'Warm-up' },
  { id: 'reviews', title: 'Reviews' },
  { id: 'new', title: 'New words' },
  { id: 'challenge', title: 'Challenge' },
  { id: 'finish', title: 'Finish' },
]);
export const WARMUP_SIZE = 3;
export const CHALLENGE_SIZE = 5;

// Up to `count` learnt word notes (n, w, v, p) that are not due today, best remembered first.
export function pickWarmup({ notes, states, byNote, now, exclude = new Set(), count = WARMUP_SIZE, dayDiff }) {
  const scored = [];
  for (const n of notes) {
    if (!['n', 'w', 'v', 'p'].includes(n.type) || exclude.has(n.id)) continue;
    let best = -1;
    for (const c of byNote.get(n.id) || []) {
      const st = states[c.id];
      if (!st || st.state !== State.Review) continue;
      best = Math.max(best, retrievability(st, now, undefined, { dayDiff }));
    }
    if (best >= 0) scored.push({ n, r: best });
  }
  return scored.sort((a, b) => b.r - a.r).slice(0, count).map((x) => x.n);
}

// Counts per step. `done` = { warmup, challenge, finished } for today.
// Once today's lesson is finished, only leftover cards (if any) bring it back.
export function planLesson({ reviews = 0, news = 0, warmup = 0, challenge = 0, done = {} }) {
  const counts = {
    warmup: done.warmup || done.finished ? 0 : warmup,
    reviews,
    new: news,
    challenge: done.challenge || done.finished ? 0 : Math.min(CHALLENGE_SIZE, challenge),
    finish: 1,
  };
  return STEPS.map((s) => ({ ...s, count: counts[s.id] }));
}

// Next step with something in it after index `from` (-1 = start). Always ends at finish.
export function nextStep(plan, from = -1) {
  for (let i = from + 1; i < plan.length; i++) if (plan[i].count > 0) return i;
  return plan.length - 1;
}

// Does today still have lesson work? (finish alone does not count)
export const hasWork = (plan) => plan.some((s) => s.id !== 'finish' && s.count > 0);

export function minutesFor(plan) {
  const c = Object.fromEntries(plan.map((s) => [s.id, s.count]));
  const sec = c.warmup * 8 + c.reviews * 8 + c.new * 40 + c.challenge * 10;
  return Math.max(1, Math.round(sec / 60));
}
