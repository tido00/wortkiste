// audio.js: text-to-speech (Web Speech API, on-device voices) and record & compare.
// Recordings live in memory for the current card only; they are never saved or sent.

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
let voices = [];
let prefs = { voice: '', rate: 0.9 };

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
export const hasGerman = () => !!synth && germanVoices().length > 0;

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

// Text cleanup for speech: drop {{ }}, slashes between tiles, and brackets.
export const speakable = (t) => String(t || '').replace(/\{\{(.+?)\}\}/g, '$1').replace(/\s*\/\s*/g, ' ').replace(/[()]/g, '').replace(/\s+/g, ' ').trim();

export function stop() { if (synth) synth.cancel(); }

// Speak and resolve when finished (or after a safety timeout).
export function speak(text, { lang = 'de', rate, slow = false } = {}) {
  if (!synth) return Promise.resolve();
  const t = speakable(text);
  if (!t) return Promise.resolve();
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
