// audio.js: German audio, record & compare, feedback sounds.
// German: recorded natural voices (audio/<voice>/<key>.mp3, made with free CC0 Piper voices,
// SPEC Part D) first, the device's own voices (Web Speech API) as backup.
// Your recordings live in memory for the current card only; they are never saved or sent.

import { speakable, audioKey } from './decks.js';

export { speakable };
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
let voices = [];
let prefs = { voice: '', rate: 0.9, speaker: 'mix' };

// Speakers the learner can pick. "voices" are recorded voice ids; device = iPhone voice only.
export const SPEAKERS = Object.freeze([
  { id: 'mix', label: 'Kerstin & Thorsten', text: 'Two natural voices, mixed. Hearing different voices trains your ear.', voices: ['kerstin', 'thorsten'] },
  { id: 'kerstin', label: 'Kerstin', text: 'Natural female voice', voices: ['kerstin'] },
  { id: 'thorsten', label: 'Thorsten', text: 'Natural male voice', voices: ['thorsten'] },
  { id: 'fun', label: "Thorsten's moods", text: 'Amused, surprised, whispering or sleepy: a different mood each time', voices: ['amused', 'surprised', 'whisper', 'sleepy'] },
  { id: 'device', label: 'iPhone voice', text: 'The German voice installed on this device' },
]);
const recorded = new Map(); // voice id -> Set of keys

export async function loadRecorded() {
  try {
    const res = await fetch('audio/index.json', { cache: 'no-cache' });
    const j = await res.json();
    for (const [id, v] of Object.entries(j.voices || {})) recorded.set(id, new Set(v.keys));
  } catch { /* no recorded audio: device voices only */ }
}
export const hasRecorded = () => [...recorded.values()].some((s) => s.size > 0);

// Recorded clip for this text and speaker, or null. "mix" always gives the same text the same voice.
export function recordedUrl(text, speaker = prefs.speaker) {
  const sp = SPEAKERS.find((s) => s.id === speaker);
  if (!sp || !sp.voices) return null;
  const key = audioKey(text);
  const avail = sp.voices.filter((v) => recorded.get(v)?.has(key));
  if (!avail.length) return null;
  const i = speaker === 'fun' ? Math.floor(Math.random() * avail.length) : parseInt(key.slice(-3), 36) % avail.length;
  return `audio/${avail[i]}/${key}.mp3`;
}
// Every clip URL a speaker could use for these texts (for saving offline).
export function recordedUrls(texts, speaker = prefs.speaker) {
  const sp = SPEAKERS.find((s) => s.id === speaker);
  if (!sp || !sp.voices) return [];
  const out = [];
  for (const t of texts) {
    const key = audioKey(t);
    for (const v of sp.voices) if (recorded.get(v)?.has(key)) out.push(`audio/${v}/${key}.mp3`);
  }
  return out;
}

// One shared <audio> element: iPhone lets it play later once a tap has started it.
const SILENT = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjE2LjEwMAAAAAAAAAAAAAAA//NwwAAAAAAAAAAAAEluZm8AAAAPAAAABgAAAVIAnZ2dnZ2dnZ2dnZ2dnZ2dnbGxsbGxsbGxsbGxsbGxsbGxxMTExMTExMTExMTExMTExNjY2NjY2NjY2NjY2NjY2NjY7Ozs7Ozs7Ozs7Ozs7Ozs7Oz/////////////////////AAAAAExhdmM2MC4zMQAAAAAAAAAAAAAAACQCowAAAAAAAAFSti/NJwAAAAAAAAAAAAAAAAD/8xDEAAAAA0gAAAAATEFNRTMuMTAwVVVVVf/zEMQNAAADSAAAAABVVVVVVVVVVVVVVVVV//MQxBoAAANIAAAAAFVVVVVVVVVVVVVVVVX/8xDEJwAAA0gAAAAAVVVVVVVVVVVVVVVVVf/zEMQ0AAADSAAAAABVVVVVVVVVVVVVVVVV//MQxEEAAANIAAAAAFVVVVVVVVVVVVVVVVU=';
let player = null;
let pending = null;
function getPlayer() {
  if (!player && typeof Audio !== 'undefined') { player = new Audio(); player.preload = 'auto'; }
  return player;
}
export function unlockAudio() {
  const p = getPlayer();
  if (!p || p.dataset?.unlocked) return;
  if (p.dataset) p.dataset.unlocked = '1';
  p.src = SILENT;
  p.play().catch(() => {});
}
function playUrl(url, rate) {
  const p = getPlayer();
  if (!p) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); p.onended = p.onerror = null; if (pending === finish) pending = null; resolve(); } };
    const timer = setTimeout(finish, 15000);
    pending = finish;
    p.onended = finish;
    p.onerror = finish;
    p.src = url;
    p.preservesPitch = true;
    p.webkitPreservesPitch = true;
    p.defaultPlaybackRate = rate;
    p.playbackRate = rate;
    p.play().catch(finish);
  });
}

export function setPrefs(p) { prefs = { ...prefs, ...p }; }

export function loadVoices(timeout = 1500) {
  if (!synth) return Promise.resolve([]);
  return new Promise((resolve) => {
    const done = () => { voices = synth.getVoices() || []; resolve(voices); };
    const now = synth.getVoices();
    if (now && now.length) { voices = now; resolve(voices); return; }
    let finished = false;
    const finish = () => { if (!finished) { finished = true; done(); } };
    synth.addEventListener?.('voiceschanged', finish, { once: true });
    setTimeout(finish, timeout);
  });
}

export const germanVoices = () => voices.filter((v) => /^de([-_]|$)/i.test(v.lang));
export const englishVoices = () => voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
export const hasDeviceGerman = () => !!synth && germanVoices().length > 0;
export const hasGerman = () => hasRecorded() || hasDeviceGerman();

const quality = (v) => (/(enhanced|premium|neural|natural)/i.test(v.name) ? 2 : 0) + (/^de[-_]DE$/i.test(v.lang) ? 1 : 0);

export function bestGermanVoice() {
  const list = germanVoices();
  if (!list.length) return null;
  if (prefs.voice) {
    const chosen = list.find((v) => v.voiceURI === prefs.voice || v.name === prefs.voice);
    if (chosen) return chosen;
  }
  return list.slice().sort((a, b) => quality(b) - quality(a))[0];
}

function bestEnglishVoice() {
  const list = englishVoices();
  return list.find((v) => /^en[-_](US|GB)$/i.test(v.lang) && /(enhanced|premium)/i.test(v.name))
    || list.find((v) => /^en[-_](US|GB)$/i.test(v.lang)) || list[0] || null;
}

export function stop() {
  if (synth) synth.cancel();
  if (player && !player.paused) player.pause();
  if (pending) pending();
}

// Speak and resolve when finished (or after a safety timeout).
export function speak(text, { lang = 'de', rate, slow = false } = {}) {
  const t = speakable(text);
  if (!t) return Promise.resolve();
  if (lang === 'de') {
    const url = recordedUrl(t);
    if (url) return playUrl(url, rate ?? (slow ? 0.7 : prefs.rate));
    if (!hasDeviceGerman()) return Promise.resolve();
  }
  if (!synth) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(t);
    if (lang === 'de') {
      const v = bestGermanVoice();
      if (v) u.voice = v;
      u.lang = v ? v.lang : 'de-DE';
      u.rate = rate ?? (slow ? 0.7 : prefs.rate);
    } else {
      const v = bestEnglishVoice();
      if (v) u.voice = v;
      u.lang = v ? v.lang : 'en-US';
      u.rate = rate ?? 1;
    }
    let settled = false;
    const end = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } };
    const timer = setTimeout(end, 2500 + t.length * 160 / (u.rate || 1));
    u.onend = end;
    u.onerror = end;
    synth.speak(u);
  });
}

// ---- Record & compare ----
export const canRecord = () => typeof window !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start();
  return {
    stop: () => new Promise((resolve) => {
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        resolve(new Blob(chunks, { type: rec.mimeType || 'audio/mp4' }));
      };
      rec.stop();
    }),
    cancel: () => { try { rec.stop(); } catch { /* already stopped */ } stream.getTracks().forEach((tr) => tr.stop()); },
  };
}

export function playBlob(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    const done = () => { URL.revokeObjectURL(url); resolve(); };
    a.onended = done;
    a.onerror = done;
    a.play().catch(done);
  });
}

// ---- Feedback sounds (generated with Web Audio: no files, no network) ----
let ctxAudio = null;
let soundsOn = true;
export function setSounds(on) { soundsOn = !!on; }
export function chime(kind = 'right') {
  if (!soundsOn || typeof window === 'undefined') return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctxAudio = ctxAudio || new AC();
    if (ctxAudio.state === 'suspended') ctxAudio.resume();
    const notes = { right: [660, 880], combo: [660, 880, 1175], wrong: [330, 247], done: [523, 659, 784, 1047] }[kind] || [660];
    const t0 = ctxAudio.currentTime;
    notes.forEach((f, i) => {
      const o = ctxAudio.createOscillator(), g = ctxAudio.createGain();
      o.type = kind === 'wrong' ? 'triangle' : 'sine';
      o.frequency.value = f;
      const t = t0 + i * 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(ctxAudio.destination);
      o.start(t); o.stop(t + 0.25);
    });
  } catch { /* sound is optional */ }
}
