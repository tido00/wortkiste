// app.js: UI and router. Screens: Today, Session, Decks, Settings, plus the extra modes.

import { review, preview, newCardState, State, DEFAULT_PARAMS, formatInterval } from './srs.js';
import { parseDeckFile, mergeDecks, article, parseCloze, checkTyped, isPluralOnly } from './decks.js';
import {
  buildQueue, buildCardIndex, dayNumber, appDayDiff, createSession, sessionNext, sessionAfterGrade,
  sessionRemaining, isLeech, streak, forecastReviews, estimateMinutes, DEFAULT_SETTINGS, MATURE_STABILITY, GUARD_OFF,
} from './queue.js';
import { createStore, idbBackend, memoryBackend } from './store.js';
import * as audio from './audio.js';
import {
  h, toast, deWord, exampleWithNoun, audioBtn, recordWidget, orderPuzzle, weakWordsText, copyText,
  renderQuiz, renderCar, renderShadow, renderDrill, quizHistory,
} from './modes.js';

const VERSION = '1.0.0';
const A = {
  store: null, notes: [], decks: [], problems: [], index: null, noteById: new Map(), deckById: new Map(),
  hasVoice: false, session: null, undo: null, cleanup: null, dayDiff: appDayDiff,
  go: (r) => { location.hash = `#/${r}`; },
};
const root = () => document.getElementById('app');
const S = () => ({ ...DEFAULT_SETTINGS, ...(A.store.get('settings', {}) || {}) });
const params = () => ({ ...DEFAULT_PARAMS, requestRetention: S().retention });
const srsOpts = { dayDiff: appDayDiff };
async function saveSettings(patch) { await A.store.set('settings', { ...S(), ...patch }); applyAudioPrefs(); }
function applyAudioPrefs() { const s = S(); audio.setPrefs({ voice: s.voice, rate: s.rate }); }

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
  // Voices can arrive late on some browsers.
  if (!A.hasVoice) audio.loadVoices(4000).then(() => { if (audio.hasGerman() && !A.hasVoice) { A.hasVoice = true; if (!A.session) route(); } });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------- Router ----------
function route() {
  if (A.cleanup) { try { A.cleanup(); } catch { /* ignore */ } A.cleanup = null; }
  audio.stop();
  const [name = 'today', arg] = location.hash.replace(/^#\/?/, '').split('/');
  const r = root();
  r.replaceChildren();
  window.scrollTo(0, 0);
  const full = ['session', 'quiz', 'car', 'shadow', 'drill'].includes(name);
  document.body.classList.toggle('no-tabs', full);
  document.querySelectorAll('nav.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
  const screens = {
    today: renderToday, session: renderSession, decks: renderDecks, settings: renderSettings,
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
const reviewsByDay = () => {
  const m = new Map();
  for (const e of A.store.state.revlog) { const d = dayNumber(e.t); m.set(d, (m.get(d) || 0) + 1); }
  return m;
};
const courseStarted = () => { const st = A.store.get('started', {}); return A.decks.some((d) => !d.core && st[d.id]); };
const noteLabel = (n) => (n.type === 'c' ? parseCloze(n.german).full : n.type === 'o' ? n.german.split('/').map((t) => t.trim()).join(' ') : n.german);

// ---------- Today ----------
function renderToday() {
  const r = root();
  const now = Date.now();
  const today = dayNumber(now);
  const dateStr = new Date(now).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  r.append(h('h1', {}, 'Wortkiste'), h('p', { class: 'muted', style: 'margin-top:0' }, dateStr));

  if (!A.notes.length) {
    r.append(h('div', { class: 'card' }, 'No decks could be loaded. Check your connection and reload. (Details in Settings → Deck problems.)'));
    return;
  }
  if (!courseStarted()) {
    const first = A.decks.find((d) => !d.core);
    if (first) {
      r.append(h('div', { class: 'card' }, h('h2', { style: 'margin-top:0' }, 'Willkommen, Saad! 👋'),
        h('p', {}, 'Start with your first lesson. New lessons start when you tap "Start this deck" on the Decks screen.'),
        h('button', { class: 'btn primary block', onclick: async () => { await A.store.set('started', { ...A.store.get('started', {}), [first.id]: true }); route(); } }, `Start "${first.title}"`)));
    }
  }

  const q = todayQueue(now);
  const due = q.counts.learning + q.counts.review;
  const total = due + q.counts.new;
  const days = reviewsByDay();
  const st = streak([...days.keys()], today);
  r.append(h('div', { class: 'card' },
    h('div', { class: 'grid3 center' },
      h('div', {}, h('div', { class: 'stat' }, due), h('div', { class: 'small muted' }, 'due')),
      h('div', {}, h('div', { class: 'stat' }, q.counts.new), h('div', { class: 'small muted' }, 'new')),
      h('div', {}, h('div', { class: 'stat' }, st ? `🔥${st}` : '0'), h('div', { class: 'small muted' }, st === 1 ? 'day streak' : 'days streak'))),
    total ? h('p', { class: 'center muted small', style: 'margin-bottom:0' }, `about ${estimateMinutes(due, q.counts.new)} min`) : null));

  if (q.guard.active) r.append(h('div', { class: 'notice' }, `Catching up: new words paused until reviews are under ${GUARD_OFF}.`));

  if (total) {
    r.append(h('h2', {}, 'Start'), h('div', { class: 'grid3' },
      h('button', { class: 'btn', onclick: () => startSession(5) }, '5 min'),
      h('button', { class: 'btn', onclick: () => startSession(15) }, '15 min'),
      h('button', { class: 'btn primary', onclick: () => startSession(0) }, 'Until done')));
  } else {
    r.append(h('div', { class: 'card center', style: 'margin-top:12px' }, h('div', { style: 'font-size:40px' }, '🎉'), h('p', {}, courseStarted() ? 'All done for today. Gut gemacht!' : 'Start a deck to get new words.')));
  }

  const quizToday = (A.store.get('quiz', []) || []).find((x) => x.day === today);
  r.append(h('h2', {}, 'Practice'), h('div', { class: 'grid2' },
    h('a', { class: 'btn', href: '#/quiz' }, quizToday ? `✅ Quiz ${quizToday.score}/${quizToday.total}` : '📝 Daily quiz'),
    h('a', { class: 'btn', href: '#/car' }, '🚗 Car mode'),
    h('a', { class: 'btn', href: '#/shadow' }, '🗣️ Shadowing'),
    h('a', { class: 'btn', href: '#/decks' }, '🎯 Drills')));

  const counts = [];
  for (let d = today - 13; d <= today; d++) counts.push(days.get(d) || 0);
  const max = Math.max(1, ...counts);
  const sum = counts.reduce((a, b) => a + b, 0);
  r.append(h('h2', {}, 'Last 14 days'), h('div', { class: 'card' },
    h('div', { class: 'bars', role: 'img', 'aria-label': `Reviews per day, last 14 days: ${counts.join(', ')}` },
      counts.map((c) => h('div', { class: c ? '' : 'zero', style: `height:${Math.max(4, (c / max) * 100)}%`, title: `${c}` }))),
    h('p', { class: 'small muted', style: 'margin-bottom:0' }, `${sum} reviews · today ${counts[13]}`),
    quizHistory(A).length ? h('p', { class: 'small muted', style: 'margin:4px 0 0' }, `Quiz: ${quizHistory(A).map((x) => `${x.score}/${x.total}`).join(' · ')}`) : null));
}

// ---------- Session ----------
function startSession(minutes) {
  const now = Date.now();
  const q = todayQueue(now);
  A.session = createSession(q.queue, { now, minutes });
  A.session.total = q.queue.length;
  A.undo = null;
  if (location.hash === '#/session') route(); else A.go('session');
}

function renderSession() {
  const r = root();
  if (!A.session) { A.go('today'); return; }
  const s = A.session;
  const progress = h('div', { class: 'progress' }, h('div'));
  const undoBtn = h('button', { class: 'btn small ghost', disabled: !A.undo, onclick: doUndo }, '↶ Undo');
  const left = h('span', { class: 'small muted' });
  r.append(h('div', { class: 'topbar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Stop', onclick: () => { A.session = null; A.go('today'); } }, '✕'),
    progress, left, undoBtn));
  const stage = h('div', { class: 'study' });
  r.append(stage);
  let view = null;

  const updateBar = () => {
    const rem = sessionRemaining(s);
    const done = s.done.length;
    progress.firstChild.style.width = `${(done / Math.max(1, done + rem)) * 100}%`;
    left.textContent = rem ? `${rem}` : '';
    undoBtn.disabled = !A.undo;
  };

  function showNext(item) {
    if (view && view.cleanup) view.cleanup();
    audio.stop();
    const it = item || sessionNext(s, Date.now());
    updateBar();
    if (!it) { endScreen(); return; }
    view = studyCard(stage, it, (rating) => grade(it, rating));
  }

  async function grade(item, rating) {
    const now = Date.now();
    const prev = A.store.card(item.cardId) || null;
    const base = prev || newCardState(now);
    const next = review(base, rating, now, params(), srsOpts);
    const introduced = A.store.get('introduced', {});
    const snapshot = { pos: s.pos, learning: s.learning.map((x) => ({ ...x })), done: s.done.slice() };
    let introducedNow = false;
    if (introduced[item.noteId] == null) { introducedNow = true; await A.store.set('introduced', { ...introduced, [item.noteId]: dayNumber(now) }); }
    await A.store.putCard(item.cardId, next);
    const logId = await A.store.addLog({ cardId: item.cardId, noteId: item.noteId, tmpl: item.tmpl, t: now, rating, wasNew: base.state === State.New, state: base.state });
    A.undo = { item, prev, logId, introducedNow, snapshot };
    sessionAfterGrade(s, item, next, now, rating);
    if (next.lapses >= 6 && (!prev || prev.lapses < 6)) toast('🧩 This one is a hard word. It is now on your Hard words list.');
    showNext();
  }

  async function doUndo() {
    const u = A.undo;
    if (!u) return;
    A.undo = null;
    if (u.prev) await A.store.putCard(u.item.cardId, u.prev); else await A.store.delCard(u.item.cardId);
    await A.store.delLog(u.logId);
    if (u.introducedNow) { const intro = { ...A.store.get('introduced', {}) }; delete intro[u.item.noteId]; await A.store.set('introduced', intro); }
    s.pos = u.snapshot.pos; s.learning = u.snapshot.learning; s.done = u.snapshot.done;
    if (s.pos > 0 && s.main[s.pos - 1] && s.main[s.pos - 1].cardId === u.item.cardId) s.pos--;
    else s.learning = s.learning.filter((x) => x.cardId !== u.item.cardId);
    showNext(u.item);
  }

  function endScreen() {
    const done = s.done;
    const now = Date.now();
    const today = dayNumber(now);
    const first = new Map();
    for (const d of done) if (!first.has(d.cardId)) first.set(d.cardId, d.rating);
    const correct = [...first.values()].filter((x) => x > 1).length;
    const acc = first.size ? Math.round((correct / first.size) * 100) : 0;
    const newCount = done.filter((d) => d.kind === 'new').length;
    const hard = [...new Set(A.store.state.revlog.filter((e) => e.rating === 1 && dayNumber(e.t) === today).map((e) => e.noteId))].map((id) => A.noteById.get(id)).filter(Boolean);
    const more = todayQueue(now).queue.length;
    A.session = null; A.undo = null;
    stage.replaceChildren(h('div', { class: 'card center' },
      h('div', { style: 'font-size:44px' }, '🎉'), h('h2', { style: 'margin-top:4px' }, 'Gut gemacht!'),
      h('div', { class: 'grid3' },
        h('div', {}, h('div', { class: 'stat' }, first.size), h('div', { class: 'small muted' }, 'cards')),
        h('div', {}, h('div', { class: 'stat' }, newCount), h('div', { class: 'small muted' }, 'new')),
        h('div', {}, h('div', { class: 'stat' }, `${acc}%`), h('div', { class: 'small muted' }, 'right first time')))),
    hard.length ? h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, 'Hard words today'), h('ul', { class: 'list' }, hard.map((n) => h('li', {}, h('span', {}, deWord(noteLabel(n), { plural: isPluralOnly(n) })), h('span', { class: 'muted small' }, n.english))))) : null,
    h('div', { class: 'grid2', style: 'margin-top:12px' },
      more ? h('button', { class: 'btn', onclick: () => startSession(0) }, `Keep going (${more})`) : h('a', { class: 'btn', href: '#/quiz' }, '📝 Daily quiz'),
      h('button', { class: 'btn primary', onclick: () => A.go('today') }, 'Done')));
    updateBar();
    undoBtn.disabled = true;
  }

  const onKey = (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (!view) return;
    if ((e.key === ' ' || e.key === 'Enter') && view.reveal) { e.preventDefault(); view.reveal(); }
    if (/^[1-4]$/.test(e.key) && view.revealed && view.revealed()) view.grade(Number(e.key));
  };
  document.addEventListener('keydown', onKey);
  showNext();
  return () => { document.removeEventListener('keydown', onKey); if (view && view.cleanup) view.cleanup(); };
}

// One study card. Returns { reveal, revealed, grade, cleanup }.
function studyCard(stage, item, onGrade) {
  const note = A.noteById.get(item.noteId);
  const st = A.store.card(item.cardId);
  const s = S();
  const card = h('div', { class: 'card' });
  const front = h('div', { class: 'front' });
  const actions = h('div');
  const backBox = h('div');
  const gradeBox = h('div');
  card.append(front, actions, backBox);
  stage.replaceChildren(card, gradeBox);
  const cleanups = [];
  let isRevealed = false;
  let suggest = null;
  const art = isPluralOnly(note) ? 'die' : article(note.german);

  const badge = h('div', { class: 'badge', style: 'text-align:right;min-height:18px' },
    isLeech(st) ? '🧩 hard word  ' : '', item.kind === 'new' ? 'new' : '');
  card.prepend(badge);

  const showBtn = (label = 'Show answer') => h('button', { class: 'btn primary block', style: 'margin-top:12px', onclick: () => reveal() }, label);
  const enFr = () => [h('div', { class: 'en' }, note.english), note.french ? h('div', { class: 'fr' }, note.french) : null];
  const emoji = () => (note.keys.img ? h('div', { class: 'emoji' }, note.keys.img) : null);
  const say = (text) => { if (A.hasVoice) { audio.stop(); audio.speak(text); } };
  const withRecord = (getText) => { const w = recordWidget(A, getText); if (w) cleanups.push(w.cleanup); return w; };

  // Details shown on the back of most cards.
  function details({ showGerman = false, showMeaning = true } = {}) {
    const k = note.keys;
    const out = [];
    if (showGerman) out.push(h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de' }, deWord(note.german, { plural: isPluralOnly(note) })), audioBtn(A, note.german)));
    if (showMeaning) out.push(emoji(), ...enFr());
    if (note.type === 'n' && k.pl) out.push(h('div', { class: 'small muted', style: 'margin-top:6px' }, k.pl === '-' ? 'no plural' : k.pl === 'only' ? 'plural only' : h('span', {}, 'plural: ', deWord(k.pl, { plural: true }))));
    if (note.type === 'v') {
      const forms = [k.du && `du ${k.du}`, k.er && `er ${k.er}`, k.perf && `Perfekt: ${k.perf}`, k.sep && `separable: ${k.sep}-`].filter(Boolean);
      if (forms.length) out.push(h('div', { class: 'small muted', style: 'margin-top:6px' }, forms.join(' · ')));
    }
    if (k.ex) out.push(h('div', { class: 'ex' }, h('div', { class: 'row', style: 'justify-content:center' }, h('span', {}, exampleWithNoun(k.ex, note)), audioBtn(A, k.ex)), k.exen ? h('div', { class: 'exen' }, k.exen) : null));
    if (k.tip) out.push(h('div', { class: 'tip' }, '💡 ', k.tip));
    if (k.ff) out.push(h('div', { class: 'ff' }, '⚠️ ', k.ff));
    return out;
  }

  let backContent = () => details({ showGerman: true });
  let audioOnReveal = note.german;

  function typingBox(expectedFn, prefix = '') {
    const input = h('input', { type: 'text', class: 'typing', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Type the German', 'aria-label': 'Your answer' });
    const result = h('div', { class: 'center', style: 'margin-top:8px;min-height:24px' });
    const check = () => {
      const exp = expectedFn();
      const res = checkTyped(prefix ? `${prefix} ${input.value}` : input.value, exp);
      input.disabled = true;
      const label = { correct: ['result-ok', 'Richtig!'], almost: ['result-almost', 'Almost!'], wrong: ['result-bad', 'Not quite'] }[res.result];
      result.replaceChildren(h('span', { class: label[0] }, label[1]), res.warning ? h('div', { class: 'small muted' }, res.warning) : null);
      suggest = res.result === 'correct' ? 3 : res.result === 'almost' ? 2 : 1;
      reveal();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
    setTimeout(() => input.focus(), 50);
    return h('div', { style: 'margin-top:12px' }, input, result, h('button', { class: 'btn primary block', style: 'margin-top:8px', onclick: check }, 'Check'));
  }

  const k = note.keys;
  switch (`${note.type}:${item.tmpl}`) {
    case 'n:recognise': case 'v:recognise': case 'w:recognise':
      front.append(h('div', { class: 'prompt' }, 'What does it mean?'), h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de' }, deWord(note.german, { plural: isPluralOnly(note) })), audioBtn(A, note.german)));
      actions.append(showBtn());
      backContent = () => details({ showGerman: false });
      break;

    case 'n:produce': {
      front.append(emoji(), ...enFr(), h('div', { class: 'prompt' }, isPluralOnly(note) ? 'Article first (plural only), then say the word aloud' : 'Tap the article first'));
      let chosen = null;
      const btns = ['der', 'die', 'das'].map((a) => h('button', { class: `abtn ${a}`, onclick: () => {
        if (chosen) return;
        chosen = a;
        btns.forEach((b) => { b.classList.toggle('chosen', b.textContent === a); b.disabled = b.textContent !== a; });
        if (a !== art) suggest = 1;
        actions.append(s.typing ? typingBox(() => note.german, a) : h('div', {}, h('p', { class: 'center muted' }, `Now say “${a} …” aloud.`), showBtn()));
      } }, a));
      front.append(h('div', { class: 'grid3' }, btns));
      backContent = () => [
        chosen && chosen !== art ? h('p', { class: 'result-bad' }, `You chose ${chosen}. It's ${art}:`) : null,
        ...details({ showGerman: true, showMeaning: false })];
      break;
    }
    case 'v:produce': case 'w:produce':
      front.append(emoji(), ...enFr(), h('div', { class: 'prompt' }, 'Say it in German, out loud'));
      actions.append(s.typing ? typingBox(() => note.german) : showBtn());
      backContent = () => details({ showGerman: true, showMeaning: false });
      break;

    case 'n:plural': {
      front.append(h('div', { class: 'prompt' }, 'Plural?'), h('div', { class: 'de md' }, deWord(note.german), ' → ', h('span', { class: 'art-die' }, 'die ___')), h('div', { class: 'fr' }, note.english));
      actions.append(showBtn());
      backContent = () => [h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de' }, deWord(k.pl, { plural: true })), audioBtn(A, k.pl)), k.tip ? h('div', { class: 'tip' }, '💡 ', k.tip) : null];
      audioOnReveal = k.pl;
      break;
    }
    case 'v:forms': {
      const person = k.er ? 'er' : 'du';
      front.append(h('div', { class: 'prompt' }, 'Present tense'), h('div', { class: 'de md' }, `${note.german} → ${person} ___`), h('div', { class: 'fr' }, note.english));
      actions.append(showBtn());
      const ans = `${person} ${k[person]}`;
      backContent = () => [h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de' }, ans), audioBtn(A, ans)),
        h('div', { class: 'small muted' }, [k.du && `du ${k.du}`, k.er && `er/sie/es ${k.er}`].filter(Boolean).join(' · ')), k.tip ? h('div', { class: 'tip' }, '💡 ', k.tip) : null];
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
      front.append(...enFr(), h('div', { class: 'prompt' }, 'Say it in German, out loud'), withRecord(() => note.german));
      actions.append(showBtn());
      backContent = () => [h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de md' }, note.german), audioBtn(A, note.german)), k.tip ? h('div', { class: 'tip' }, '💡 ', k.tip) : null, k.ff ? h('div', { class: 'ff' }, '⚠️ ', k.ff) : null];
      break;

    case 'p:listen':
      front.append(h('div', { class: 'prompt' }, 'Listen. What does it mean?'),
        h('div', { class: 'row', style: 'justify-content:center;gap:12px' },
          h('button', { class: 'btn', onclick: () => say(note.german) }, '🔊 Replay'),
          h('button', { class: 'btn', onclick: () => { audio.stop(); audio.speak(note.german, { slow: true }); } }, '🐢 Slow')),
        withRecord(() => note.german));
      actions.append(showBtn());
      setTimeout(() => say(note.german), 60);
      backContent = () => [h('div', { class: 'de md' }, note.german), ...enFr()];
      audioOnReveal = null;
      break;

    case 'c:cloze': {
      const cl = parseCloze(note.german);
      front.append(h('div', { class: 'prompt' }, 'Say the missing word'),
        h('div', { class: 'de md' }, cl.parts.map((p) => (p.gap !== undefined ? h('span', { class: 'gap' }, ' ') : p.text))),
        k.hint ? h('div', { class: 'small', style: 'margin-top:8px' }, `Hint: ${k.hint}`) : null,
        h('div', { class: 'fr', style: 'margin-top:8px' }, note.english), withRecord(() => cl.full));
      actions.append(showBtn());
      backContent = () => [h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de md' }, cl.parts.map((p) => (p.gap !== undefined ? h('mark', {}, p.gap) : p.text))), audioBtn(A, cl.full)),
        k.tip ? h('div', { class: 'tip' }, '💡 ', k.tip) : null, k.ff ? h('div', { class: 'ff' }, '⚠️ ', k.ff) : null];
      audioOnReveal = cl.full;
      break;
    }
    case 'o:order': {
      front.append(h('div', { class: 'prompt' }, 'Tap the words in the right order'), ...enFr());
      let result = null;
      front.append(orderPuzzle(note, (ok, words) => {
        result = { ok, words };
        suggest = ok ? 3 : 1;
        reveal();
      }));
      const sentence = note.german.split('/').map((t) => t.trim()).join(' ');
      backContent = () => [
        result ? h('p', { class: result.ok ? 'result-ok' : 'result-bad' }, result.ok ? 'Richtig!' : 'Not quite. Correct order:') : null,
        h('div', { class: 'row', style: 'justify-content:center' }, h('div', { class: 'de md' }, sentence), audioBtn(A, sentence)),
        k.alt ? h('div', { class: 'small muted' }, 'Also right: ', k.alt.split('||').map((a) => a.split('/').map((t) => t.trim()).join(' ')).join(' · ')) : null,
        k.tip ? h('div', { class: 'tip' }, '💡 ', k.tip) : null];
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
    actions.querySelectorAll('button.btn.primary').forEach((b) => { if (b.textContent === 'Show answer') b.remove(); });
    card.querySelectorAll('.abtn').forEach((b) => { if (b.textContent === art) b.classList.add('right'); b.disabled = true; });
    backBox.replaceChildren(h('div', { class: 'back' }, backContent()));
    if (s.autoplay && audioOnReveal) say(audioOnReveal);
    drawGrades();
  }

  function drawGrades() {
    const now = Date.now();
    const pv = preview(st || newCardState(now), now, params(), srsOpts);
    const names = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
    let busy = false;
    gradeBox.replaceChildren(
      h('div', { class: 'grades' }, [1, 2, 3, 4].map((g) => h('button', {
        class: `g${g}${suggest === g ? ' suggest' : ''}`,
        onclick: () => { if (!busy) { busy = true; onGrade(g); } },
      }, names[g], h('small', {}, formatInterval(pv[g].due - now))))),
      h('div', { class: 'hintline' }, 'Not sure? Use Good if you got it, Again if you didn\'t.'));
  }

  return {
    reveal: () => { if (!isRevealed && actions.querySelector('button')?.textContent === 'Show answer') reveal(); },
    revealed: () => isRevealed,
    grade: (g) => onGrade(g),
    cleanup: () => { cleanups.forEach((f) => { try { f(); } catch { /* ignore */ } }); audio.stop(); },
  };
}

// ---------- Decks ----------
function renderDecks() {
  const r = root();
  r.append(h('h1', {}, 'Decks'));
  const states = A.store.state.cards;
  const started = A.store.get('started', {});
  const introduced = A.store.get('introduced', {});

  // Words known: word notes with at least one card that has graduated to review.
  const known = { A1: 0, A2: 0 };
  for (const n of A.notes) {
    if (!['n', 'v', 'w', 'p'].includes(n.type)) continue;
    if (A.index.byNote.get(n.id).some((c) => states[c.id] && states[c.id].state === State.Review)) known[n.lvl === 'A2' ? 'A2' : 'A1']++;
  }
  r.append(h('div', { class: 'card' }, h('div', { class: 'small muted' }, 'Words known'),
    h('div', { style: 'font-size:20px;font-weight:700' }, `A1: ${known.A1} / 650 · A2: ${known.A2} / 650`),
    h('div', { class: 'meter' }, h('div', { style: `width:${Math.min(100, ((known.A1 + known.A2) / 1300) * 100)}%` }))));

  r.append(h('h2', {}, 'Lessons'));
  for (const d of A.decks) {
    const notes = A.notes.filter((n) => n.deckId === d.id);
    const cards = notes.flatMap((n) => A.index.byNote.get(n.id));
    const seen = notes.filter((n) => introduced[n.id] != null).length;
    const mature = cards.filter((c) => states[c.id] && states[c.id].stability >= MATURE_STABILITY && states[c.id].state === State.Review).length;
    const running = d.core ? started[d.id] !== false : !!started[d.id];
    const level = d.tags.find((t) => /^A[12]$/.test(t)) || '';
    const pctSeen = notes.length ? Math.round((seen / notes.length) * 100) : 0;
    r.append(h('div', { class: 'card' },
      h('div', { class: 'row spread' }, h('div', { class: 'grow' }, h('div', { style: 'font-weight:700' }, d.title),
        h('div', { class: 'row wrap', style: 'gap:4px;margin-top:4px' }, level ? h('span', { class: 'pill' }, level) : null, d.core ? h('span', { class: 'pill' }, 'Core') : null, h('span', { class: 'small muted' }, `${notes.length} notes`)))),
      h('div', { class: 'small muted', style: 'margin-top:6px' }, `${pctSeen}% seen · ${cards.length ? Math.round((mature / cards.length) * 100) : 0}% mature`),
      h('div', { class: 'meter' }, h('div', { style: `width:${pctSeen}%` })),
      h('button', { class: `btn small block ${running ? '' : 'primary'}`, style: 'margin-top:10px', onclick: async () => {
        await A.store.set('started', { ...A.store.get('started', {}), [d.id]: !running });
        toast(running ? 'Paused. Reviews of this deck still run.' : 'Started! New words from this deck appear in your sessions.');
        route();
      } }, running ? '⏸ Pause new words' : (d.core ? '▶ Resume' : '▶ Start this deck'))));
  }

  // Hard words
  const leeches = [...new Set(Object.entries(states).filter(([, st]) => isLeech(st)).map(([id]) => id.split(':')[0]))].map((id) => A.noteById.get(id)).filter(Boolean);
  r.append(h('h2', {}, 'Hard words 🧩'), h('div', { class: 'card' }, leeches.length
    ? h('ul', { class: 'list' }, leeches.map((n) => h('li', {}, h('span', {}, deWord(noteLabel(n), { plural: isPluralOnly(n) })), h('span', { class: 'muted small' }, n.english))))
    : h('p', { class: 'muted', style: 'margin:0' }, 'None yet. Words you forget 6 times show up here.')));

  // Drills
  r.append(h('h2', {}, 'Drills'), h('div', { class: 'grid2' },
    h('a', { class: 'btn', href: '#/drill/articles' }, 'der/die/das'),
    h('a', { class: 'btn', href: '#/drill/order' }, 'Word order'),
    h('a', { class: 'btn', href: '#/drill/leech' }, '🧩 Hard words'),
    h('a', { class: 'btn', href: '#/shadow' }, '🗣️ Shadowing')),
  h('button', { class: 'btn block', style: 'margin-top:8px', onclick: async () => {
    const { count, text } = weakWordsText(A);
    if (!count) { toast('No weak words yet. 🎉'); return; }
    const ok = await copyText(text);
    toast(ok ? `Copied ${count} words. Paste them into Claude.` : 'Could not copy. Try again.');
  } }, '💬 Copy weak words for Claude'));
}

// ---------- Settings ----------
function renderSettings() {
  const r = root();
  const s = S();
  r.append(h('h1', {}, 'Settings'));
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
      await A.store.reset(); A.session = null; A.undo = null; applyAudioPrefs(); toast('Everything was reset.'); A.go('today');
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
