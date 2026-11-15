// app.js: UI and router. Tabs: Today (guided daily lesson), Journey, Me. Plus More practice and the extra modes.

import { review, preview, newCardState, State, DEFAULT_PARAMS, formatInterval } from './srs.js';
import { parseDeckFile, mergeDecks, article, parseCloze, checkTyped, isPluralOnly } from './decks.js';
import {
  buildQueue, buildCardIndex, dayNumber, dayEnd, appDayDiff, createSession, sessionNext, sessionAfterGrade,
  sessionRemaining, isLeech, streak, forecastReviews, DEFAULT_SETTINGS, MATURE_STABILITY, GUARD_OFF,
} from './queue.js';
import { pickWarmup, planLesson, nextStep, hasWork, minutesFor, CHALLENGE_SIZE } from './lesson.js';
import { createStore, idbBackend, memoryBackend } from './store.js';
import * as audio from './audio.js';
import {
  h, toast, deWord, exampleWithNoun, audioBtn, recordWidget, orderPuzzle, weakWordsText, copyText,
  renderQuiz, renderCar, renderShadow, renderDrill, quizHistory, buildQuiz, quizItem,
} from './modes.js';

const VERSION = '2.0.0';
const DAY = 86400000;
const A = {
  store: null, notes: [], decks: [], problems: [], index: null, noteById: new Map(), deckById: new Map(),
  hasVoice: false, lesson: null, quick: null, undo: null, cleanup: null, dayDiff: appDayDiff,
  go: (r) => { location.hash = `#/${r}`; },
};
const root = () => document.getElementById('app');
const S = () => ({ ...DEFAULT_SETTINGS, ...(A.store.get('settings', {}) || {}) });
const params = () => ({ ...DEFAULT_PARAMS, requestRetention: S().retention });
const srsOpts = { dayDiff: appDayDiff };
async function saveSettings(patch) { await A.store.set('settings', { ...S(), ...patch }); applyAudioPrefs(); }
function applyAudioPrefs() { const s = S(); audio.setPrefs({ voice: s.voice, rate: s.rate }); audio.setSounds(s.sounds); }

// ---------- Boot ----------
async function loadDecks() {
  const parsed = [], problems = [];
  try {
    const res = await fetch('decks/index.json', { cache: 'no-cache' });
    const idx = await res.json();
    for (const d of idx.decks || []) {
      try {
        const r = await fetch(`decks/${encodeURIComponent(d.file)}`, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        parsed.push(parseDeckFile(await r.text(), d.file));
      } catch (e) {
        problems.push({ file: d.file, line: 0, text: '', error: `Could not load this deck file (${e.message})` });
      }
    }
  } catch {
    problems.push({ file: 'index.json', line: 0, text: '', error: 'Could not read decks/index.json' });
  }
  const m = mergeDecks(parsed);
  m.problems.push(...problems);
  return m;
}

async function boot() {
  try {
    A.store = await createStore(idbBackend());
  } catch {
    A.store = await createStore(memoryBackend());
    setTimeout(() => toast('Storage is blocked (private mode?). Progress will not be saved.', 5000), 500);
  }
  const m = await loadDecks();
  A.notes = m.notes; A.decks = m.decks; A.problems = m.problems;
  A.index = buildCardIndex(A.notes);
  A.noteById = new Map(A.notes.map((n) => [n.id, n]));
  A.deckById = new Map(A.decks.map((d) => [d.id, d]));
  applyAudioPrefs();
  await audio.loadVoices();
  A.hasVoice = audio.hasGerman();
  window.addEventListener('hashchange', route);
  route();
  if (!A.hasVoice) audio.loadVoices(4000).then(() => { if (audio.hasGerman() && !A.hasVoice) { A.hasVoice = true; if (!A.lesson && !A.quick) route(); } });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------- Router ----------
const TAB_OF = { today: 'today', more: 'today', journey: 'journey', decks: 'journey', me: 'me', settings: 'me' };
function route() {
  if (A.cleanup) { try { A.cleanup(); } catch { /* ignore */ } A.cleanup = null; }
  audio.stop();
  const [name = 'today', arg] = location.hash.replace(/^#\/?/, '').split('/');
  const r = root();
  r.replaceChildren();
  window.scrollTo(0, 0);
  const full = ['lesson', 'quick', 'quiz', 'car', 'shadow', 'drill'].includes(name);
  document.body.classList.toggle('no-tabs', full);
  document.querySelectorAll('nav.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === TAB_OF[name]));
  const screens = {
    today: renderToday, lesson: renderLesson, quick: renderQuick, more: renderMore,
    journey: renderJourney, decks: renderJourney, me: renderMe, settings: renderSettings,
    quiz: () => renderQuiz(r, A), car: () => renderCar(r, A), shadow: () => renderShadow(r, A), drill: () => renderDrill(r, A, arg),
  };
  const out = (screens[name] || renderToday)(arg);
  if (typeof out === 'function') A.cleanup = out;
}

// ---------- Shared data ----------
function todayQueue(now = Date.now()) {
  const q = buildQueue({
    notes: A.notes, decks: A.decks, states: A.store.state.cards, introduced: A.store.get('introduced', {}),
    started: A.store.get('started', {}), settings: S(), now, hasVoice: A.hasVoice, guardActive: A.store.get('guardActive', false), index: A.index,
  });
  if (q.guard.active !== A.store.get('guardActive', false)) A.store.set('guardActive', q.guard.active);
  return q;
}
function activeDays() {
  const days = new Set(A.store.state.revlog.map((e) => dayNumber(e.t)));
  for (const d of A.store.get('lessonDays', []) || []) days.add(d);
  return days;
}
const reviewsByDay = () => {
  const m = new Map();
  for (const e of A.store.state.revlog) { const d = dayNumber(e.t); m.set(d, (m.get(d) || 0) + 1); }
  return m;
};
const courseStarted = () => { const st = A.store.get('started', {}); return A.decks.some((d) => !d.core && st[d.id]); };
const noteLabel = (n) => (n.type === 'c' ? parseCloze(n.german).full : n.type === 'o' ? n.german.split('/').map((t) => t.trim()).join(' ') : n.german);
function wordsKnown() {
  const known = { A1: 0, A2: 0 };
  const states = A.store.state.cards;
  for (const n of A.notes) {
    if (!['n', 'v', 'w', 'p'].includes(n.type)) continue;
    if (A.index.byNote.get(n.id).some((c) => states[c.id] && states[c.id].state === State.Review)) known[n.lvl === 'A2' ? 'A2' : 'A1']++;
  }
  return known;
}
const todaysNoteIds = (now = Date.now()) => new Set(A.store.state.revlog.filter((e) => dayNumber(e.t) === dayNumber(now)).map((e) => e.noteId));
function lessonDay(now = Date.now()) {
  const st = A.store.get('lesson', {}) || {};
  return st.day === dayNumber(now) ? st : { day: dayNumber(now) };
}
async function markLesson(patch) { await A.store.set('lesson', { ...lessonDay(), ...patch }); }

function prepareLesson(now = Date.now()) {
  const q = todayQueue(now);
  const due = new Set(q.queue.map((i) => i.noteId));
  const warm = pickWarmup({ notes: A.notes, states: A.store.state.cards, byNote: A.index.byNote, now, exclude: due, dayDiff: appDayDiff });
  const seenAny = Object.values(A.store.state.cards).some((st) => st && st.state !== State.New);
  const ld = lessonDay(now);
  const plan = planLesson({
    reviews: q.learning.length + q.reviews.length, news: q.newCards.length, warmup: warm.length,
    challenge: seenAny || q.newCards.length ? CHALLENGE_SIZE : 0, done: { warmup: !!ld.warmup, challenge: !!ld.challenge, finished: !!ld.finished },
  });
  return { q, warm, plan };
}

function stepDots(plan, current) {
  return h('div', { class: 'dots', role: 'img', 'aria-label': `Step ${current + 1} of ${plan.length}` },
    plan.map((s, i) => h('i', { class: i < current ? 'done' : i === current ? 'now' : s.count ? '' : 'empty', title: s.title })));
}

// ---------- Today ----------
function renderToday() {
  const r = root();
  const now = Date.now();
  const today = dayNumber(now);
  const dateStr = new Date(now).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const st = streak([...activeDays()], today);
  r.append(h('div', { class: 'row spread', style: 'align-items:flex-end' },
    h('div', {}, h('div', { class: 'eyebrow' }, dateStr), h('h1', { style: 'margin:2px 0 0' }, 'Hallo Saad')),
    h('div', { class: 'streak', 'aria-label': `${st} day streak` }, h('b', {}, st ? `🔥 ${st}` : '0'), h('span', {}, st === 1 ? 'day' : 'days'))));

  if (!A.notes.length) {
    r.append(h('div', { class: 'card' }, 'No decks could be loaded. Check your connection and reload. (Details in Me → Settings → Deck problems.)'));
    return;
  }
  if (!courseStarted()) {
    const first = A.decks.find((d) => !d.core);
    if (first) {
      r.append(h('div', { class: 'card lesson-card' }, h('div', { class: 'eyebrow' }, 'Welcome'),
        h('h2', { style: 'margin:4px 0' }, 'Start your first lesson'),
        h('p', { class: 'muted' }, 'Wortkiste follows your course. Later lessons start from the Journey tab.'),
        h('button', { class: 'btn primary block big', onclick: async () => { await A.store.set('started', { ...A.store.get('started', {}), [first.id]: true }); route(); } }, `Start ${first.title}`)));
    }
  }

  const { q, plan } = prepareLesson(now);
  const counts = Object.fromEntries(plan.map((s) => [s.id, s.count]));
  const resume = !!A.lesson && A.lesson.day === today;
  if (hasWork(plan)) {
    r.append(h('div', { class: 'card lesson-card' },
      h('div', { class: 'eyebrow' }, "Today's lesson"),
      h('div', { class: 'lesson-meta' }, `about ${minutesFor(plan)} min`),
      h('div', { class: 'muted small' }, [counts.reviews ? `${counts.reviews} reviews` : null, counts.new ? `${counts.new} new` : null, counts.challenge ? 'challenge' : null].filter(Boolean).join(' · ') || 'warm-up'),
      stepDots(plan, resume ? A.lesson.stepIdx : -1),
      h('button', { class: 'btn primary block big', onclick: () => startLesson(!resume) }, resume ? '▶ Continue' : '▶ Start')));
  } else if (courseStarted()) {
    r.append(h('div', { class: 'card lesson-card center' },
      h('div', { style: 'font-size:40px' }, '✅'), h('h2', { style: 'margin:4px 0' }, "Today's lesson is done"),
      h('p', { class: 'muted' }, 'Gut gemacht! Come back tomorrow, or practise a bit more.'),
      h('a', { class: 'btn block', href: '#/more' }, 'More practice')));
  }
  if (q.guard.active) r.append(h('div', { class: 'notice' }, `Catching up: new words paused until reviews are under ${GUARD_OFF}.`));

  const known = wordsKnown();
  const total = known.A1 + known.A2;
  r.append(h('div', { class: 'card' },
    h('div', { class: 'row spread' }, h('div', { class: 'eyebrow' }, 'Goal: Goethe A2'), h('span', { class: 'small muted' }, `${total} / 1300 words`)),
    h('div', { class: 'meter big' }, h('div', { style: `width:${Math.min(100, (total / 1300) * 100)}%` })),
    h('p', { class: 'small muted', style: 'margin:6px 0 0' }, `A1 ${known.A1} / 650 · A2 ${known.A2} / 650`)));
  if (hasWork(plan)) r.append(h('a', { class: 'btn block', href: '#/more', style: 'margin-top:12px' }, 'More practice'));
}

// ---------- Lesson ----------
function startLesson(fresh = true) {
  const now = Date.now();
  if (fresh || !A.lesson || A.lesson.day !== dayNumber(now)) {
    const { q, warm, plan } = prepareLesson(now);
    A.lesson = {
      day: dayNumber(now), plan, stepIdx: -1, warm,
      sessions: { reviews: createSession(q.learning.concat(q.reviews), { now }), new: createSession(q.newCards, { now }) },
      stats: { first: new Map(), news: 0, challenge: null }, taught: new Set(), combo: 0, best: 0,
    };
    A.lesson.stepIdx = nextStep(plan, -1);
  }
  A.undo = null;
  if (location.hash === '#/lesson') route(); else A.go('lesson');
}

function renderLesson() {
  const r = root();
  const L = A.lesson;
  if (!L) { A.go('today'); return; }
  const dots = h('div', { class: 'grow' });
  const undoBtn = h('button', { class: 'btn small ghost', disabled: true, onclick: () => doUndo() }, '↶');
  undoBtn.setAttribute('aria-label', 'Undo last answer');
  const comboEl = h('div', { class: 'combo', 'aria-live': 'polite' });
  r.append(h('div', { class: 'topbar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Close lesson', onclick: () => A.go('today') }, '✕'),
    dots, undoBtn, h('button', { class: 'btn small', onclick: () => openSkip() }, 'Skip to…')));
  const stepLabel = h('div', { class: 'step-label' });
  const stage = h('div', { class: 'study' });
  r.append(stepLabel, comboEl, stage);
  let runner = null;

  const setLabel = (extra = '') => { stepLabel.textContent = `${L.plan[L.stepIdx].title}${extra ? ` · ${extra}` : ''}`; };
  const refreshTop = () => { dots.replaceChildren(stepDots(L.plan, L.stepIdx)); undoBtn.disabled = !A.undo; };

  function goStep(i) {
    if (runner && runner.cleanup) runner.cleanup();
    audio.stop();
    A.undo = null;
    L.stepIdx = i;
    refreshTop();
    const id = L.plan[i].id;
    window.scrollTo(0, 0);
    runner = ({ warmup: runWarmup, reviews: () => runCards('reviews'), new: () => runCards('new'), challenge: runChallenge, finish: runFinish })[id]();
  }
  const next = () => goStep(nextStep(L.plan, L.stepIdx));

  function openSkip() {
    const sheet = h('div', { class: 'sheet-back', onclick: (e) => { if (e.target === sheet) sheet.remove(); } },
      h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Skip to' },
        h('div', { class: 'eyebrow' }, 'Skip to…'),
        L.plan.filter((s) => s.id !== 'finish').map((s) => {
          const i = L.plan.indexOf(s);
          const left = s.id === 'reviews' || s.id === 'new' ? sessionRemaining(L.sessions[s.id]) : s.count;
          const status = i === L.stepIdx ? 'now' : !left ? 'empty' : '';
          return h('button', { class: `sheet-item ${status}`, disabled: !left && i !== L.stepIdx, onclick: () => { sheet.remove(); goStep(i); } },
            h('span', {}, s.title), h('span', { class: 'muted small' }, i === L.stepIdx ? 'now' : left ? (s.id === 'reviews' || s.id === 'new' ? `${left} left` : `${left}`) : (i < L.stepIdx ? '✓ done' : '—')));
        }),
        h('button', { class: 'btn block', onclick: () => { sheet.remove(); goStep(L.plan.length - 1); } }, 'Finish for today'),
        h('p', { class: 'small muted', style: 'margin:4px 0 0' }, 'Skipped cards stay due for later today.')));
    document.body.append(sheet);
  }

  // Warm-up: hear 3 known words. No grading.
  function runWarmup() {
    let i = 0;
    const show = () => {
      if (i >= L.warm.length) { L.plan[L.stepIdx].count = 0; markLesson({ warmup: true }); next(); return; }
      const n = L.warm[i];
      setLabel(`${i + 1} of ${L.warm.length}`);
      stage.replaceChildren(h('div', { class: 'card front pop-in' },
        h('div', { class: 'prompt' }, 'You know this one'),
        n.keys.img ? h('div', { class: 'emoji' }, n.keys.img) : null,
        h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: n.type === 'p' ? 'de md' : 'de' }, deWord(n.german, { plural: isPluralOnly(n) })), audioBtn(A, n.german)),
        h('div', { class: 'en', style: 'margin-top:8px' }, n.english), n.french ? h('div', { class: 'fr' }, n.french) : null),
      h('button', { class: 'btn primary block big', style: 'margin-top:14px', onclick: () => { i++; show(); } }, i + 1 < L.warm.length ? 'Next' : "Let's go →"));
      if (A.hasVoice) audio.speak(n.german);
    };
    show();
  }

  // Reviews and new words: the card runner.
  function runCards(key) {
    const s = L.sessions[key];
    let view = null;
    const showNext = (item) => {
      if (view && view.cleanup) view.cleanup();
      audio.stop();
      refreshTop();
      const it = item || sessionNext(s, Date.now());
      if (!it) { next(); return; }
      setLabel(`${sessionRemaining(s) + 1} left`);
      const note = A.noteById.get(it.noteId);
      if (key === 'new' && it.newNote && !L.taught.has(it.noteId)) {
        L.taught.add(it.noteId);
        view = teachCard(stage, note, () => { view = studyCard(stage, it, (g) => grade(it, g)); });
      } else {
        view = studyCard(stage, it, (g) => grade(it, g));
      }
    };
    async function grade(item, rating) {
      const now = Date.now();
      const prev = A.store.card(item.cardId) || null;
      const base = prev || newCardState(now);
      const nextSt = review(base, rating, now, params(), srsOpts);
      const introduced = A.store.get('introduced', {});
      const snapshot = { pos: s.pos, learning: s.learning.map((x) => ({ ...x })), done: s.done.slice(), combo: L.combo, firstHad: L.stats.first.has(item.cardId), news: L.stats.news };
      let introducedNow = false;
      if (introduced[item.noteId] == null) { introducedNow = true; await A.store.set('introduced', { ...introduced, [item.noteId]: dayNumber(now) }); }
      await A.store.putCard(item.cardId, nextSt);
      const logId = await A.store.addLog({ cardId: item.cardId, noteId: item.noteId, tmpl: item.tmpl, t: now, rating, wasNew: base.state === State.New, state: base.state });
      A.undo = { item, prev, logId, introducedNow, snapshot, session: s, redo: showNext };
      if (!L.stats.first.has(item.cardId)) L.stats.first.set(item.cardId, rating);
      if (item.kind === 'new' && base.state === State.New) L.stats.news++;
      sessionAfterGrade(s, item, nextSt, now, rating);
      feedback(rating);
      if (nextSt.lapses >= 6 && (!prev || prev.lapses < 6)) toast('🧩 This one is a hard word. It is now on your Hard words list.');
      showNext();
    }
    showNext();
    return { cleanup: () => { if (view && view.cleanup) view.cleanup(); } };
  }

  function feedback(rating) {
    if (rating >= 2) {
      L.combo++; L.best = Math.max(L.best, L.combo);
      audio.chime(L.combo >= 3 ? 'combo' : 'right');
      if (L.combo >= 3) {
        comboEl.replaceChildren(h('span', { class: 'combo-pop' }, `🔥 ${L.combo} in a row`));
      }
    } else {
      L.combo = 0;
      audio.chime('wrong');
      comboEl.replaceChildren();
    }
  }

  async function doUndo() {
    const u = A.undo;
    if (!u) return;
    A.undo = null;
    if (u.prev) await A.store.putCard(u.item.cardId, u.prev); else await A.store.delCard(u.item.cardId);
    await A.store.delLog(u.logId);
    if (u.introducedNow) { const intro = { ...A.store.get('introduced', {}) }; delete intro[u.item.noteId]; await A.store.set('introduced', intro); }
    const s = u.session;
    s.pos = u.snapshot.pos; s.learning = u.snapshot.learning; s.done = u.snapshot.done;
    if (s.pos > 0 && s.main[s.pos - 1] && s.main[s.pos - 1].cardId === u.item.cardId) s.pos--;
    else s.learning = s.learning.filter((x) => x.cardId !== u.item.cardId);
    L.combo = u.snapshot.combo; L.stats.news = u.snapshot.news;
    if (!u.snapshot.firstHad) L.stats.first.delete(u.item.cardId);
    comboEl.replaceChildren();
    u.redo(u.item);
  }

  // Challenge: 5 quiz questions, today's words first.
  function runChallenge() {
    const items = buildQuiz(A, Date.now(), Math.random, { size: CHALLENGE_SIZE, prefer: todaysNoteIds() });
    if (items.length < 3) { L.plan[L.stepIdx].count = 0; markLesson({ challenge: true }); next(); return; }
    let i = 0, score = 0;
    const show = () => {
      if (i >= items.length) {
        L.stats.challenge = { score, total: items.length };
        L.plan[L.stepIdx].count = 0;
        markLesson({ challenge: true });
        next();
        return;
      }
      setLabel(`${i + 1} of ${items.length}`);
      const card = h('div', { class: 'card front pop-in' });
      stage.replaceChildren(card);
      quizItem(card, A, items[i], (ok) => {
        if (ok) score++;
        feedback(ok ? 3 : 1);
        i++;
        stage.append(h('button', { class: 'btn primary block big', style: 'margin-top:14px', onclick: show }, i >= items.length ? 'Finish →' : 'Next'));
      });
    };
    show();
  }

  async function runFinish() {
    setLabel();
    const now = Date.now();
    const today = dayNumber(now);
    const days = (A.store.get('lessonDays', []) || []).filter((d) => d > today - 400);
    if (!days.includes(today)) days.push(today);
    await A.store.set('lessonDays', days);
    await markLesson({ finished: true });
    const st = streak([...activeDays()], today);
    const first = [...L.stats.first.values()];
    const acc = first.length ? Math.round((first.filter((x) => x > 1).length / first.length) * 100) : null;
    const tomorrowEnd = dayEnd(now) + DAY;
    const dueTomorrow = Object.values(A.store.state.cards).filter((c) => c && c.state !== State.New && c.due < tomorrowEnd).length;
    const started = A.store.get('started', {});
    const introduced = A.store.get('introduced', {});
    const nextDeck = A.decks.find((d) => !d.core && started[d.id] && A.notes.some((n) => n.deckId === d.id && introduced[n.id] == null));
    const hour = new Date(now).getHours();
    const quizDone = (A.store.get('quiz', []) || []).some((x) => x.day === today);
    const suggestion = hour >= 17
      ? { label: 'Driving tonight?', text: 'Car mode: your weak words, hands-free', href: '#/car' }
      : !quizDone ? { label: 'Got 3 more minutes?', text: 'Daily quiz: 10 mixed questions', href: '#/quiz' }
        : { label: 'Train your ear', text: 'Shadowing: listen and repeat', href: '#/shadow' };
    const hard = [...new Set(A.store.state.revlog.filter((e) => e.rating === 1 && dayNumber(e.t) === today).map((e) => e.noteId))].map((id) => A.noteById.get(id)).filter(Boolean);
    audio.chime('done');
    A.lesson = null; A.undo = null;
    undoBtn.disabled = true;
    stage.replaceChildren(
      h('div', { class: 'card center pop-in' },
        h('div', { class: 'eyebrow' }, 'Lesson done'),
        h('div', { class: 'big-num' }, `🔥 ${st}`),
        h('div', { class: 'muted' }, st === 1 ? 'day streak. A great start!' : 'day streak'),
        h('div', { class: 'grid3', style: 'margin-top:14px' },
          h('div', {}, h('div', { class: 'stat' }, first.length), h('div', { class: 'small muted' }, 'cards')),
          h('div', {}, h('div', { class: 'stat' }, L.stats.news), h('div', { class: 'small muted' }, 'new words')),
          h('div', {}, h('div', { class: 'stat' }, acc == null ? '–' : `${acc}%`), h('div', { class: 'small muted' }, 'right first time'))),
        L.stats.challenge ? h('p', { class: 'small muted', style: 'margin-top:10px' }, `Challenge: ${L.stats.challenge.score} / ${L.stats.challenge.total}${L.best >= 3 ? ` · best run ${L.best} in a row` : ''}`) : null),
      hard.length ? h('div', { class: 'card' }, h('div', { class: 'eyebrow' }, 'Hard words today'), h('ul', { class: 'list' }, hard.slice(0, 8).map((n) => h('li', {}, h('span', {}, deWord(noteLabel(n), { plural: isPluralOnly(n) })), h('span', { class: 'muted small' }, n.english))))) : null,
      h('div', { class: 'card' }, h('div', { class: 'eyebrow' }, 'Tomorrow'),
        h('p', { style: 'margin:4px 0 0' }, `${dueTomorrow} reviews${nextDeck ? ` · new words from ${nextDeck.title}` : ''}`)),
      h('a', { class: 'card suggest', href: suggestion.href }, h('div', { class: 'eyebrow' }, suggestion.label), h('div', { style: 'font-weight:600;margin-top:2px' }, suggestion.text)),
      h('button', { class: 'btn primary block big', style: 'margin-top:12px', onclick: () => A.go('today') }, 'Done'));
  }

  const onKey = (e) => { if (e.key === 'Escape') document.querySelector('.sheet-back')?.remove(); };
  document.addEventListener('keydown', onKey);
  goStep(L.stepIdx);
  return () => { document.removeEventListener('keydown', onKey); document.querySelector('.sheet-back')?.remove(); if (runner && runner.cleanup) runner.cleanup(); };
}

// ---------- Quick review (5 min, from More practice) ----------
function renderQuick() {
  const r = root();
  const now = Date.now();
  const q = todayQueue(now);
  const s = createSession(q.learning.concat(q.reviews), { now, minutes: 5 });
  const progress = h('div', { class: 'progress' }, h('div'));
  r.append(h('div', { class: 'topbar' }, h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => A.go('more') }, '✕'), progress, h('span', { class: 'small muted' }, '5 min')));
  const stage = h('div', { class: 'study' });
  r.append(stage);
  let view = null;
  const showNext = () => {
    if (view && view.cleanup) view.cleanup();
    const it = sessionNext(s, Date.now());
    progress.firstChild.style.width = `${Math.min(100, ((Date.now() - now) / 300000) * 100)}%`;
    if (!it) {
      stage.replaceChildren(h('div', { class: 'card center' }, h('div', { style: 'font-size:40px' }, s.done.length ? '🎉' : '✅'),
        h('p', {}, s.done.length ? `${s.done.length} cards reviewed.` : 'Nothing is due right now.'),
        h('button', { class: 'btn primary block', onclick: () => A.go('more') }, 'Done')));
      return;
    }
    view = studyCard(stage, it, async (g) => {
      const t = Date.now();
      const base = A.store.card(it.cardId) || newCardState(t);
      const nextSt = review(base, g, t, params(), srsOpts);
      await A.store.putCard(it.cardId, nextSt);
      await A.store.addLog({ cardId: it.cardId, noteId: it.noteId, tmpl: it.tmpl, t, rating: g, wasNew: base.state === State.New, state: base.state });
      sessionAfterGrade(s, it, nextSt, t, g);
      audio.chime(g >= 2 ? 'right' : 'wrong');
      showNext();
    });
  };
  showNext();
  return () => { if (view && view.cleanup) view.cleanup(); };
}

// ---------- Cards ----------
const enFr = (note) => [h('div', { class: 'en' }, note.english), note.french ? h('div', { class: 'fr' }, note.french) : null];
const emojiEl = (note) => (note.keys.img ? h('div', { class: 'emoji' }, note.keys.img) : null);
const tipEl = (k) => [k.tip ? h('div', { class: 'tip' }, '💡 ', k.tip) : null, k.ff ? h('div', { class: 'ff' }, '⚠️ ', k.ff) : null];

// Meaning, plural, forms, example, tip: shown when teaching and on the back of cards.
function noteDetails(note, { showGerman = false, showMeaning = true } = {}) {
  const k = note.keys;
  const out = [];
  if (showGerman) out.push(h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de' }, deWord(note.german, { plural: isPluralOnly(note) })), audioBtn(A, note.german)));
  if (showMeaning) out.push(emojiEl(note), ...enFr(note));
  if (note.type === 'n' && k.pl) out.push(h('div', { class: 'small muted', style: 'margin-top:6px' }, k.pl === '-' ? 'no plural' : k.pl === 'only' ? 'plural only' : h('span', {}, 'plural: ', deWord(k.pl, { plural: true }))));
  if (note.type === 'v') {
    const forms = [k.du && `du ${k.du}`, k.er && `er ${k.er}`, k.perf && `Perfekt: ${k.perf}`, k.sep && `separable: ${k.sep}-`].filter(Boolean);
    if (forms.length) out.push(h('div', { class: 'small muted', style: 'margin-top:6px' }, forms.join(' · ')));
  }
  if (k.ex) out.push(h('div', { class: 'ex' }, h('div', { class: 'row', style: 'justify-content:center' }, h('span', {}, exampleWithNoun(k.ex, note)), audioBtn(A, k.ex)), k.exen ? h('div', { class: 'exen' }, k.exen) : null));
  out.push(...tipEl(k));
  return out;
}

// Teach screen for a brand-new note (SPEC C1.3). onDone() goes to the check.
function teachCard(stage, note, onDone) {
  const k = note.keys;
  const kind = { n: 'New word', v: 'New verb', w: 'New word', p: 'New phrase', c: 'Grammar', o: 'Sentence pattern' }[note.type];
  const card = h('div', { class: 'card front teach pop-in' }, h('div', { class: 'eyebrow center' }, kind));
  let rw = null;
  let speakText = note.german;
  if (note.type === 'c') {
    const cl = parseCloze(note.german);
    speakText = cl.full;
    card.append(h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de md' }, cl.parts.map((p) => (p.gap !== undefined ? h('mark', {}, p.gap) : p.text))), audioBtn(A, cl.full)),
      h('div', { class: 'en', style: 'margin-top:8px' }, note.english), note.french ? h('div', { class: 'fr' }, note.french) : null,
      k.hint ? h('div', { class: 'small muted', style: 'margin-top:8px' }, `Look at: ${k.hint}`) : null, ...tipEl(k));
  } else if (note.type === 'o') {
    speakText = note.german.split('/').map((t) => t.trim()).join(' ');
    card.append(h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de md' }, speakText), audioBtn(A, speakText)),
      h('div', { class: 'en', style: 'margin-top:8px' }, note.english),
      k.alt ? h('div', { class: 'small muted', style: 'margin-top:6px' }, 'Also right: ', k.alt.split('||').map((a) => a.split('/').map((t) => t.trim()).join(' ')).join(' · ')) : null, ...tipEl(k));
  } else if (note.type === 'p') {
    rw = recordWidget(A, () => note.german);
    card.append(h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de md' }, note.german), audioBtn(A, note.german)),
      h('div', { class: 'en', style: 'margin-top:8px' }, note.english), note.french ? h('div', { class: 'fr' }, note.french) : null,
      A.hasVoice ? h('div', { class: 'row', style: 'justify-content:center;margin-top:10px' }, h('button', { class: 'btn small', onclick: () => { audio.stop(); audio.speak(note.german, { slow: true }); } }, '🐢 Slow')) : null,
      rw, ...tipEl(k));
  } else {
    card.append(emojiEl(note), ...noteDetails(note, { showGerman: true, showMeaning: false }).slice(0, 1), ...enFr(note), ...noteDetails(note, { showGerman: false, showMeaning: false }));
  }
  stage.replaceChildren(card, h('button', { class: 'btn primary block big', style: 'margin-top:14px', onclick: () => { if (rw && rw.cleanup) rw.cleanup(); onDone(); } }, 'Got it →'));
  if (A.hasVoice && S().autoplay) setTimeout(() => audio.speak(speakText), 60);
  return { cleanup: () => { if (rw && rw.cleanup) rw.cleanup(); audio.stop(); } };
}

// One study card. onGrade(rating) is called once.
function studyCard(stage, item, onGrade) {
  const note = A.noteById.get(item.noteId);
  const st = A.store.card(item.cardId);
  const s = S();
  const card = h('div', { class: 'card pop-in' });
  const front = h('div', { class: 'front' });
  const actions = h('div');
  const backBox = h('div');
  const gradeBox = h('div');
  card.append(front, actions, backBox);
  stage.replaceChildren(card, gradeBox);
  const cleanups = [];
  let isRevealed = false;
  let auto = null;          // rating the app decided by itself (SPEC C2)
  let autoMsg = null;
  const art = isPluralOnly(note) ? 'die' : article(note.german);
  if (isLeech(st)) card.prepend(h('div', { class: 'badge' }, '🧩 hard word'));

  const showBtn = (label = 'Show answer') => h('button', { class: 'btn primary block big show-answer', style: 'margin-top:12px', onclick: () => reveal() }, label);
  const say = (text) => { if (A.hasVoice) { audio.stop(); audio.speak(text); } };
  const withRecord = (getText) => { const w = recordWidget(A, getText); if (w) cleanups.push(w.cleanup); return w; };
  let backContent = () => noteDetails(note, { showGerman: true });
  let audioOnReveal = note.german;

  function typingBox(expectedFn, prefix = '') {
    const input = h('input', { type: 'text', class: 'typing', id: 'typing', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Type the German', 'aria-label': 'Your answer' });
    const check = () => {
      const res = checkTyped(prefix ? `${prefix} ${input.value}` : input.value, expectedFn());
      input.disabled = true;
      auto = res.result === 'correct' ? 3 : res.result === 'almost' ? 2 : 1;
      autoMsg = [{ correct: 'Richtig!', almost: 'Almost! One letter off.', wrong: 'Not quite.' }[res.result], res.warning].filter(Boolean).join(' ');
      checkBtn.remove();
      reveal();
    };
    const checkBtn = h('button', { class: 'btn primary block big', style: 'margin-top:8px', onclick: check }, 'Check');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
    setTimeout(() => input.focus(), 50);
    return h('div', { style: 'margin-top:12px' }, input, checkBtn);
  }

  const k = note.keys;
  switch (`${note.type}:${item.tmpl}`) {
    case 'n:recognise': case 'v:recognise': case 'w:recognise':
      front.append(h('div', { class: 'prompt' }, 'What does it mean?'), h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de' }, deWord(note.german, { plural: isPluralOnly(note) })), audioBtn(A, note.german)));
      actions.append(showBtn());
      backContent = () => noteDetails(note, { showGerman: false });
      break;

    case 'n:produce': {
      front.append(emojiEl(note), ...enFr(note), h('div', { class: 'prompt' }, isPluralOnly(note) ? 'Article first (plural only), then say the word' : 'Tap the article'));
      let chosen = null;
      const btns = ['der', 'die', 'das'].map((a) => h('button', { class: `abtn ${a}`, onclick: () => {
        if (chosen) return;
        chosen = a;
        btns.forEach((b) => { b.classList.toggle('chosen', b.textContent === a); b.disabled = b.textContent !== a; });
        if (a !== art) { auto = 1; autoMsg = `It's ${art}, not ${a}.`; reveal(); return; }
        actions.append(s.typing ? typingBox(() => note.german, a) : h('div', {}, h('p', { class: 'center muted' }, `Right! Now say “${a} …” out loud.`), showBtn()));
      } }, a));
      front.append(h('div', { class: 'grid3' }, btns));
      backContent = () => noteDetails(note, { showGerman: true, showMeaning: false });
      break;
    }
    case 'v:produce': case 'w:produce':
      front.append(emojiEl(note), ...enFr(note), h('div', { class: 'prompt' }, 'Say it in German, out loud'));
      actions.append(s.typing ? typingBox(() => note.german) : showBtn());
      backContent = () => noteDetails(note, { showGerman: true, showMeaning: false });
      break;

    case 'n:plural':
      front.append(h('div', { class: 'prompt' }, 'Plural?'), h('div', { class: 'de md' }, deWord(note.german), ' → ', h('span', { class: 'art-die' }, 'die ___')), h('div', { class: 'fr' }, note.english));
      actions.append(showBtn());
      backContent = () => [h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de' }, deWord(k.pl, { plural: true })), audioBtn(A, k.pl)), ...tipEl({ tip: k.tip })];
      audioOnReveal = k.pl;
      break;

    case 'v:forms': {
      const person = k.er ? 'er' : 'du';
      const ans = `${person} ${k[person]}`;
      front.append(h('div', { class: 'prompt' }, 'Present tense'), h('div', { class: 'de md' }, `${note.german} → ${person} ___`), h('div', { class: 'fr' }, note.english));
      actions.append(showBtn());
      backContent = () => [h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de' }, ans), audioBtn(A, ans)),
        h('div', { class: 'small muted' }, [k.du && `du ${k.du}`, k.er && `er/sie/es ${k.er}`].filter(Boolean).join(' · ')), ...tipEl({ tip: k.tip })];
      audioOnReveal = ans;
      break;
    }
    case 'v:perf':
      front.append(h('div', { class: 'prompt' }, 'Perfekt?'), h('div', { class: 'de md' }, `${note.german} → ich ___`), h('div', { class: 'fr' }, note.english));
      actions.append(showBtn());
      backContent = () => [h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de' }, k.perf), audioBtn(A, k.perf))];
      audioOnReveal = k.perf;
      break;

    case 'p:produce':
      front.append(...enFr(note), h('div', { class: 'prompt' }, 'Say it in German, out loud'), withRecord(() => note.german));
      actions.append(showBtn());
      backContent = () => [h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de md' }, note.german), audioBtn(A, note.german)), ...tipEl(k)];
      break;

    case 'p:listen':
      front.append(h('div', { class: 'prompt' }, 'Listen. What does it mean?'),
        h('div', { class: 'row', style: 'justify-content:center;gap:12px' },
          h('button', { class: 'btn', onclick: () => say(note.german) }, '🔊 Replay'),
          h('button', { class: 'btn', onclick: () => { audio.stop(); audio.speak(note.german, { slow: true }); } }, '🐢 Slow')),
        withRecord(() => note.german));
      actions.append(showBtn());
      setTimeout(() => say(note.german), 60);
      backContent = () => [h('div', { class: 'de md' }, note.german), ...enFr(note)];
      audioOnReveal = null;
      break;

    case 'c:cloze': {
      const cl = parseCloze(note.german);
      front.append(h('div', { class: 'prompt' }, 'Say the missing word'),
        h('div', { class: 'de md' }, cl.parts.map((p) => (p.gap !== undefined ? h('span', { class: 'gap' }, ' ') : p.text))),
        k.hint ? h('div', { class: 'small', style: 'margin-top:8px' }, `Hint: ${k.hint}`) : null,
        h('div', { class: 'fr', style: 'margin-top:8px' }, note.english), withRecord(() => cl.full));
      actions.append(showBtn());
      backContent = () => [h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de md' }, cl.parts.map((p) => (p.gap !== undefined ? h('mark', {}, p.gap) : p.text))), audioBtn(A, cl.full)), ...tipEl(k)];
      audioOnReveal = cl.full;
      break;
    }
    case 'o:order': {
      const sentence = note.german.split('/').map((t) => t.trim()).join(' ');
      front.append(h('div', { class: 'prompt' }, 'Tap the words in the right order'), ...enFr(note));
      front.append(orderPuzzle(note, (ok) => {
        auto = ok ? 3 : 1;
        autoMsg = ok ? 'Richtig!' : 'Not quite. The right order:';
        reveal();
      }));
      backContent = () => [
        h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de md' }, sentence), audioBtn(A, sentence)),
        k.alt ? h('div', { class: 'small muted' }, 'Also right: ', k.alt.split('||').map((a) => a.split('/').map((t) => t.trim()).join(' ')).join(' · ')) : null,
        ...tipEl({ tip: k.tip })];
      audioOnReveal = sentence;
      break;
    }
    default:
      front.append(h('div', { class: 'de' }, note.german));
      actions.append(showBtn());
  }

  function reveal() {
    if (isRevealed) return;
    isRevealed = true;
    actions.querySelectorAll('.show-answer').forEach((b) => b.remove());
    card.querySelectorAll('.abtn').forEach((b) => { if (b.textContent === art) b.classList.add('right'); b.disabled = true; });
    backBox.replaceChildren(h('div', { class: 'back' },
      autoMsg ? h('p', { class: auto >= 3 ? 'result-ok' : auto === 2 ? 'result-almost' : 'result-bad' }, autoMsg) : null,
      backContent()));
    if (s.autoplay && audioOnReveal) say(audioOnReveal);
    drawGrades();
  }

  function drawGrades() {
    const now = Date.now();
    const pv = preview(st || newCardState(now), now, params(), srsOpts);
    const ivl = (g) => formatInterval(pv[g].due - now);
    let busy = false;
    const go = (g) => { if (!busy) { busy = true; onGrade(g); } };
    if (auto != null) {
      gradeBox.replaceChildren(h('button', { class: `btn primary block big ${auto === 1 ? 'again' : ''}`, style: 'margin-top:14px', onclick: () => go(auto) }, 'Continue'),
        h('div', { class: 'hintline' }, auto === 1 ? `Back in ${ivl(1)}` : `Next time in ${ivl(auto)}`));
      return;
    }
    gradeBox.replaceChildren(
      h('div', { class: 'grid2', style: 'margin-top:14px' },
        h('button', { class: 'gbtn miss', onclick: () => go(1) }, '✗ Missed it', h('small', {}, ivl(1))),
        h('button', { class: 'gbtn got', onclick: () => go(3) }, '✓ Got it', h('small', {}, ivl(3)))),
      h('div', { class: 'row', style: 'justify-content:center;gap:18px;margin-top:6px' },
        h('button', { class: 'linkbtn', onclick: () => go(2) }, `Hard · ${ivl(2)}`),
        h('button', { class: 'linkbtn', onclick: () => go(4) }, `Easy · ${ivl(4)}`)));
  }

  const onKey = (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if ((e.key === ' ' || e.key === 'Enter') && !isRevealed && actions.querySelector('.show-answer')) { e.preventDefault(); reveal(); return; }
    if (!isRevealed) return;
    if (e.key === 'Enter' && auto != null) { e.preventDefault(); onGrade(auto); return; }
    if (/^[1-4]$/.test(e.key) && auto == null) onGrade(Number(e.key));
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));
  return { cleanup: () => { cleanups.forEach((f) => { try { f(); } catch { /* ignore */ } }); audio.stop(); } };
}

// ---------- More practice ----------
function renderMore() {
  const r = root();
  r.append(h('div', { class: 'row', style: 'gap:8px' }, h('a', { class: 'icon-btn', href: '#/today', 'aria-label': 'Back' }, '‹'), h('h1', { style: 'margin:0' }, 'More practice')));
  const item = (href, title, text, onclick) => h(onclick ? 'button' : 'a', { class: 'more-item', href: onclick ? null : href, onclick },
    h('div', { style: 'font-weight:700' }, title), h('div', { class: 'small muted' }, text));
  r.append(h('div', { class: 'more-list' },
    item('#/quick', '⏱ Quick review', '5 minutes of due cards'),
    item('#/quiz', '📝 Daily quiz', '10 mixed questions, with your score history'),
    item('#/car', '🚗 Car mode', 'Hands-free: hear English, say German'),
    item('#/shadow', '🗣️ Shadowing', 'Listen, repeat, compare your voice'),
    item('#/drill/articles', 'der / die / das drill', '20 nouns, articles only'),
    item('#/drill/order', 'Word-order drill', '10 sentence puzzles'),
    item('#/drill/leech', '🧩 Hard words drill', 'The words you keep forgetting'),
    item(null, '💬 Copy weak words for Claude', 'Paste them into a speaking session', async () => {
      const { count, text } = weakWordsText(A);
      if (!count) { toast('No weak words yet. 🎉'); return; }
      const ok = await copyText(text);
      toast(ok ? `Copied ${count} words. Paste them into Claude.` : 'Could not copy. Try again.');
    })));
}

// ---------- Journey ----------
function renderJourney() {
  const r = root();
  r.append(h('h1', {}, 'Journey to A2'));
  const states = A.store.state.cards;
  const started = A.store.get('started', {});
  const introduced = A.store.get('introduced', {});
  const known = wordsKnown();
  const total = known.A1 + known.A2;
  r.append(h('div', { class: 'card' }, h('div', { class: 'row spread' }, h('div', { class: 'eyebrow' }, 'Words known'), h('span', { class: 'small muted' }, `${total} / 1300`)),
    h('div', { class: 'meter big' }, h('div', { style: `width:${Math.min(100, (total / 1300) * 100)}%` })),
    h('p', { class: 'small muted', style: 'margin:6px 0 0' }, `A1 ${known.A1} / 650 · A2 ${known.A2} / 650`)));

  const path = h('ol', { class: 'path' });
  for (const d of A.decks) {
    const notes = A.notes.filter((n) => n.deckId === d.id);
    const cards = notes.flatMap((n) => A.index.byNote.get(n.id));
    const seen = notes.filter((n) => introduced[n.id] != null).length;
    const mature = cards.filter((c) => states[c.id] && states[c.id].stability >= MATURE_STABILITY && states[c.id].state === State.Review).length;
    const running = d.core ? started[d.id] !== false : !!started[d.id];
    const pct = notes.length ? Math.round((seen / notes.length) * 100) : 0;
    const status = pct >= 100 ? 'done' : running ? 'now' : '';
    path.append(h('li', { class: `stop ${status}` },
      h('i', { 'aria-hidden': 'true' }),
      h('div', { class: 'grow', style: 'min-width:0' },
        h('div', { class: 'row spread' }, h('div', { style: 'font-weight:700' }, d.title), d.core ? h('span', { class: 'pill' }, 'Core') : null),
        h('div', { class: 'small muted' }, `${notes.length} notes · ${pct}% seen · ${cards.length ? Math.round((mature / cards.length) * 100) : 0}% mature`),
        h('div', { class: 'meter' }, h('div', { style: `width:${pct}%` })),
        pct < 100 ? h('button', { class: `btn small ${running ? 'ghost' : 'primary'}`, style: 'margin-top:8px', onclick: async () => {
          await A.store.set('started', { ...A.store.get('started', {}), [d.id]: !running });
          toast(running ? 'Paused. Reviews of this deck still run.' : 'Started! New words from this lesson come in your daily lesson.');
          route();
        } }, running ? 'Pause new words' : (d.core ? 'Resume' : 'Start this lesson')) : null)));
  }
  path.append(h('li', { class: 'stop goal' }, h('i', { 'aria-hidden': 'true' }), h('div', { style: 'font-weight:700' }, 'Goethe-Zertifikat A2')));
  r.append(h('h2', {}, 'Lessons'), path);

  const leeches = [...new Set(Object.entries(states).filter(([, st]) => isLeech(st)).map(([id]) => id.split(':')[0]))].map((id) => A.noteById.get(id)).filter(Boolean);
  r.append(h('h2', {}, 'Hard words 🧩'), h('div', { class: 'card' }, leeches.length
    ? h('ul', { class: 'list' }, leeches.map((n) => h('li', {}, h('span', {}, deWord(noteLabel(n), { plural: isPluralOnly(n) })), h('span', { class: 'muted small' }, n.english))))
    : h('p', { class: 'muted', style: 'margin:0' }, 'None yet. Words you forget 6 times show up here.')));
}

// ---------- Me ----------
function renderMe() {
  const r = root();
  const now = Date.now();
  const today = dayNumber(now);
  const st = streak([...activeDays()], today);
  const known = wordsKnown();
  r.append(h('h1', {}, 'Me'), h('div', { class: 'grid3' },
    h('div', { class: 'card center tight' }, h('div', { class: 'stat' }, st ? `🔥${st}` : '0'), h('div', { class: 'small muted' }, 'day streak')),
    h('div', { class: 'card center tight' }, h('div', { class: 'stat' }, known.A1 + known.A2), h('div', { class: 'small muted' }, 'words known')),
    h('div', { class: 'card center tight' }, h('div', { class: 'stat' }, A.store.state.revlog.length), h('div', { class: 'small muted' }, 'answers'))));
  const days = reviewsByDay();
  const counts = [];
  for (let d = today - 13; d <= today; d++) counts.push(days.get(d) || 0);
  const max = Math.max(1, ...counts);
  const quiz = quizHistory(A);
  r.append(h('h2', {}, 'Last 14 days'), h('div', { class: 'card' },
    h('div', { class: 'bars', role: 'img', 'aria-label': `Answers per day, last 14 days: ${counts.join(', ')}` },
      counts.map((c) => h('div', { class: c ? '' : 'zero', style: `height:${Math.max(4, (c / max) * 100)}%`, title: `${c}` }))),
    h('p', { class: 'small muted', style: 'margin-bottom:0' }, `${counts.reduce((a, b) => a + b, 0)} answers · today ${counts[13]}`),
    quiz.length ? h('p', { class: 'small muted', style: 'margin:4px 0 0' }, `Daily quiz: ${quiz.map((x) => `${x.score}/${x.total}`).join(' · ')}`) : null));
  r.append(h('a', { class: 'btn block', href: '#/settings', style: 'margin-top:16px' }, '⚙️ Settings'),
    h('p', { class: 'tiny muted center', style: 'margin-top:20px' }, `Wortkiste ${VERSION} · works offline · no accounts, no tracking. Your data stays on this device.`));
}

// ---------- Settings ----------
function renderSettings() {
  const r = root();
  const s = S();
  r.append(h('div', { class: 'row', style: 'gap:8px' }, h('a', { class: 'icon-btn', href: '#/me', 'aria-label': 'Back' }, '‹'), h('h1', { style: 'margin:0' }, 'Settings')));
  const sw = (key, label, help) => h('div', { class: 'setting' }, h('div', { class: 'row spread' }, h('label', { class: 'title grow', for: `sw-${key}` }, label),
    h('label', { class: 'switch' }, h('input', { type: 'checkbox', id: `sw-${key}`, checked: !!s[key], onchange: async (e) => { await saveSettings({ [key]: e.target.checked }); route(); } }), h('span'))),
  help ? h('p', { class: 'small muted', style: 'margin:4px 0 0' }, help) : null);
  const stepper = (key, min, max, onChange) => {
    const out = h('output', {}, s[key]);
    const set = async (v) => { v = Math.max(min, Math.min(max, v)); out.textContent = v; await saveSettings({ [key]: v }); if (onChange) onChange(v); };
    return h('div', { class: 'stepper' }, h('button', { class: 'icon-btn', 'aria-label': 'Less', onclick: () => set(S()[key] - 1) }, '−'), out, h('button', { class: 'icon-btn', 'aria-label': 'More', onclick: () => set(S()[key] + 1) }, '+'));
  };

  // Learning
  const forecast = h('p', { class: 'small muted', style: 'margin:4px 0 0' });
  const updForecast = () => { forecast.textContent = `Expected daily reviews in 30 days: ~${forecastReviews(A.store.state.cards, S().newPerDay)}`; };
  updForecast();
  r.append(h('h2', {}, 'Learning'), h('div', { class: 'card' },
    h('div', { class: 'setting' }, h('div', { class: 'row spread' }, h('label', { class: 'title' }, 'New words per day'), stepper('newPerDay', 3, 20, updForecast)), forecast),
    h('div', { class: 'setting' }, h('div', { class: 'row spread' }, h('label', { class: 'title' }, 'Core words per day'), stepper('corePerDay', 0, 20)),
      h('p', { class: 'small muted', style: 'margin:4px 0 0' }, 'Out of the new words, how many come from the Core word list.')),
    h('div', { class: 'setting' }, h('label', { class: 'title' }, 'Desired retention'),
      h('div', { class: 'seg', style: 'margin-top:8px' }, [0.85, 0.9, 0.95].map((v) => h('button', { class: s.retention === v ? 'on' : '', onclick: async () => { await saveSettings({ retention: v }); route(); } }, `${Math.round(v * 100)}%`))),
      h('p', { class: 'small muted', style: 'margin:6px 0 0' }, 'Higher = remember more, more reviews.')),
    sw('backlogGuard', 'Backlog guard', 'If more than 120 reviews pile up, new words pause until you are under 60.'),
    h('div', { class: 'setting' }, h('label', { class: 'title', for: 'maxrev' }, 'Reviews per day'),
      h('select', { id: 'maxrev', style: 'margin-top:8px', onchange: async (e) => saveSettings({ maxReviews: Number(e.target.value) }) },
        [0, 50, 100, 150, 200, 300].map((v) => h('option', { value: v, selected: s.maxReviews === v }, v ? `At most ${v}` : 'No limit')))),
    sw('typing', 'Typing mode', 'Type the German on "say it" cards for nouns, verbs and words, instead of saying it aloud.')));

  // Audio
  const voices = audio.germanVoices();
  const rateOut = h('span', {}, `${s.rate.toFixed(2)}×`);
  r.append(h('h2', {}, 'Audio'), h('div', { class: 'card' },
    !A.hasVoice ? h('div', { class: 'notice', style: 'margin-top:0' }, 'No German voice found on this device, so 🔊 buttons and listening cards are hidden. Add one with the tip below, then reopen the app.') : null,
    sw('autoplay', 'Play German after reveal'),
    sw('sounds', 'Sounds for right and wrong answers'),
    voices.length ? h('div', { class: 'setting' }, h('label', { class: 'title', for: 'voice' }, 'German voice'),
      h('select', { id: 'voice', style: 'margin-top:8px', onchange: async (e) => { await saveSettings({ voice: e.target.value }); audio.speak('Guten Morgen! Wie geht es dir?'); } },
        h('option', { value: '' }, `Automatic (${audio.bestGermanVoice() ? audio.bestGermanVoice().name : 'best'})`),
        voices.map((v) => h('option', { value: v.voiceURI, selected: s.voice === v.voiceURI }, `${v.name} (${v.lang})`)))) : null,
    h('div', { class: 'setting' }, h('div', { class: 'row spread' }, h('label', { class: 'title', for: 'rate' }, 'Speed'), rateOut),
      h('input', { type: 'range', id: 'rate', min: 0.7, max: 1, step: 0.05, value: s.rate, oninput: (e) => { rateOut.textContent = `${Number(e.target.value).toFixed(2)}×`; },
        onchange: async (e) => { await saveSettings({ rate: Number(e.target.value) }); audio.speak('Ich lerne Deutsch.'); } })),
    A.hasVoice ? h('button', { class: 'btn small', onclick: () => audio.speak('Hallo Saad! Ich bin deine Stimme.') }, '🔊 Test voice') : null,
    h('p', { class: 'small muted' }, 'Better voice for free: iPhone Settings → Accessibility → Spoken Content → Voices → German → download ', h('i', {}, 'Anna (Enhanced)'), '.')));

  // Backup
  const restoreBox = h('div');
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { toast('That file could not be read.'); return; }
    if (!data || data.app !== 'wortkiste') { toast('This file is not a Wortkiste backup.'); return; }
    const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'unknown date';
    restoreBox.replaceChildren(h('div', { class: 'notice' }, `Replace everything on this device with the backup from ${when}? (${Object.keys(data.cards || {}).length} cards)`,
      h('div', { class: 'grid2', style: 'margin-top:8px' },
        h('button', { class: 'btn danger', onclick: async () => {
          try { await A.store.importJSON(data); applyAudioPrefs(); toast('Backup restored.'); route(); } catch (err) { toast(err.message); }
        } }, 'Replace'),
        h('button', { class: 'btn', onclick: () => restoreBox.replaceChildren() }, 'Cancel'))));
  } });
  r.append(h('h2', {}, 'Backup'), h('div', { class: 'card' },
    h('p', { class: 'small muted', style: 'margin-top:0' }, 'Your progress is stored only on this device. Save a backup file now and then (for example to iCloud Drive via "Save to Files").'),
    h('div', { class: 'grid2' }, h('button', { class: 'btn', onclick: downloadBackup }, '⬇️ Save backup'), h('button', { class: 'btn', onclick: () => fileInput.click() }, '⬆️ Restore')),
    fileInput, restoreBox));

  // Deck problems
  r.append(h('h2', {}, 'Deck problems'), h('div', { class: 'card' }, A.problems.length
    ? A.problems.map((p) => h('div', { class: 'problem' }, h('b', {}, `${p.file}${p.line ? `, line ${p.line}` : ''}: `), p.error, p.text ? h('div', {}, h('code', {}, p.text)) : null))
    : h('p', { class: 'muted', style: 'margin:0' }, `No problems. ${A.decks.length} decks, ${A.notes.length} notes.`)));

  // Reset
  const resetInput = h('input', { type: 'text', placeholder: 'Type RESET', autocapitalize: 'characters', autocomplete: 'off', 'aria-label': 'Type RESET to confirm' });
  r.append(h('h2', {}, 'Reset'), h('div', { class: 'card' },
    h('p', { class: 'small muted', style: 'margin-top:0' }, 'Deletes all progress and settings on this device. Save a backup first. Type RESET to confirm.'),
    resetInput, h('button', { class: 'btn danger block', style: 'margin-top:8px', onclick: async () => {
      if (resetInput.value.trim() !== 'RESET') { toast('Type RESET (capital letters) to confirm.'); return; }
      await A.store.reset(); A.lesson = null; A.undo = null; applyAudioPrefs(); toast('Everything was reset.'); A.go('today');
    } }, 'Reset everything')));

  r.append(h('p', { class: 'tiny muted center', style: 'margin-top:24px' }, `Wortkiste ${VERSION} · works offline · no accounts, no tracking. Your data stays on this device.`));
}

async function downloadBackup() {
  const data = JSON.stringify(A.store.exportJSON());
  const name = `wortkiste-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([data], { type: 'application/json' });
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Backup saved.');
}

boot();
