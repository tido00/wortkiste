# Wortkiste

Saad's German flashcard app, from A1 to the Goethe A2 exam. Free, private, works offline,
opened from the iPhone home screen.

**App:** https://tido00.github.io/wortkiste/

## Put it on your iPhone
1. Open the link above in **Safari**.
2. Tap the **Share** button (square with an arrow).
3. Tap **Add to Home Screen**, then **Add**.

Voices: Me → Settings → Voice. Natural recorded voices are built in; the iPhone voice is a backup.

Your progress lives only on your phone. Save a backup now and then: Settings → Save backup.

## How it works
See [SPEC.md](SPEC.md). Part A explains the learning design in plain words.

| File | What it does |
|---|---|
| `index.html` | Page and styles |
| `app.js` | Screens: Today (guided lesson), Journey, Me, More practice, Settings |
| `lesson.js` | The daily lesson steps: warm-up, reviews, new words, challenge, finish |
| `srs.js` | FSRS-6 scheduler (port of ts-fsrs, tested against its outputs) |
| `decks.js` | Reads deck files, makes cards, checks typed answers and word order |
| `queue.js` | Daily queue: new-word limits, siblings, look-alike sets, backlog guard |
| `store.js` | Storage on the device (IndexedDB) and backup files |
| `audio.js` | Recorded voices (iPhone voice as backup), record & compare, sounds |
| `audio/` | Recorded clips (free CC0 Piper voices: Kerstin, Thorsten, Thorsten's moods), made by `tools/make_audio.py` |
| `modes.js` | Daily quiz, car mode, shadowing, drills, copy for Claude |
| `sw.js` | Offline support |

## Adding a lesson
1. Write `decks/<name>.txt` in the format of SPEC.md section 3 (rules in section 14).
2. Add one line to `decks/index.json`.
3. Record its audio: `python3 tools/make_audio.py --models <folder with the voice files>` (see SPEC Part D).
4. Push to `main`. Tests run, then the site updates. Saad taps **Start this lesson** on the Journey tab.

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

## Approved plan for version 2 (Saad, 2026-11-15)
Build in this order; each phase updates SPEC.md before it is built.
1. **Guided daily lesson (done, version 2.0):** one Start button; a full path (warm-up → reviews → new words taught before tested → 5-question challenge → finish) with a "Skip to…" option; 3 tabs (Today, Journey, Me); extra modes under "More practice"; sounds, animations, combo counter.
2. **Voices (done, version 2.1):** pre-recorded open-source German voices (Thorsten, Kerstin; CC0) stored in the app; voice picker and dialogue characters; iPhone voices as backup.
3. **Habit:** weekly rest day for the streak, badges, weekly summary, calendar reminder file.
4. **Goethe A2 practice:** reading, writing and speaking tasks; exam-skill progress.

The visual design (colours, type, look) gets its own pass with Saad's design skills.
Lesson decks are made with the project skill `.claude/skills/wortkiste-deck-writer`.

## Ideas for v2
- Dialogues with characters (a deck format for two-person dialogues, each line in its own voice).
- FSRS parameter optimisation from Saad's own review history (after a few months of data).
- More Core batches (A1 batch 2+, then A2) and lesson decks as the course goes on.
- Optional Perfekt cards once A2 decks start, plus a Perfekt drill.
- Reminder notification at a chosen time (iOS supports web push for home-screen apps).
