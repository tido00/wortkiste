// decks.js: deck parser, stable IDs, card generation and answer checks. Pure, no DOM.

export const NOTE_TYPES = ['n', 'v', 'w', 'p', 'c', 'o'];
export const KNOWN_KEYS = ['pl', 'img', 'ex', 'exen', 'du', 'er', 'perf', 'sep', 'hint', 'tip', 'ff', 'alt', 'set', 'lvl', 'tags'];

export const normalise = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

// cyrb53: small, fast, stable string hash -> base36 id.
export function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const noteId = (type, german) => hash(`${normalise(type)}|${normalise(german)}`);

// "key=value ; key=value". A ";" only starts a new key when a known key follows,
// so values like "tip=lernen = learn; studieren = study" stay whole.
export function parseKeys(text) {
  const keys = {};
  const unknown = [];
  let last = null;
  for (const seg of String(text).split(';')) {
    const m = seg.match(/^\s*([a-zA-Z]+)\s*=(.*)$/);
    if (m && KNOWN_KEYS.includes(m[1].toLowerCase())) {
      last = m[1].toLowerCase();
      keys[last] = normalise(m[2]);
    } else if (last) {
      keys[last] = normalise(`${keys[last]}; ${seg}`);
    } else if (normalise(seg)) {
      if (m) { last = m[1]; keys[last] = normalise(m[2]); unknown.push(m[1]); }
      else unknown.push(normalise(seg));
    }
  }
  return { keys, unknown };
}

// Parse one deck file. Never throws: problems are collected.
export function parseDeckFile(text, file = 'deck.txt') {
  const decks = [], notes = [], problems = [];
  let deck = null;
  const lines = String(text ?? '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const ln = i + 1;
    if (!line || line.startsWith('//')) return;
    try {
      if (line.startsWith('#deck')) {
        const parts = line.split('|').map(normalise);
        if (parts.length < 4 || !parts[1] || !parts[2]) {
          problems.push({ file, line: ln, text: line, error: 'Deck header needs: #deck | id | title | order | tags=…' });
          deck = null; return;
        }
        const order = Number(parts[3]);
        const tagPart = parts.slice(4).find((p) => /^tags\s*=/.test(p));
        const tags = tagPart ? tagPart.replace(/^tags\s*=/, '').split(',').map(normalise).filter(Boolean) : [];
        deck = { id: parts[1], title: parts[2], order: Number.isFinite(order) ? order : 999, tags, file, core: tags.includes('core') };
        if (!Number.isFinite(order)) problems.push({ file, line: ln, text: line, error: 'Deck order is not a number (using 999)' });
        decks.push(deck);
        return;
      }
      if (!deck) { problems.push({ file, line: ln, text: line, error: 'Card line before any #deck header' }); return; }
      const f = line.split('::').map(normalise);
      const type = (f[0] || '').toLowerCase();
      if (!NOTE_TYPES.includes(type)) { problems.push({ file, line: ln, text: line, error: `Unknown type "${f[0]}" (use n, v, w, p, c or o)` }); return; }
      if (f.length < 3 || !f[1] || !f[2]) { problems.push({ file, line: ln, text: line, error: 'Needs at least: type :: german :: english :: french' }); return; }
      const german = f[1], english = f[2], french = f[3] || '';
      const { keys, unknown } = parseKeys(f.slice(4).join(' :: '));
      if (unknown.length) problems.push({ file, line: ln, text: line, error: `Unknown key(s): ${unknown.join(', ')} (line still used)` });
      if (type === 'c' && !/\{\{.+?\}\}/.test(german)) { problems.push({ file, line: ln, text: line, error: 'Cloze needs {{answer}} in the German' }); return; }
      if (type === 'o' && german.split('/').filter((t) => t.trim()).length < 2) { problems.push({ file, line: ln, text: line, error: 'Word order needs tiles separated by /' }); return; }
      if (type === 'n' && !/^(der|die|das)\s+\S/i.test(german)) problems.push({ file, line: ln, text: line, error: 'Noun without der/die/das (line still used)' });
      const lvl = (keys.lvl || deck.tags.find((t) => /^A[12]$/.test(t)) || 'A1').toUpperCase();
      notes.push({
        id: noteId(type, german), type, german, english, french, keys,
        deckId: deck.id, file, line: ln, lvl, set: keys.set || null,
      });
    } catch (e) {
      problems.push({ file, line: ln, text: line, error: `Could not read this line (${e.message})` });
    }
  });
  return { decks, notes, problems };
}

// Merge several parsed files: decks sorted by order, a note seen twice is kept in the first deck.
export function mergeDecks(parsedList) {
  const decks = parsedList.flatMap((p) => p.decks).sort((a, b) => a.order - b.order);
  const problems = parsedList.flatMap((p) => p.problems);
  const rank = new Map(decks.map((d, i) => [d.file + '|' + d.id, i]));
  const all = parsedList.flatMap((p) => p.notes)
    .map((n, i) => ({ n, i, r: rank.get(n.file + '|' + n.deckId) ?? 9999 }))
    .sort((a, b) => a.r - b.r || a.i - b.i);
  const seen = new Set();
  const notes = [];
  for (const { n } of all) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    notes.push(n);
  }
  return { decks, notes, problems };
}

// ---- Card generation ----
export const article = (german) => {
  const m = /^(der|die|das)\s/i.exec(normalise(german));
  return m ? m[1].toLowerCase() : null;
};
export const stripArticle = (german) => normalise(german).replace(/^(der|die|das)\s+/i, '');
export const isPluralOnly = (note) => note.type === 'n' && (note.keys.pl || '').toLowerCase() === 'only';
export const hasPluralCard = (note) => note.type === 'n' && !!note.keys.pl && !['-', 'only'].includes(note.keys.pl.toLowerCase());

// Each card: { id, noteId, tmpl, unlock? }. Order = order of introduction
// (SPEC Part C: a new word is taught, then checked with its produce card).
export function cardsForNote(note) {
  const c = (tmpl, extra = {}) => ({ id: `${note.id}:${tmpl}`, noteId: note.id, tmpl, ...extra });
  switch (note.type) {
    case 'n': return [c('produce'), c('recognise'), ...(hasPluralCard(note) ? [c('plural', { unlock: 'produce' })] : [])];
    case 'v': return [c('produce'), c('recognise'),
      ...(note.keys.du || note.keys.er ? [c('forms', { unlock: 'produce' })] : []),
      ...(note.keys.perf ? [c('perf', { unlock: 'produce' })] : [])];
    case 'w': return [c('produce'), c('recognise')];
    case 'p': return [c('produce'), c('listen', { needsVoice: true })];
    case 'c': return [c('cloze')];
    case 'o': return [c('order')];
    default: return [];
  }
}

// ---- Cloze ----
export function parseCloze(german) {
  const answers = [];
  const parts = [];
  let last = 0;
  const re = /\{\{(.+?)\}\}/g;
  let m;
  while ((m = re.exec(german))) {
    parts.push({ text: german.slice(last, m.index) });
    parts.push({ gap: m[1] });
    answers.push(m[1]);
    last = re.lastIndex;
  }
  parts.push({ text: german.slice(last) });
  return { parts: parts.filter((p) => p.gap !== undefined || p.text), answers, full: german.replace(/\{\{(.+?)\}\}/g, '$1') };
}

// ---- Word order ----
const tileKey = (t) => normalise(t).toLowerCase().replace(/[.,!?;:]/g, '');
export const orderTiles = (german) => german.split('/').map(normalise).filter(Boolean);
export const orderSentence = (german) => orderTiles(german).join(' ');
export const orderAlternatives = (note) => [note.german, ...(note.keys.alt ? note.keys.alt.split('||') : [])].map(normalise).filter(Boolean);

export function checkOrder(chosenTiles, note) {
  const got = chosenTiles.map(tileKey).join(' ');
  return orderAlternatives(note).some((alt) => orderTiles(alt).map(tileKey).join(' ') === got);
}

// ---- Typing check (lenient) ----
const UMLAUT = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' };
const fold = (s) => normalise(s).toLowerCase().replace(/[äöüß]/g, (c) => UMLAUT[c]).replace(/[.!?¿¡,;:"„“()]/g, '').replace(/\s+/g, ' ').trim();
const dropParens = (s) => normalise(s.replace(/\([^)]*\)/g, ' '));

export function levenshtein(a, b) {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

// Returns { result: 'correct' | 'almost' | 'wrong', warning? }
export function checkTyped(input, expected) {
  const exp = dropParens(expected);
  const inp = normalise(input);
  if (!inp) return { result: 'wrong' };
  const expArt = article(exp);
  if (expArt) {
    const inArt = article(inp);
    if (inArt !== expArt) return { result: 'wrong', warning: inArt ? `Article: ${expArt}, not ${inArt}` : `Don't forget the article: ${expArt}` };
    const e = stripArticle(exp), g = stripArticle(inp);
    const dist = levenshtein(fold(g), fold(e));
    if (dist === 0) {
      const capOk = g.charAt(0) === g.charAt(0).toUpperCase() || !/[a-zäöü]/i.test(g.charAt(0));
      return capOk ? { result: 'correct' } : { result: 'correct', warning: 'Nouns start with a capital letter' };
    }
    return dist === 1 ? { result: 'almost' } : { result: 'wrong' };
  }
  const options = [exp, normalise(expected)];
  let best = Infinity;
  for (const o of options) best = Math.min(best, levenshtein(fold(inp), fold(o)));
  if (best === 0) return { result: 'correct' };
  return best === 1 ? { result: 'almost' } : { result: 'wrong' };
}
