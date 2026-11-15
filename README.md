# Wortkiste

Saad's German flashcard app, from A1 to the Goethe A2 exam. Free, private, works offline,
opened from the iPhone home screen.

**App:** https://tido00.github.io/wortkiste/

## Put it on your iPhone
1. Open the link above in **Safari**.
2. Tap the **Share** button (square with an arrow).
3. Tap **Add to Home Screen**, then **Add**.

Better German voice (free): iPhone Settings → Accessibility → Spoken Content → Voices → German → download *Anna (Enhanced)*.

Your progress lives only on your phone. Save a backup now and then: Settings → Save backup.

## How it works
See [SPEC.md](SPEC.md). Part A explains the learning design in plain words.

| File | What it does |
|---|---|
| `index.html` | Page and styles |
| `app.js` | Screens: Today, Session, Decks, Settings |
| `srs.js` | FSRS-6 scheduler (port of ts-fsrs, tested against its outputs) |
| `decks.js` | Reads deck files, makes cards, checks typed answers and word order |
| `queue.js` | Daily queue: new-word limits, siblings, look-alike sets, backlog guard |
| `store.js` | Storage on the device (IndexedDB) and backup files |
| `audio.js` | German voice and record & compare |
| `modes.js` | Daily quiz, car mode, shadowing, drills, copy for Claude |
| `sw.js` | Offline support |

## Adding a lesson
1. Write `decks/<name>.txt` in the format of SPEC.md section 3 (rules in section 14).
2. Add one line to `decks/index.json`.
3. Push to `main`. Tests run, then the site updates. Saad taps **Start this deck** on the Decks screen.

Problems in a deck file never crash the app; they show under Settings → Deck problems.

## Tests
```bash
node --test tests/
```
No dependencies. `tests/fsrs-reference.json` holds outputs generated once from ts-fsrs 5.4.2
(4 review sequences, fuzz on and off). The only intended difference: Wortkiste caps intervals
at 365 days, where ts-fsrs can go a day over its cap.

## Choices made while building (within SPEC)
- The first lesson is started with one tap on first launch; Core decks run by default (3 of the 8 daily new words) and can be paused on the Decks screen.
- Verbs with `perf` get a separate Perfekt card next to the present-forms card (one fact per card); both unlock like plurals.
- First card of a new note: *recognise* for nouns, verbs and words, *produce* for phrases; the other cards follow on later days.
- "Words known" counts word and phrase notes with at least one card that has graduated to review.
- Core deck batch 1 (`decks/core-A1-1.txt`): 50 Goethe A1 words not in Lektion 1–3.

## Ideas for v2
- FSRS parameter optimisation from Saad's own review history (after a few months of data).
- More Core batches (A1 batch 2+, then A2) and lesson decks as the course goes on.
- Optional Perfekt cards once A2 decks start, plus a Perfekt drill.
- Reminder notification at a chosen time (iOS supports web push for home-screen apps).
