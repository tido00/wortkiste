// srs.js: FSRS-6 scheduler, ported from ts-fsrs 5.x (open-spaced-repetition).
// Pure functions, no DOM, no dependencies.

export const State = Object.freeze({ New: 0, Learning: 1, Review: 2, Relearning: 3 });
export const Rating = Object.freeze({ Again: 1, Hard: 2, Good: 3, Easy: 4 });

export const DEFAULT_W = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]);

const S_MIN = 0.001;
const S_MAX = 36500;
const DAY_MS = 86400000;
const MIN_MS = 60000;

export const DEFAULT_PARAMS = Object.freeze({
  w: DEFAULT_W,
  requestRetention: 0.9,
  maximumInterval: 365,
  enableFuzz: true,
  learningSteps: [1, 10],   // minutes
  relearningSteps: [10],    // minutes
});

const roundTo = (n, d) => { const f = 10 ** d; return Math.round(n * f) / f; };
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// ts-fsrs counts elapsed days as a difference of UTC calendar dates.
export function utcDayDiff(lastMs, curMs) {
  const a = new Date(lastMs), b = new Date(curMs);
  const u1 = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const u2 = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.floor((u2 - u1) / DAY_MS);
}

function decayFactor(w) {
  const decay = -w[20];
  const factor = roundTo(Math.exp((1 / decay) * Math.log(0.9)) - 1, 8);
  return { decay, factor };
}

export function forgettingCurve(w, t, s) {
  const { decay, factor } = decayFactor(w);
  return roundTo(Math.pow(1 + (factor * t) / s, decay), 8);
}

function intervalModifier(w, r) {
  const { decay, factor } = decayFactor(w);
  return roundTo((Math.pow(r, 1 / decay) - 1) / factor, 8);
}

const initStability = (w, g) => Math.max(w[g - 1], 0.1);
const initDifficulty = (w, g) => roundTo(w[4] - Math.exp((g - 1) * w[5]) + 1, 8);

function nextDifficulty(w, d, g) {
  const delta = -w[6] * (g - 3);
  const next = d + roundTo((delta * (10 - d)) / 9, 8);
  const rev = roundTo(w[7] * initDifficulty(w, 4) + (1 - w[7]) * next, 8);
  return clamp(rev, 1, 10);
}

function nextRecallStability(w, d, s, r, g) {
  const hard = g === Rating.Hard ? w[15] : 1;
  const easy = g === Rating.Easy ? w[16] : 1;
  return roundTo(clamp(
    s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1) * hard * easy),
    S_MIN, S_MAX), 8);
}

function nextForgetStability(w, d, s, r) {
  return roundTo(clamp(
    w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]),
    S_MIN, S_MAX), 8);
}

function nextShortTermStability(w, s, g) {
  const sinc = Math.pow(s, -w[19]) * Math.exp(w[17] * (g - 3 + w[18]));
  const masked = g >= Rating.Hard ? Math.max(sinc, 1) : sinc;
  return roundTo(clamp(s * masked, S_MIN, S_MAX), 8);
}

// Memory state after a review (difficulty, stability).
export function nextMemoryState(w, d, s, t, g, r) {
  if (d === 0 && s === 0) return { difficulty: clamp(initDifficulty(w, g), 1, 10), stability: initStability(w, g) };
  if (r === undefined) r = forgettingCurve(w, t, s);
  let ns;
  if (t === 0) ns = nextShortTermStability(w, s, g);
  else if (g === Rating.Again) {
    const fail = nextForgetStability(w, d, s, r);
    ns = clamp(roundTo(s / Math.exp(w[17] * w[18]), 8), S_MIN, fail);
  } else ns = nextRecallStability(w, d, s, r, g);
  return { difficulty: nextDifficulty(w, d, g), stability: ns };
}

// ---- Fuzz (Alea PRNG, same as ts-fsrs so results match) ----
function mash() {
  let n = 4022871197;
  return (data) => {
    data = String(data);
    for (let i = 0; i < data.length; i++) {
      n += data.charCodeAt(i);
      let h = 0.02519603282416938 * n;
      n = h >>> 0; h -= n; h *= n; n = h >>> 0; h -= n; n += h * 4294967296;
    }
    return (n >>> 0) * 2.3283064365386963e-10;
  };
}
function alea(seed) {
  const m = mash();
  let c = 1, s0 = m(' '), s1 = m(' '), s2 = m(' ');
  s0 -= m(seed); if (s0 < 0) s0 += 1;
  s1 -= m(seed); if (s1 < 0) s1 += 1;
  s2 -= m(seed); if (s2 < 0) s2 += 1;
  return () => { const t = 2091639 * s0 + c * 2.3283064365386963e-10; s0 = s1; s1 = s2; c = t | 0; s2 = t - c; return s2; };
}

const FUZZ_RANGES = [
  { start: 2.5, end: 7, factor: 0.15 },
  { start: 7, end: 20, factor: 0.1 },
  { start: 20, end: Infinity, factor: 0.05 },
];

export function fuzzRange(ivl, elapsed, maxIvl) {
  let delta = 1;
  for (const r of FUZZ_RANGES) delta += r.factor * Math.max(Math.min(ivl, r.end) - r.start, 0);
  ivl = Math.min(ivl, maxIvl);
  let min = Math.max(2, Math.round(ivl - delta));
  const max = Math.min(Math.round(ivl + delta), maxIvl);
  if (ivl > elapsed) min = Math.max(min, elapsed + 1);
  min = Math.min(min, max);
  return { min, max };
}

function nextInterval(p, s, elapsed, seed) {
  const ivl = Math.min(Math.max(1, Math.round(s * intervalModifier(p.w, p.requestRetention))), p.maximumInterval);
  if (!p.enableFuzz || ivl < 2.5) return Math.round(ivl);
  const { min, max } = fuzzRange(ivl, elapsed, p.maximumInterval);
  return Math.floor(alea(seed)() * (max - min + 1) + min);
}

// ---- Card state ----
export function newCardState(nowMs = 0) {
  return { due: nowMs, stability: 0, difficulty: 0, state: State.New, step: 0, reps: 0, lapses: 0, lastReview: null, scheduledDays: 0 };
}

function stepsInfo(p, state, step, g) {
  const steps = state === State.Relearning || state === State.Review ? p.relearningSteps : p.learningSteps;
  if (steps.length === 0 || step >= steps.length) return null;
  if (state === State.Review) return g === Rating.Again ? { minutes: steps[0], next: 0 } : null;
  if (g === Rating.Again) return { minutes: steps[0], next: 0 };
  if (g === Rating.Hard) {
    const m = steps.length === 1 ? Math.round(steps[0] * 1.5) : Math.round((steps[0] + steps[1]) / 2);
    return { minutes: m, next: step };
  }
  if (g === Rating.Good && step + 1 < steps.length) return { minutes: Math.round(steps[step + 1]), next: step + 1 };
  return null;
}

// Review a card. Returns the new state (does not mutate `card`).
// opts.dayDiff(lastMs, nowMs) lets the app use its own 04:00 day boundary.
export function review(card, rating, nowMs, params = DEFAULT_PARAMS, opts = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const dayDiff = opts.dayDiff || utcDayDiff;
  const w = p.w;
  const elapsed = card.state !== State.New && card.lastReview != null ? dayDiff(card.lastReview, nowMs) : 0;
  const reps = card.reps + 1;
  const seed = `${nowMs}_${reps}_${card.difficulty * card.stability}`;
  const next = { ...card, reps, lastReview: nowMs };

  const applySteps = (nc, g, toState) => {
    const info = stepsInfo(p, card.state, card.step || 0, g);
    const minutes = info ? Math.max(0, info.minutes) : 0;
    if (minutes > 0 && minutes < 1440) {
      nc.step = info.next; nc.scheduledDays = 0; nc.state = toState; nc.due = nowMs + Math.round(minutes) * MIN_MS;
    } else {
      nc.state = State.Review;
      if (minutes >= 1440) {
        nc.step = info.next; nc.due = nowMs + Math.round(minutes) * MIN_MS; nc.scheduledDays = Math.floor(minutes / 1440);
      } else {
        nc.step = 0;
        const ivl = nextInterval(p, nc.stability, elapsed, seed);
        nc.scheduledDays = ivl; nc.due = nowMs + ivl * DAY_MS;
      }
    }
    return nc;
  };

  if (card.state === State.New || card.state === State.Learning || card.state === State.Relearning) {
    const ms = nextMemoryState(w, card.difficulty, card.stability, elapsed, rating);
    Object.assign(next, ms);
    return applySteps(next, rating, card.state === State.New ? State.Learning : card.state);
  }

  // Review state
  const r = forgettingCurve(w, elapsed, card.stability);
  const ds = (g) => nextMemoryState(w, card.difficulty, card.stability, elapsed, g, r);
  if (rating === Rating.Again) {
    Object.assign(next, ds(Rating.Again));
    applySteps(next, Rating.Again, State.Relearning);
    next.lapses = card.lapses + 1;
    return next;
  }
  const hard = ds(Rating.Hard), good = ds(Rating.Good), easy = ds(Rating.Easy);
  let hi = nextInterval(p, hard.stability, elapsed, seed);
  let gi = nextInterval(p, good.stability, elapsed, seed);
  hi = Math.min(hi, gi);
  gi = Math.max(gi, hi + 1);
  const ei = Math.max(nextInterval(p, easy.stability, elapsed, seed), gi + 1);
  // ts-fsrs can overshoot the cap by a day or two (Easy = Good + 1); keep the hard 365-day limit.
  const cap = (d) => Math.min(d, p.maximumInterval);
  const pick = { [Rating.Hard]: [hard, cap(hi)], [Rating.Good]: [good, cap(gi)], [Rating.Easy]: [easy, cap(ei)] }[rating];
  Object.assign(next, pick[0]);
  next.state = State.Review; next.step = 0; next.scheduledDays = pick[1]; next.due = nowMs + pick[1] * DAY_MS;
  return next;
}

// All four outcomes, for showing intervals on the buttons.
export function preview(card, nowMs, params, opts) {
  const out = {};
  for (const g of [1, 2, 3, 4]) out[g] = review(card, g, nowMs, params, opts);
  return out;
}

export function retrievability(card, nowMs, params = DEFAULT_PARAMS, opts = {}) {
  if (card.state === State.New || card.lastReview == null) return 0;
  const t = (opts.dayDiff || utcDayDiff)(card.lastReview, nowMs);
  return forgettingCurve((params.w || DEFAULT_W), Math.max(0, t), card.stability);
}

export function formatInterval(ms) {
  const min = Math.round(ms / MIN_MS);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)} h`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d} d`;
  if (d < 365) return `${(d / 30).toFixed(d < 300 ? 1 : 0).replace(/\.0$/, '')} mo`;
  return `${(d / 365).toFixed(1).replace(/\.0$/, '')} y`;
}
