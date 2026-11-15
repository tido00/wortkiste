import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDeckFile, mergeDecks, cardsForNote, checkOrder, checkTyped, noteId, parseCloze, parseKeys } from '../decks.js';

const index = JSON.parse(readFileSync(new URL('../decks/index.json', import.meta.url), 'utf8'));
const files = index.decks.map((d) => ({ file: d.file, text: readFileSync(new URL(`../decks/${d.file}`, import.meta.url), 'utf8') }));

test('every line of every deck parses with no problems', () => {
  for (const { file, text } of files) {
    const r = parseDeckFile(text, file);
    assert.deepEqual(r.problems, [], `${file} has problems`);
    const cardLines = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('#deck'));
    assert.equal(r.notes.length, cardLines.length, `${file}: every card line becomes a note`);
    assert.ok(r.decks.length > 0);
  }
});

test('index.json lists decks that exist', () => {
  assert.ok(index.decks.length >= 1);
  for (const d of index.decks) assert.ok(d.file.endsWith('.txt'));
});

test('malformed lines are reported, not thrown', () => {
  const text = [
    'n :: der Tisch :: table :: la table',                 // before header
    '#deck | X | Test | 1 | tags=A1,course',
    'q :: what :: ? :: ?',                                  // bad type
    'n :: der Tisch',                                       // too few fields
    'c :: Ich komme. :: I come. :: Je viens.',              // cloze without {{ }}
    'o :: Ich komme :: I come :: Je viens',                 // order without tiles
    '#deck | broken',                                       // bad header
    '#deck | Y | Good | 2 | tags=A2',
    'w :: gut :: good :: bien',
  ].join('\n');
  let r;
  assert.doesNotThrow(() => { r = parseDeckFile(text, 't.txt'); });
  assert.equal(r.problems.length, 6);
  assert.ok(r.problems.every((p) => p.line && p.error));
  assert.equal(r.notes.length, 1);
  assert.equal(r.notes[0].lvl, 'A2');
  assert.doesNotThrow(() => parseDeckFile(null));
});

test('keys are read correctly', () => {
  const r = parseDeckFile('#deck | T | T | 1 | tags=A1\n' +
    'n :: der Tisch :: table :: la table :: pl=die Tische ; img=🪑 ; ex=Der Tisch ist neu. ; exen=The table is new. ; set=furniture\n' +
    'v :: studieren :: to study :: étudier :: ex=Sie studiert. ; tip=lernen = learn; studieren = study at university\n' +
    'o :: Heute / kaufe / ich / ein / Fahrrad. :: x :: y :: alt=Ich / kaufe / heute / ein / Fahrrad. || Ein / Fahrrad / kaufe / ich / heute.', 't');
  const [n, v, o] = r.notes;
  assert.equal(n.keys.pl, 'die Tische');
  assert.equal(n.keys.img, '🪑');
  assert.equal(n.keys.ex, 'Der Tisch ist neu.');
  assert.equal(n.keys.exen, 'The table is new.');
  assert.equal(n.set, 'furniture');
  assert.equal(n.english, 'table');
  assert.equal(n.french, 'la table');
  assert.equal(v.keys.tip, 'lernen = learn; studieren = study at university');
  assert.equal(o.keys.alt.split('||').length, 2);
  assert.deepEqual(parseKeys(' pl = die Tische ;  img=🪑 ').keys, { pl: 'die Tische', img: '🪑' });
});

test('noun with pl=- makes no plural card; verb without du/er/perf makes no forms card', () => {
  const r = parseDeckFile('#deck | T | T | 1\n' +
    'n :: das Wasser :: water :: l\'eau :: pl=-\n' +
    'n :: die Eltern :: parents :: les parents :: pl=only\n' +
    'n :: der Tisch :: table :: la table :: pl=die Tische\n' +
    'v :: lernen :: to learn :: apprendre\n' +
    'v :: sprechen :: to speak :: parler :: du=sprichst ; er=spricht ; perf=hat gesprochen', 't');
  const tmpl = (n) => cardsForNote(n).map((c) => c.tmpl);
  assert.deepEqual(tmpl(r.notes[0]), ['produce', 'recognise']);
  assert.deepEqual(tmpl(r.notes[1]), ['produce', 'recognise']);
  assert.deepEqual(tmpl(r.notes[2]), ['produce', 'recognise', 'plural']);
  assert.deepEqual(tmpl(r.notes[3]), ['produce', 'recognise']);
  assert.deepEqual(tmpl(r.notes[4]), ['produce', 'recognise', 'forms', 'perf']);
});

test('other note types make the right cards', () => {
  const r = parseDeckFile('#deck | T | T | 1\np :: Hallo! :: Hi! :: Salut !\nc :: Ich {{bin}} Saad. :: I am Saad. :: Je suis Saad.\no :: Ich / bin / da. :: I am here. :: Je suis là.\nw :: auch :: too :: aussi', 't');
  assert.deepEqual(r.notes.map((n) => cardsForNote(n).map((c) => c.tmpl)), [['produce', 'listen'], ['cloze'], ['order'], ['produce', 'recognise']]);
  const cl = parseCloze(r.notes[1].german);
  assert.deepEqual(cl.answers, ['bin']);
  assert.equal(cl.full, 'Ich bin Saad.');
});

test('IDs stay the same after editing a meaning, example or keys', () => {
  const a = parseDeckFile('#deck | T | T | 1\nn :: der Tisch :: table :: la table :: pl=die Tische', 't').notes[0];
  const b = parseDeckFile('#deck | Z | Other | 5\nn ::  der   Tisch  :: desk :: le bureau :: pl=die Tische ; ex=Der Tisch ist neu. ; img=🪑', 'u').notes[0];
  assert.equal(a.id, b.id);
  assert.deepEqual(cardsForNote(a).map((c) => c.id), cardsForNote(b).map((c) => c.id));
  assert.notEqual(noteId('n', 'der Tisch'), noteId('w', 'der Tisch'));
  assert.notEqual(noteId('n', 'der Tisch'), noteId('n', 'die Tisch'));
});

test('a note in two decks is one note, listed under the first deck by order', () => {
  const core = parseDeckFile('#deck | CORE | Core | 100 | tags=A1,core\nn :: der Tisch :: table :: la table', 'core.txt');
  const course = parseDeckFile('#deck | L2 | Lesson | 4 | tags=A1,course\nn :: der Tisch :: table :: la table :: pl=die Tische', 'l.txt');
  const m = mergeDecks([core, course]);
  assert.equal(m.notes.length, 1);
  assert.equal(m.notes[0].deckId, 'L2');
  assert.deepEqual(m.decks.map((d) => d.id), ['L2', 'CORE']);
});

test('word order: main order and every alt accepted, others rejected', () => {
  const note = parseDeckFile('#deck | T | T | 1\no :: Ich / rufe / dich / morgen / an. :: I\'ll call you tomorrow. :: x :: alt=Morgen / rufe / ich / dich / an. || Dich / rufe / ich / morgen / an.', 't').notes[0];
  assert.ok(checkOrder(['Ich', 'rufe', 'dich', 'morgen', 'an.'], note));
  assert.ok(checkOrder(['Ich', 'rufe', 'dich', 'morgen', 'an'], note), 'punctuation does not matter');
  assert.ok(checkOrder(['morgen', 'rufe', 'Ich', 'dich', 'an.'], note), 'alt 1 (case does not matter)');
  assert.ok(checkOrder(['dich', 'rufe', 'Ich', 'morgen', 'an.'], note), 'alt 2');
  assert.ok(!checkOrder(['Ich', 'dich', 'rufe', 'morgen', 'an.'], note));
  assert.ok(!checkOrder(['rufe', 'Ich', 'dich', 'morgen', 'an.'], note));
  assert.ok(!checkOrder(['Ich', 'rufe', 'dich', 'morgen'], note));
});

test('every word-order card in the decks accepts its own main and alt orders', () => {
  for (const { file, text } of files) {
    for (const n of parseDeckFile(text, file).notes.filter((n) => n.type === 'o')) {
      const alts = [n.german, ...(n.keys.alt ? n.keys.alt.split('||') : [])];
      for (const a of alts) assert.ok(checkOrder(a.split('/').map((t) => t.trim()), n), `${n.german}: ${a}`);
    }
  }
});

test('typing check: Strasse = Straße, wrong article fails, typos are "almost"', () => {
  assert.equal(checkTyped('die Strasse', 'die Straße').result, 'correct');
  assert.equal(checkTyped('die straße', 'die Straße').result, 'correct');
  assert.ok(checkTyped('die straße', 'die Straße').warning, 'capitalisation is warned');
  assert.equal(checkTyped('der Straße', 'die Straße').result, 'wrong');
  assert.equal(checkTyped('Straße', 'die Straße').result, 'wrong');
  assert.equal(checkTyped('die Strase', 'die Straße').result, 'almost');
  assert.equal(checkTyped('die Muetter', 'die Mütter').result, 'correct');
  assert.equal(checkTyped('SPRECHEN', 'sprechen').result, 'correct');
  assert.equal(checkTyped('sprechn', 'sprechen').result, 'almost');
  assert.equal(checkTyped('lesen', 'sprechen').result, 'wrong');
  assert.equal(checkTyped('kommen', 'kommen (aus)').result, 'correct');
  assert.equal(checkTyped('kommen aus', 'kommen (aus)').result, 'correct');
  assert.equal(checkTyped('', 'auch').result, 'wrong');
});
