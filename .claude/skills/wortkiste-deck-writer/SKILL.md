---
name: wortkiste-deck-writer
description: Turn one of Saad's German lessons (class PDF, photo of a textbook page, worksheet, or pasted word list) into a finished Wortkiste deck file, add it to decks/index.json, test it and publish it. Also makes the next Core batch from the Goethe A1/A2 word list. Use whenever Saad sends lesson material or asks for a new deck, lesson, Lektion or Core words.
---

# Wortkiste deck writer

Saad sends lesson material; you return a deck that is live in the app. He is not a developer:
never ask him to run commands or edit files. SPEC.md sections 3 and 14 are the rules; this skill
is the checklist for applying them.

## 1. Read the material
- Accept a PDF, photos, a worksheet or a pasted list. Read every page.
- Work out the lesson id and title from the material (e.g. `L4A | 4A Wohnen & Möbel`).
- List what the lesson teaches: vocabulary, chunks (dialogue phrases), grammar points.
- If a page is unreadable, say which one and carry on with the rest.

## 2. Check what already exists
- Read `decks/index.json` and every deck file it lists.
- A note's ID is `type + german` (trimmed, single spaces). A note that already exists in an earlier deck is
  skipped automatically (it stays in the first deck), so don't repeat it. Re-use a word only inside a
  *different* sentence (cloze, word order, example).
- Next deck order number: course decks continue after the highest course order (1, 2, 3 …);
  Core decks use 100, 101, 102 ….

## 3. Write the deck (SPEC §3 format, §14 rules)
```
#deck | <id> | <title> | <order> | tags=A1,course
<type> :: <german> :: <english> :: <french> [:: key=value ; key=value]
```
Checklist for every line:
- One fact per card. Lists become separate notes with a shared `set=` (weekdays, months, numbers…).
- Nouns: article + `pl=` (or `pl=-` / `pl=only`), `img=` emoji only when one clearly fits.
- Verbs: irregular `du=` / `er=`, `sep=` when separable, `perf=` from A2 decks on.
- Examples: `ex=` ≤ 8 words with `exen=`, using known words, about Saad's real life
  (Marrakech, Morocco, his sales job, learning German, Ausbildung plans). No textbook names.
- Meanings: natural English first, then French. Flag false friends with `ff=`.
- Gender tips with `tip=` when an ending rule applies (-ung/-heit/-keit/-ion/-tät → die, -chen/-lein → das,
  days/months/seasons → der).
- Social language as chunks (`p`): "Ich hätte gern …", "Können Sie das wiederholen?".
- Grammar as `c` cloze sentences (5–10 per grammar point) and `o` word-order puzzles (3–5 per point),
  with `hint=` and, for `o`, every other correct order in `alt=` separated by `||`.
- Confusable notes share a `set=` so they are never introduced on the same day.
- Size: 40–80 notes per lesson deck, about 25% `c`/`o`.
- Never use `;` inside a value unless what follows is not `key=` (the parser treats `; key=` as a new key).
- Double-check German spelling, articles, plurals and umlauts. When unsure of a plural or gender, look it up
  rather than guess.

Core batches: 50 words from the Goethe-Zertifikat A1 (then A2) Wortliste that are in no deck yet,
most useful in daily life first, `tags=A1,core` (or A2), file `decks/core-A1-<n>.txt`.

## 4. Add and test
1. Save as `decks/<id>.txt` (e.g. `decks/L4A-L4C.txt`) with the two header comment lines used in existing decks.
2. Add one line to `decks/index.json`: `{ "file": "...", "title": "..." }`.
3. Record the audio for the new texts (SPEC Part D). Voice models (CC0) go in a scratch folder:
   `https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/<name>/<quality>/de_DE-<name>-<quality>.onnx`
   (+ `.onnx.json`) for `kerstin/medium`, `thorsten/high`, `thorsten_emotional/medium`. Needs `pip install piper-tts`
   and ffmpeg (the "wortkiste" cloud environment allows these hosts and installs piper). Then run
   `python3 tools/make_audio.py --models <folder>`; it only makes the missing clips.
4. Run `node --test tests/`. The deck tests parse every deck listed in index.json and fail on any problem
   line or any word-order card whose own `alt` orders are rejected. Fix and re-run until green.
5. Report notes that were skipped as duplicates (count notes per type; compare with what you wrote).

## 5. Publish and tell Saad
- Commit the deck, `decks/index.json` and the new `audio/` files (`Add Lektion 4 deck (N notes)`), push to `main`; the GitHub Action tests and publishes.
- Check the Actions run succeeded.
- Message to Saad, short and plain:
  "Lektion 4 is in the app: N new words and phrases, M grammar cards. Open Wortkiste → Journey →
  tap **Start this lesson** on 4A when you're ready." Mention any page you could not read.
