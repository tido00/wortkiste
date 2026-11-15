// Prints every text the app can speak, as JSON [{ key, text }]. Used by tools/make_audio.py.
import { readFileSync } from 'node:fs';
import { parseDeckFile, mergeDecks, audioTexts, audioKey, speakable, UI_PHRASES } from '../decks.js';

const dir = new URL('../decks/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
const { notes } = mergeDecks(index.decks.map((d) => parseDeckFile(readFileSync(new URL(d.file, dir), 'utf8'), d.file)));
const seen = new Map();
for (const t of [...UI_PHRASES.map(speakable), ...notes.flatMap(audioTexts)]) if (!seen.has(audioKey(t))) seen.set(audioKey(t), t);
console.log(JSON.stringify([...seen].map(([key, text]) => ({ key, text })), null, 0));
