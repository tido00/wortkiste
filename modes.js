// modes.js: shared DOM helpers and the extra modes (daily quiz, car mode, shadowing,
// drills, copy weak words for Claude). None of these change scheduling.

import * as audio from './audio.js';
import { article, stripArticle, parseCloze, orderTiles, checkOrder, isPluralOnly } from './decks.js';
import { dayNumber, isLeech } from './queue.js';
import { retrievability, State } from './srs.js';

// ---------- Shared DOM helpers ----------
// append()/prepend()/replaceChildren() skip null and false children, like h() does.
if (typeof Element !== 'undefined') {
  for (const m of ['append', 'prepend', 'replaceChildren']) {
    const orig = Element.prototype[m];
    Element.prototype[m] = function (...kids) { return orig.apply(this, kids.flat(Infinity).filter((k) => k != null && k !== false)); };
  }
}
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function toast(msg, ms = 2200) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

// German text with its article colour (der/die/das), e.g. "der Tisch" in blue.
export function deWord(german, { plural = false } = {}) {
  const art = plural ? 'die' : article(german);
  return h('span', { class: art ? `art-${art}` : '' }, german);
}

const isLetter = (c) => !!c && /[A-Za-zÄÖÜäöüß]/.test(c);

// Example sentence with the card's own noun (and its article) in colour.
export function exampleWithNoun(sentence, note) {
  if (note.type !== 'n') return document.createTextNode(sentence);
  const noun = stripArticle(note.german);
  const art = isPluralOnly(note) ? 'die' : article(note.german);
  const lower = sentence.toLowerCase();
  let idx = -1, from = 0;
  while ((idx = lower.indexOf(noun.toLowerCase(), from)) !== -1) {
    if (!isLetter(sentence[idx - 1]) && !isLetter(sentence[idx + noun.length])) break;
    from = idx + 1;
  }
  if (idx === -1) return document.createTextNode(sentence);
  let start = idx;
  const before = sentence.slice(0, idx);
  const m = /(der|die|das|ein|eine|einen|mein|meine|dein|deine|kein|keine)\s+$/i.exec(before);
  if (m) start = idx - m[0].length;
  return h('span', {}, sentence.slice(0, start), h('span', { class: `art-${art}`, style: 'font-weight:700' }, sentence.slice(start, idx + noun.length)), sentence.slice(idx + noun.length));
}

export function audioBtn(ctx, text, { slow = false, label = '🔊' } = {}) {
  if (!ctx.hasVoice) return null;
  return h('button', { class: 'icon-btn', 'aria-label': slow ? 'Play slowly' : 'Play', onclick: (e) => { e.stopPropagation(); audio.stop(); audio.speak(text, { slow }); } }, label);
}

// 🎙 Record & compare: your recording, then the app's voice. Kept in memory only.
export function recordWidget(ctx, getText) {
  if (!audio.canRecord()) return null;
  let rec = null, blob = null;
  const btn = h('button', { class: 'btn small' }, '🎙 Record');
  const again = h('button', { class: 'btn small ghost', style: 'display:none' }, '▶ Compare');
  const compare = async () => {
    if (!blob) return;
    await audio.playBlob(blob);
    if (ctx.hasVoice) await audio.speak(getText());
  };
  btn.onclick = async (e) => {
    e.stopPropagation();
    if (!rec) {
      try {
        audio.stop();
        rec = await audio.startRecording();
        btn.textContent = '■ Stop';
      } catch {
        toast('Microphone not available. Allow it in Safari settings to record.');
      }
    } else {
      btn.textContent = '🎙 Record again';
      blob = await rec.stop();
      rec = null;
      again.style.display = '';
      compare();
    }
  };
  again.onclick = (e) => { e.stopPropagation(); compare(); };
  const wrap = h('div', { class: 'row', style: 'justify-content:center;margin-top:8px' }, btn, again);
  wrap.cleanup = () => { if (rec) rec.cancel(); blob = null; };
  return wrap;
}

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Word-order puzzle UI. onDone(correct, chosenTiles).
export function orderPuzzle(note, onDone) {
  const tiles = orderTiles(note.german);
  const display = tiles.map((t, i) => (i === tiles.length - 1 ? t.replace(/[.?!]+$/, '') : t));
  let order = shuffle(display.map((_, i) => i));
  for (let k = 0; k < 5 && order.every((v, i) => v === i) && tiles.length > 1; k++) order = shuffle(order);
  const chosen = [];
  const pool = h('div', { class: 'tiles' });
  const line = h('div', { class: 'answer-line', 'aria-label': 'Your sentence' });
  const check = h('button', { class: 'btn primary block', disabled: true }, 'Check');
  const poolBtns = order.map((i) => h('button', { class: 'tile', onclick: () => pick(i) }, display[i]));
  pool.append(...poolBtns);
  const redraw = () => {
    line.replaceChildren(...chosen.map((i, pos) => h('button', { class: 'tile', onclick: () => { chosen.splice(pos, 1); redraw(); } }, display[i])));
    poolBtns.forEach((b, k) => b.classList.toggle('used', chosen.includes(order[k])));
    check.disabled = chosen.length !== tiles.length;
  };
  function pick(i) { if (!chosen.includes(i)) { chosen.push(i); redraw(); } }
  check.onclick = () => {
    const words = chosen.map((i) => tiles[i]);
    const ok = checkOrder(words, note);
    pool.remove(); check.remove();
    line.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    onDone(ok, words);
  };
  redraw();
  return h('div', {}, line, pool, check);
}

// ---------- Helpers over app state ----------
const seenCards = (ctx) => Object.entries(ctx.store.state.cards).filter(([, st]) => st && st.state !== State.New && st.lastReview != null);
const leechNoteIds = (ctx) => new Set(seenCards(ctx).filter(([, st]) => isLeech(st)).map(([id]) => id.split(':')[0]));

export function weakWordsText(ctx, now = Date.now()) {
  const ids = leechNoteIds(ctx);
  const since = now - 7 * 86400000;
  for (const e of ctx.store.state.revlog) if (e.rating === 1 && e.t >= since) ids.add(e.noteId);
  const lines = [...ids].map((id) => ctx.noteById.get(id)).filter(Boolean)
    .map((n) => `${n.type === 'c' ? parseCloze(n.german).full : n.type === 'o' ? orderTiles(n.german).join(' ') : n.german} — ${n.english}`);
  return { count: lines.length, text: ['Please run a speaking session with these words:', ...lines].join('\n') };
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  const ta = h('textarea', { style: 'position:fixed;top:0;left:0;opacity:0' });
  ta.value = text; document.body.append(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

function header(ctx, title, onClose) {
  return h('div', { class: 'topbar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: onClose || (() => ctx.go('today')) }, '✕'),
    h('h2', { style: 'margin:0', class: 'grow' }, title));
}

// ---------- Daily quiz ----------
export function buildQuiz(ctx, now = Date.now(), rand = Math.random) {
  const since = now - 14 * 86400000;
  const recent = new Set();
  for (const [id, st] of seenCards(ctx)) if (st.lastReview >= since || isLeech(st)) recent.add(id.split(':')[0]);
  let pool = [...recent].map((id) => ctx.noteById.get(id)).filter(Boolean);
  if (pool.length < 6) pool = [...new Set(seenCards(ctx).map(([id]) => id.split(':')[0]))].map((id) => ctx.noteById.get(id)).filter(Boolean);
  const all = ctx.notes;
  const byType = (t) => shuffle(pool.filter((n) => t.includes(n.type)), rand);
  const pools = {
    article: byType(['n']).filter((n) => !isPluralOnly(n) && article(n.german)),
    cloze: byType(['c']),
    order: byType(['o']),
    listen: ctx.hasVoice ? byType(['p', 'n', 'w', 'v']) : [],
  };
  const items = [];
  const formats = shuffle(Object.keys(pools), rand);
  for (let guard = 0; items.length < 10 && guard < 60; guard++) {
    const f = formats[guard % formats.length];
    const note = pools[f].shift();
    if (!note) continue;
    if (f === 'cloze') {
      const ans = parseCloze(note.german).answers[0];
      const others = shuffle([...new Set(all.filter((n) => n.type === 'c').map((n) => parseCloze(n.german).answers[0]).filter((a) => a.toLowerCase() !== ans.toLowerCase()))], rand);
      const same = others.filter((a) => all.some((n) => n.type === 'c' && n.keys.hint === note.keys.hint && parseCloze(n.german).answers[0] === a));
      const distract = [...new Set([...same, ...others])].slice(0, 3);
      items.push({ format: f, note, answer: ans, choices: shuffle([ans, ...distract], rand) });
    } else if (f === 'listen') {
      const others = shuffle([...new Set(all.filter((n) => n.type === note.type && n.id !== note.id).map((n) => n.english).filter((e) => e !== note.english))], rand).slice(0, 3);
      if (others.length < 3) continue;
      items.push({ format: f, note, answer: note.english, choices: shuffle([note.english, ...others], rand) });
    } else {
      items.push({ format: f, note });
    }
  }
  return items;
}

function sparkline(scores) {
  if (!scores.length) return null;
  const w = 300, hgt = 60, n = scores.length;
  const pts = scores.map((s, i) => [n === 1 ? w / 2 : (i * (w - 12)) / (n - 1) + 6, hgt - 6 - (s.score / Math.max(1, s.total)) * (hgt - 12)]);
  const svg = `<svg viewBox="0 0 ${w} ${hgt}" class="spark" role="img" aria-label="Quiz scores, last 14 days"><polyline fill="none" stroke="currentColor" stroke-width="2.5" points="${pts.map((p) => p.join(',')).join(' ')}"/>${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="currentColor"/>`).join('')}</svg>`;
  return h('div', { style: 'color:var(--accent)', html: svg });
}

export function quizHistory(ctx, now = Date.now()) {
  const today = dayNumber(now);
  return (ctx.store.get('quiz', []) || []).filter((q) => q.day > today - 14).sort((a, b) => a.day - b.day);
}

export function renderQuiz(root, ctx) {
  const items = buildQuiz(ctx);
  let i = 0, score = 0;
  const body = h('div', { class: 'study' });
  root.append(header(ctx, 'Daily quiz'), body);
  if (items.length < 3) {
    body.append(h('div', { class: 'card center' }, h('p', {}, 'Learn a few words first, then the quiz has something to ask. 🙂'), h('button', { class: 'btn primary', onclick: () => ctx.go('today') }, 'Back')));
    return;
  }
  const progress = h('div', { class: 'progress' }, h('div'));
  root.querySelector('.topbar').append(progress);
  const next = () => {
    progress.firstChild.style.width = `${(i / items.length) * 100}%`;
    if (i >= items.length) return finish();
    showItem(items[i]);
  };
  const advance = (ok) => {
    if (ok) score++;
    i++;
    body.append(h('button', { class: 'btn primary block', style: 'margin-top:16px', onclick: next }, i >= items.length ? 'See score' : 'Next'));
  };
  function showItem(it) {
    audio.stop();
    body.replaceChildren();
    const n = it.note;
    const card = h('div', { class: 'card front' });
    body.append(card);
    if (it.format === 'article') {
      card.append(h('div', { class: 'prompt' }, 'Which article?'), n.keys.img ? h('div', { class: 'emoji' }, n.keys.img) : null,
        h('div', { class: 'de' }, '___ ', stripArticle(n.german)), h('div', { class: 'fr' }, n.english));
      const right = article(n.german);
      const btns = ['der', 'die', 'das'].map((a) => h('button', { class: `abtn ${a}`, onclick: () => {
        btns.forEach((b) => { b.disabled = true; });
        btns.find((b) => b.textContent === right).classList.add('right');
        const ok = a === right;
        card.append(h('p', { class: ok ? 'result-ok' : 'result-bad' }, ok ? 'Richtig!' : 'Not quite:'), h('div', { class: 'de md' }, deWord(n.german)));
        if (ctx.hasVoice) audio.speak(n.german);
        advance(ok);
      } }, a));
      card.append(h('div', { class: 'grid3', style: 'margin-top:12px' }, btns));
    } else if (it.format === 'cloze' || it.format === 'listen') {
      if (it.format === 'cloze') {
        const cl = parseCloze(n.german);
        card.append(h('div', { class: 'prompt' }, 'Fill the gap'), h('div', { class: 'de md' }, cl.parts.map((p) => (p.gap !== undefined ? h('span', { class: 'gap' }, ' ') : p.text))),
          n.keys.hint ? h('div', { class: 'fr' }, `Hint: ${n.keys.hint}`) : null, h('div', { class: 'fr' }, n.english));
      } else {
        card.append(h('div', { class: 'prompt' }, 'Listen. What does it mean?'), h('div', { class: 'row', style: 'justify-content:center' }, audioBtn(ctx, n.german), audioBtn(ctx, n.german, { slow: true, label: '🐢' })));
        setTimeout(() => audio.speak(n.german), 50);
      }
      const choiceBtns = it.choices.map((c) => h('button', { class: 'choice', onclick: () => {
        choiceBtns.forEach((b) => { b.disabled = true; if (b.textContent === it.answer) b.classList.add('right'); });
        const ok = c === it.answer;
        if (!ok) choiceBtns.find((b) => b.textContent === c).classList.add('wrong');
        if (it.format === 'listen') card.append(h('div', { class: 'de md', style: 'margin-top:10px' }, deWord(n.german)));
        else if (ctx.hasVoice) audio.speak(parseCloze(n.german).full);
        advance(ok);
      } }, c));
      card.append(h('div', { class: 'choices' }, choiceBtns));
    } else if (it.format === 'order') {
      card.append(h('div', { class: 'prompt' }, 'Put the words in order'), h('div', { class: 'en' }, n.english));
      card.append(orderPuzzle(n, (ok) => {
        card.append(h('p', { class: ok ? 'result-ok' : 'result-bad' }, ok ? 'Richtig!' : 'Correct order:'), h('div', { class: 'de md' }, orderTiles(n.german).join(' ')));
        if (ctx.hasVoice) audio.speak(n.german);
        advance(ok);
      }));
    }
  }
  async function finish() {
    const today = dayNumber(Date.now());
    const hist = (ctx.store.get('quiz', []) || []).filter((q) => q.day !== today && q.day > today - 60);
    hist.push({ day: today, score, total: items.length });
    await ctx.store.set('quiz', hist);
    body.replaceChildren(h('div', { class: 'card center' },
      h('div', { class: 'stat' }, `${score} / ${items.length}`), h('p', { class: 'muted' }, score >= items.length * 0.8 ? 'Sehr gut! 🎉' : 'Gut gemacht. Keep going! 💪'),
      h('h3', {}, 'Last 14 days'), sparkline(quizHistory(ctx)),
      h('button', { class: 'btn primary block', style: 'margin-top:12px', onclick: () => ctx.go('today') }, 'Done')));
  }
  next();
}

// ---------- Car mode ----------
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}

export function carList(ctx, now = Date.now()) {
  const byNote = new Map();
  for (const [id, st] of seenCards(ctx)) {
    const noteId = id.split(':')[0];
    const n = ctx.noteById.get(noteId);
    if (!n || !['p', 'n', 'w', 'v'].includes(n.type)) continue;
    const r = retrievability(st, now, undefined, { dayDiff: ctx.dayDiff }) - st.lapses * 0.05;
    byNote.set(noteId, Math.min(byNote.get(noteId) ?? 1, r));
  }
  return [...byNote.entries()].sort((a, b) => a[1] - b[1]).slice(0, 30).map(([id]) => ctx.noteById.get(id));
}

export function renderCar(root, ctx) {
  const list = carList(ctx);
  root.append(header(ctx, 'Car mode 🚗'));
  if (!ctx.hasVoice) { root.append(h('div', { class: 'card' }, 'Car mode needs a German voice on this device. See Settings → Audio.')); return; }
  if (!list.length) { root.append(h('div', { class: 'card' }, 'Learn some words first; car mode practises words you have already seen.')); return; }
  let i = 0, paused = true, token = 0;
  const text = h('div', { class: 'car-text' });
  const sub = h('p', { class: 'center muted' });
  const count = h('p', { class: 'center small muted' });
  const pauseBtn = h('button', { class: 'btn primary big-ctrl' }, '▶ Start');
  const nextBtn = h('button', { class: 'btn big-ctrl' }, '⏭ Next');
  const wait = (ms, t) => new Promise((res) => setTimeout(() => res(t === token), ms));
  async function play() {
    const t = ++token;
    while (!paused && t === token && i < list.length) {
      const n = list[i];
      count.textContent = `${i + 1} / ${list.length}`;
      text.replaceChildren(h('div', {}, n.english)); sub.textContent = 'Say it in German…';
      await audio.speak(n.english, { lang: 'en' }); if (t !== token) return;
      if (!(await wait(4000, t))) return;
      text.replaceChildren(h('div', {}, n.english), h('div', { class: 'de md', style: 'margin-top:8px' }, deWord(n.german, { plural: isPluralOnly(n) }))); sub.textContent = '';
      await audio.speak(n.german); if (t !== token) return;
      if (!(await wait(2000, t))) return;
      await audio.speak(n.german); if (t !== token) return;
      if (!(await wait(1200, t))) return;
      i++;
    }
    if (i >= list.length) { text.textContent = 'Fertig! 🎉'; sub.textContent = ''; paused = true; pauseBtn.textContent = '↺ Again'; i = 0; keepAwake(false); }
  }
  pauseBtn.onclick = () => {
    paused = !paused;
    pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause';
    if (paused) { token++; audio.stop(); keepAwake(false); } else { keepAwake(true); play(); }
  };
  nextBtn.onclick = () => { token++; audio.stop(); i = Math.min(i + 1, list.length - 1); if (!paused) play(); else { text.textContent = list[i].english; count.textContent = `${i + 1} / ${list.length}`; } };
  const seenNote = ctx.store.get('carNoteSeen', false);
  const note = seenNote ? null : h('div', { class: 'notice' }, 'Keep the screen on and the phone in its mount. iPhone stops speech when the screen locks.',
    h('div', {}, h('button', { class: 'btn small', style: 'margin-top:8px', onclick: (e) => { ctx.store.set('carNoteSeen', true); e.target.closest('.notice').remove(); } }, 'OK')));
  text.textContent = `${list.length} words, weakest first`;
  root.append(note, h('div', { class: 'card' }, count, text, sub), h('div', { class: 'grid2', style: 'margin-top:12px' }, pauseBtn, nextBtn));
  return () => { token++; paused = true; audio.stop(); keepAwake(false); };
}

// ---------- Shadowing ----------
export function renderShadow(root, ctx) {
  root.append(header(ctx, 'Shadowing 🗣️'));
  if (!ctx.hasVoice) { root.append(h('div', { class: 'card' }, 'Shadowing needs a German voice on this device. See Settings → Audio.')); return; }
  const seen = new Set(seenCards(ctx).map(([id]) => id.split(':')[0]));
  const started = ctx.store.get('started', {});
  let list = ctx.notes.filter((n) => ['p', 'c'].includes(n.type) && seen.has(n.id));
  if (list.length < 5) list = list.concat(ctx.notes.filter((n) => ['p', 'c'].includes(n.type) && !seen.has(n.id) && started[n.deckId]).slice(0, 20));
  list = shuffle(list);
  if (!list.length) { root.append(h('div', { class: 'card' }, 'Start a deck first, then come back for shadowing.')); return; }
  let i = 0, token = 0, rw = null;
  const box = h('div', { class: 'card front' });
  const status = h('p', { class: 'center muted' });
  root.append(h('p', { class: 'muted small' }, 'Listen slowly, repeat in the gap, then hear it at normal speed.'), box, status);
  const sentence = (n) => (n.type === 'c' ? parseCloze(n.german).full : n.german);
  async function run() {
    const t = ++token;
    const s = sentence(list[i]);
    status.textContent = '🐢 Listen…';
    const start = Date.now();
    await audio.speak(s, { rate: 0.85 }); if (t !== token) return;
    const dur = Math.max(1500, Date.now() - start);
    status.textContent = '🗣️ Your turn — repeat!';
    await new Promise((r) => setTimeout(r, dur)); if (t !== token) return;
    status.textContent = '🔊 Normal speed';
    await audio.speak(s); if (t !== token) return;
    status.textContent = '';
  }
  function show() {
    token++; audio.stop(); if (rw && rw.cleanup) rw.cleanup();
    const n = list[i];
    rw = recordWidget(ctx, () => sentence(n));
    box.replaceChildren(h('div', { class: 'small muted' }, `${i + 1} / ${list.length}`), h('div', { class: 'de md', style: 'margin:10px 0' }, sentence(n)), h('div', { class: 'fr' }, n.english),
      h('div', { class: 'grid2', style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: run }, '↺ Play again'), h('button', { class: 'btn primary', onclick: () => { i = (i + 1) % list.length; show(); run(); } }, 'Next ⏭')), rw);
  }
  show();
  box.append(h('button', { class: 'btn primary block', style: 'margin-top:10px', onclick: (e) => { e.target.remove(); run(); } }, '▶ Start'));
  return () => { token++; audio.stop(); if (rw && rw.cleanup) rw.cleanup(); };
}

// ---------- Drills ----------
export function renderDrill(root, ctx, kind) {
  const titles = { articles: 'Articles drill', order: 'Word-order drill', leech: 'Hard words drill 🧩' };
  root.append(header(ctx, titles[kind] || 'Drill', () => ctx.go('decks')));
  const seen = new Set(seenCards(ctx).map(([id]) => id.split(':')[0]));
  const started = ctx.store.get('started', {});
  let list = [];
  if (kind === 'articles') list = shuffle(ctx.notes.filter((n) => n.type === 'n' && seen.has(n.id) && !isPluralOnly(n) && article(n.german))).slice(0, 20);
  if (kind === 'order') {
    list = shuffle(ctx.notes.filter((n) => n.type === 'o' && seen.has(n.id)));
    if (list.length < 10) list = list.concat(shuffle(ctx.notes.filter((n) => n.type === 'o' && !seen.has(n.id) && started[n.deckId])));
    list = list.slice(0, 10);
  }
  if (kind === 'leech') list = [...leechNoteIds(ctx)].map((id) => ctx.noteById.get(id)).filter(Boolean);
  if (!list.length) {
    root.append(h('div', { class: 'card' }, kind === 'leech' ? 'No hard words right now. 🎉' : 'Learn a few more cards first, then this drill has material.'));
    return;
  }
  let i = 0, score = 0;
  const body = h('div');
  root.append(body);
  const nextBtn = (ok) => { if (ok) score++; return h('button', { class: 'btn primary block', style: 'margin-top:14px', onclick: () => { i++; show(); } }, 'Next'); };
  function show() {
    audio.stop();
    if (i >= list.length) {
      body.replaceChildren(h('div', { class: 'card center' }, kind === 'leech' ? h('p', {}, 'Done. These words will keep coming back in your reviews.') : h('div', { class: 'stat' }, `${score} / ${list.length}`),
        h('div', { class: 'grid2', style: 'margin-top:12px' }, h('button', { class: 'btn', onclick: () => { i = 0; score = 0; list = shuffle(list); show(); } }, 'Again'), h('button', { class: 'btn primary', onclick: () => ctx.go('decks') }, 'Done'))));
      return;
    }
    const n = list[i];
    const card = h('div', { class: 'card front' }, h('div', { class: 'small muted' }, `${i + 1} / ${list.length}`));
    body.replaceChildren(card);
    if (kind === 'articles') {
      const right = article(n.german);
      card.append(n.keys.img ? h('div', { class: 'emoji' }, n.keys.img) : null, h('div', { class: 'de' }, stripArticle(n.german)), h('div', { class: 'fr' }, n.english));
      const btns = ['der', 'die', 'das'].map((a) => h('button', { class: `abtn ${a}`, onclick: () => {
        btns.forEach((b) => { b.disabled = true; });
        btns.find((b) => b.textContent === right).classList.add('right');
        const ok = a === right;
        card.append(h('div', { class: 'de md', style: 'margin-top:10px' }, deWord(n.german)), n.keys.tip ? h('div', { class: 'tip' }, '💡 ', n.keys.tip) : null);
        if (ctx.hasVoice) audio.speak(n.german);
        card.append(nextBtn(ok));
      } }, a));
      card.append(h('div', { class: 'grid3', style: 'margin-top:12px' }, btns));
    } else if (kind === 'order') {
      card.append(h('div', { class: 'en', style: 'margin:8px 0' }, n.english));
      card.append(orderPuzzle(n, (ok) => {
        card.append(h('p', { class: ok ? 'result-ok' : 'result-bad' }, ok ? 'Richtig!' : 'Correct order:'), h('div', { class: 'de md' }, orderTiles(n.german).join(' ')));
        if (ctx.hasVoice) audio.speak(n.german);
        card.append(nextBtn(ok));
      }));
    } else {
      const front = n.type === 'c' ? parseCloze(n.german).full : n.type === 'o' ? orderTiles(n.german).join(' ') : n.german;
      card.append(h('div', { class: 'en', style: 'margin:8px 0' }, n.english), h('div', { class: 'fr' }, n.french));
      card.append(h('button', { class: 'btn primary block', style: 'margin-top:12px', onclick: (e) => {
        e.target.replaceWith(h('div', { class: 'back' }, h('div', { class: 'de md' }, deWord(front, { plural: isPluralOnly(n) })), audioBtn(ctx, front), n.keys.tip ? h('div', { class: 'tip' }, '💡 ', n.keys.tip) : null), nextBtn(false));
        if (ctx.hasVoice) audio.speak(front);
      } }, 'Show German'));
    }
  }
  show();
  return () => audio.stop();
}
