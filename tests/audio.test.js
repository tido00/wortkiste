import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseDeckFile, mergeDecks, audioTexts, audioKey, speakable, UI_PHRASES } from '../decks.js';

const root = new URL('../', import.meta.url);
const index = JSON.parse(readFileSync(new URL('decks/index.json', root), 'utf8'));
const { notes } = mergeDecks(index.decks.map((d) => parseDeckFile(readFileSync(new URL(`decks/${d.file}`, root), 'utf8'), d.file)));

test('audio texts cover what each card speaks', () => {
  const r = parseDeckFile('#deck | T | T | 1\n' +
    'n :: der Tisch :: table :: la table :: pl=die Tische ; ex=Der Tisch ist neu.\n' +
    'v :: sprechen :: to speak :: parler :: du=sprichst ; er=spricht ; perf=hat gesprochen\n' +
    'v :: kommen (aus) :: to come :: venir\n' +
    'c :: Ich {{bin}} da. :: I am here. :: Je suis là.\n' +
    'o :: Ich / wohne / in / Marrakesch. :: I live in Marrakech. :: J\'habite à Marrakech.', 't');
  const [n, v, v2, c, o] = r.notes;
  assert.deepEqual(audioTexts(n), ['der Tisch', 'Der Tisch ist neu.', 'die Tische']);
  assert.deepEqual(audioTexts(v), ['sprechen', 'du sprichst', 'er spricht', 'hat gesprochen']);
  assert.deepEqual(audioTexts(v2), ['kommen aus']);
  assert.deepEqual(audioTexts(c), ['Ich bin da.']);
  assert.deepEqual(audioTexts(o), ['Ich wohne in Marrakesch.']);
  // The app speaks these strings in slightly different spellings; the key must be the same.
  assert.equal(audioKey('Ich {{bin}} da.'), audioKey('Ich bin da.'));
  assert.equal(audioKey('Ich / wohne / in / Marrakesch.'), audioKey('Ich wohne in Marrakesch.'));
  assert.equal(audioKey('kommen (aus)'), audioKey('kommen aus'));
  assert.equal(speakable('  a   b '), 'a b');
});

test('every text of every deck has a recorded clip in every voice', () => {
  const idxPath = new URL('audio/index.json', root);
  assert.ok(existsSync(idxPath), 'audio/index.json is missing: run tools/make_audio.py');
  const audio = JSON.parse(readFileSync(idxPath, 'utf8'));
  const voices = Object.entries(audio.voices);
  assert.ok(voices.length >= 2, 'at least two recorded voices');
  const texts = [...UI_PHRASES, ...notes.flatMap(audioTexts)];
  for (const [id, v] of voices) {
    const keys = new Set(v.keys);
    const missing = texts.filter((t) => !keys.has(audioKey(t)));
    assert.deepEqual(missing.slice(0, 5), [], `${id}: ${missing.length} texts have no clip. Run: python3 tools/make_audio.py --models <folder>`);
    for (const k of v.keys) assert.ok(existsSync(new URL(`audio/${id}/${k}.mp3`, root)), `${id}/${k}.mp3 listed but missing`);
  }
});
