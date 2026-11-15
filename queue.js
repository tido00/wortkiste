// queue.js: the daily queue. Day boundary, new-note limits, siblings, confusable sets,
// deck unlocking, backlog guard, interleaving and the in-session order. Pure, no DOM.

import { State } from './srs.js';
import { cardsForNote } from './decks.js';

const DAY = 86400000;
export const DAY_START_HOUR = 4;
export const GUARD_ON = 120;
export const GUARD_OFF = 60;
export const LEECH_LAPSES = 6;
export const UNLOCK_STABILITY = 7;
export const MATURE_STABILITY = 21;

export const DEFAULT_SETTINGS = Object.freeze({
  newPerDay: 8,
  corePerDay: 3,
  retention: 0.9,
  backlogGuard: true,
  maxReviews: 0,          // 0 = no cap
  typing: false,
  autoplay: true,
  voice: '',
  rate: 0.9,
});

// ---- Days (04:00 local boundary) ----
export function dayNumber(ms, hour = DAY_START_HOUR) {
  const d = new Date(ms - hour * 3600000);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}
export function dayStart(ms, hour = DAY_START_HOUR) {
  const d = new Date(ms - hour * 3600000);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0, 0).getTime();
}
export function dayEnd(ms, hour = DAY_START_HOUR) {
  const s = new Date(dayStart(ms, hour));
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1, hour, 0, 0, 0).getTime();
}
export const appDayDiff = (lastMs, curMs) => dayNumber(curMs) - dayNumber(lastMs);

// ---- Helpers ----
export const isLeech = (st) => !!st && st.lapses >= LEECH_LAPSES;
export const isNewState = (st) => !st || st.state === State.New;

export function buildCardIndex(notes) {
  const cards = new Map();
  const byNote = new Map();
  for (const n of notes) {
    const list = cardsForNote(n);
    byNote.set(n.id, list);
    for (const c of list) cards.set(c.id, { ...c, type: n.type, deckId: n.deckId });
  }
  return { cards, byNote };
}

function isUnlocked(card, byNote, states) {
  if (!card.unlock) return true;
  const src = byNote.get(card.noteId).find((c) => c.tmpl === card.unlock);
  const st = src && states[src.id];
  return !!st && st.state === State.Review && st.stability >= UNLOCK_STABILITY;
}

// Seeded shuffle so the order is stable within a day.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(arr, seed) {
  const r = rng(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * Build today's queue.
 * input: { notes, decks, states: {cardId: srsState}, introduced: {noteId: dayNumber},
 *          started: {deckId: true}, settings, now, hasVoice, guardActive }
 * returns { learning, reviews, newCards, queue, counts, guard, touchedNotes }
 */
export function buildQueue(input) {
  const { notes, decks = [], states = {}, introduced = {}, started = {}, now, hasVoice = true } = input;
  const settings = { ...DEFAULT_SETTINGS, ...(input.settings || {}) };
  const today = dayNumber(now);
  const end = dayEnd(now);
  const { byNote } = input.index || buildCardIndex(notes);
  const deckById = new Map(decks.map((d) => [d.id, d]));
  const noteById = new Map(notes.map((n) => [n.id, n]));

  // Notes touched today (a card reviewed or introduced today): their other cards wait.
  const touchedBy = new Map(); // noteId -> cardId reviewed today
  for (const [noteId, list] of byNote) {
    for (const c of list) {
      const st = states[c.id];
      if (st && st.lastReview != null && dayNumber(st.lastReview) === today) { touchedBy.set(noteId, c.id); break; }
    }
  }
  const usable = (c) => (!c.needsVoice || hasVoice);
  const siblingFree = (c) => !touchedBy.has(c.noteId) || touchedBy.get(c.noteId) === c.id;

  const learning = [], reviews = [];
  const taken = new Set(); // one card per note per day
  // Learning / relearning first, then reviews (most overdue first).
  const dueCards = [];
  for (const n of notes) {
    for (const c of byNote.get(n.id)) {
      const st = states[c.id];
      if (!st || st.state === State.New || !usable(c)) continue;
      if (st.due >= end) continue;
      dueCards.push({ c, st, n });
    }
  }
  dueCards.sort((a, b) => a.st.due - b.st.due);
  for (const { c, st, n } of dueCards) {
    if (taken.has(n.id) || !siblingFree(c)) continue;
    const item = { cardId: c.id, noteId: n.id, tmpl: c.tmpl, type: n.type, due: st.due };
    if (st.state === State.Learning || st.state === State.Relearning) { learning.push({ ...item, kind: 'learning' }); taken.add(n.id); }
  }
  for (const { c, st, n } of dueCards) {
    if (st.state !== State.Review || taken.has(n.id) || !siblingFree(c)) continue;
    reviews.push({ cardId: c.id, noteId: n.id, tmpl: c.tmpl, type: n.type, due: st.due, kind: 'review' });
    taken.add(n.id);
  }
  const dueReviews = reviews.length;
  let cappedReviews = reviews;
  if (settings.maxReviews > 0) cappedReviews = reviews.slice(0, settings.maxReviews);

  // Backlog guard with hysteresis.
  let guardActive = false;
  if (settings.backlogGuard) {
    guardActive = dueReviews > GUARD_ON || (!!input.guardActive && dueReviews >= GUARD_OFF);
  }

  const newCards = [];
  if (!guardActive) {
    // 1) Next cards of notes already introduced (do not count toward the note limit).
    for (const n of notes) {
      if (introduced[n.id] == null || taken.has(n.id)) continue;
      if (introduced[n.id] === today) continue;
      const deck = deckById.get(n.deckId);
      if (deck && !deck.core && !started[n.deckId]) continue;
      const c = byNote.get(n.id).find((c) => isNewState(states[c.id]) && usable(c) && isUnlocked(c, byNote, states) && siblingFree(c));
      if (c) { newCards.push({ cardId: c.id, noteId: n.id, tmpl: c.tmpl, type: n.type, kind: 'new', newNote: false }); taken.add(n.id); }
    }
    // 2) Brand-new notes, counted per note.
    const introducedToday = Object.entries(introduced).filter(([, d]) => d === today).map(([id]) => id);
    const setsToday = new Set(introducedToday.map((id) => noteById.get(id)?.set).filter(Boolean));
    const coreToday = introducedToday.filter((id) => deckById.get(noteById.get(id)?.deckId)?.core).length;
    let remaining = Math.max(0, settings.newPerDay - introducedToday.length);
    let coreSlots = Math.min(remaining, Math.max(0, settings.corePerDay - coreToday));

    const candidates = (core) => notes.filter((n) => {
      const deck = deckById.get(n.deckId);
      if (!deck || !!deck.core !== core) return false;
      if (!core && !started[n.deckId]) return false;
      if (core && started[n.deckId] === false) return false; // core decks run unless paused
      if (introduced[n.id] != null || taken.has(n.id)) return false;
      return byNote.get(n.id).some((c) => usable(c));
    });
    const pick = (list, max) => {
      const out = [];
      for (const n of list) {
        if (out.length >= max) break;
        if (n.set && setsToday.has(n.set)) continue;
        const c = byNote.get(n.id).find((c) => usable(c) && !c.unlock);
        if (!c) continue;
        out.push({ cardId: c.id, noteId: n.id, tmpl: c.tmpl, type: n.type, kind: 'new', newNote: true });
        if (n.set) setsToday.add(n.set);
        taken.add(n.id);
      }
      return out;
    };
    const coursePicks = pick(candidates(false), remaining - coreSlots);
    remaining -= coursePicks.length;
    const corePicks = pick(candidates(true), remaining);       // core quota + any unused course slots
    remaining -= corePicks.length;
    const extraCourse = remaining > 0 ? pick(candidates(false), remaining) : [];
    // Alternate course and core so both appear early in the session.
    const course = coursePicks.concat(extraCourse);
    const merged = [];
    for (let i = 0; i < Math.max(course.length, corePicks.length); i++) {
      if (course[i]) merged.push(course[i]);
      if (corePicks[i]) merged.push(corePicks[i]);
    }
    newCards.push(...merged);
  }

  const queue = interleave(learning, shuffle(cappedReviews, today), newCards);
  return {
    learning, reviews: cappedReviews, newCards, queue,
    counts: { learning: learning.length, review: cappedReviews.length, new: newCards.length, dueReviews },
    guard: { active: guardActive, enabled: settings.backlogGuard },
    today,
  };
}

// Learning first, then 4 reviews : 1 new, then fix runs of the same note type.
export function interleave(learning, reviews, newCards) {
  const mixed = [];
  let r = 0, n = 0;
  while (r < reviews.length || n < newCards.length) {
    for (let k = 0; k < 4 && r < reviews.length; k++) mixed.push(reviews[r++]);
    if (n < newCards.length) mixed.push(newCards[n++]);
    if (r >= reviews.length) while (n < newCards.length) mixed.push(newCards[n++]);
  }
  return learning.concat(limitRuns(mixed, 3));
}

// Never the same note type more than `max` times in a row if another type is available later.
export function limitRuns(items, max = 3) {
  const a = items.slice();
  for (let i = max; i < a.length; i++) {
    const t = a[i].type;
    let run = true;
    for (let k = 1; k <= max; k++) if (a[i - k].type !== t) { run = false; break; }
    if (!run) continue;
    const j = a.findIndex((x, idx) => idx > i && x.type !== t);
    if (j === -1) break;
    const [x] = a.splice(j, 1);
    a.splice(i, 0, x);
  }
  return a;
}

// ---- In-session order ----
export function createSession(queue, { now, minutes = 0 } = {}) {
  return { main: queue.slice(), learning: [], pos: 0, startedAt: now, deadline: minutes ? now + minutes * 60000 : 0, done: [] };
}

// Next item: learning cards that are due, then the main queue, then learning cards ahead of time.
export function sessionNext(s, now) {
  if (s.deadline && now >= s.deadline && s.done.length) return null;
  s.learning.sort((a, b) => a.due - b.due);
  if (s.learning.length && s.learning[0].due <= now) return s.learning.shift();
  if (s.pos < s.main.length) return s.main[s.pos++];
  if (s.learning.length) return s.learning.shift();
  return null;
}

export function sessionAfterGrade(s, item, newState, now, rating) {
  s.done.push({ ...item, rating });
  if ((newState.state === State.Learning || newState.state === State.Relearning) && newState.due < dayEnd(now)) {
    s.learning.push({ ...item, kind: 'learning', due: newState.due });
  }
}

export function sessionRemaining(s) {
  return (s.main.length - s.pos) + s.learning.length;
}

// ---- Stats ----
export function streak(reviewDays, today) {
  const set = new Set(reviewDays);
  let d = set.has(today) ? today : today - 1;
  let n = 0;
  while (set.has(d)) { n++; d--; }
  return n;
}

// "Expected daily reviews in 30 days": cards already learnt + cards from 30 more days of new notes.
export function forecastReviews(states, newPerDay, cardsPerNote = 1.6) {
  let load = 0;
  for (const st of Object.values(states)) {
    if (!st || st.state === State.New) continue;
    const s = Math.max(1, st.stability || 1);
    load += 1 / (s * 3); // stability keeps growing over the next month
  }
  load += newPerDay * 30 * cardsPerNote * 0.2;
  return Math.round(load);
}

export const estimateMinutes = (reviews, news) => Math.max(1, Math.round((reviews * 8 + news * 25) / 60));
