# Wortkiste v2: build spec for Claude Code

A free, private flashcard web app for Saad's German (A1 → A2 → Goethe A2 exam), opened from an iPhone home-screen icon.

**Status: APPROVED by Saad on 2026-11-15. A Claude Code session builds it end to end (see CLAUDE.md for permissions).**
Replaces `wortkiste-app-spec.md` (v1, kept for comparison). Same hosting and stack; the learning design is new.

---

## Part A. Why it's built this way (plain words, for Saad)

Each feature below comes from research on how adults learn vocabulary and grammar, not only from the textbook.

| # | Idea | What it means for you | Research behind it |
|---|---|---|---|
| 1 | **Smarter timing (FSRS)** | The app learns how well *you* remember each card and shows it right before you'd forget. About 20–30% fewer reviews than the old Anki method for the same memory. | FSRS (Ye et al., 2022–2024), now Anki's default scheduler; spacing effect (Cepeda et al., 2006) |
| 2 | **Say it in German, not just understand it** | Most cards ask "how do you say *table*?" and you answer out loud. Understanding a word is easy; producing it is what you need for speaking and the exam. | Retrieval practice / testing effect (Roediger & Karpicke, 2006); productive vs receptive knowledge (Nation) |
| 3 | **The article is part of the word** | You never learn "Tisch", you learn "**der** Tisch". Colours: **der = blue, die = red, das = green**, everywhere. You tap der/die/das before seeing the answer, so you commit to a guess. | Gender is the #1 A1 error; colour + forced choice gives a second memory cue (dual coding) |
| 4 | **Words live in sentences** | Each word has a short example sentence about *your* life (sales, Marrakech, Ausbildung). Grammar is practised by filling gaps in real sentences. | Context and personal relevance improve recall (self-reference effect) |
| 5 | **Word-order puzzles** | Tap word tiles into the right order: *Ich / rufe / dich / morgen / an*. German puts the verb in position 2 and splits verbs like *anrufen*; this trains it with no typing. | Structured output practice (Swain's output hypothesis) |
| 6 | **Ears first** | Some cards play only audio: you have to understand it before you see the text. Shadowing mode: listen, repeat aloud, record yourself and compare. | Listening is half the Goethe exam; shadowing improves pronunciation and listening |
| 7 | **Mixed, not blocked** | A session mixes words, phrases, grammar and old lessons together. Harder in the moment, better memory later. | Interleaving (Rohrer & Taylor, 2007) |
| 8 | **Don't learn look-alikes on the same day** | *links/rechts* or *Montag/Dienstag* are introduced on different days, so they don't blur together. | Semantic-set interference (Tinkham 1993, Waring 1997) |
| 9 | **The most useful words first** | After the textbook words, a "Core" deck adds the official Goethe A1/A2 word list words the book skips, most useful first. | Frequency-based learning (Nation; Goethe-Zertifikat A1/A2 Wortliste) |
| 10 | **Built for missed days** | If you skip days and reviews pile up, new cards pause automatically until you catch up, so you never face a wall of 400 cards. | Practical: avoids the #1 reason people quit flashcards |
| 11 | **Hands-free car mode** | During night drives the phone says the English, waits, you say the German, then it says the German. No looking needed. | Production practice in dead time |
| 12 | **Daily quiz** | A 3-minute mixed quiz each day (articles, gaps, word order, listening), with your score history. | You said daily quizzes work for you; low-stakes testing |
| 13 | **Talk with Claude** | One button copies your weakest words, so you can paste them into a speaking session with Claude. | Spoken use of hard words moves them into active vocabulary |

How much a day: at **8 new words a day** (default), you'd cover the full A2 word list (~1,300 words) in about 5–6 months, at roughly 15–20 minutes a day. More new words per day means more reviews later, and the app shows that forecast.

---

## Part B. Build spec (for the Claude Code session)

### 0. Instructions for the building session (read first)

- **Who plans and who builds:** this spec was planned by Claude (Opus 5.5). **Build with Opus 5.5.** Switch to Fable only if the build gets stuck (e.g. the FSRS port fails its reference tests twice). Saad's choice.
- **Permissions:** Saad has given the build session full access to commit, push to `main` and publish on GitHub Pages without asking each time. The exceptions are listed in CLAUDE.md.
- **Scope:** build exactly what this spec lists. Put any other idea under "Ideas for v2" in the README.
- **Inputs:** `decks/L1-L3.txt` (316 notes from Lektion 1–3, already in the v2 format of section 3) and `decks/index.json`.
- **Saad's answers (2026-11-15):** 8 new notes/day, typing optional and off by default, Core deck yes (3 of the 8 daily), self-recording yes, emoji pictures yes.

### 1. User and job

- One adult beginner, native Arabic/Darija, fluent French and English. **iPhone Safari** daily, laptop sometimes.
- Job: short daily sessions (5–20 min, at different times of day, sometimes in the car) that build *active* A1/A2 vocabulary and grammar.
- Meanings: **English first, French underneath** (smaller, muted). No Arabic.

### 2. Hard constraints (unchanged from v1)

| Constraint | Detail |
|---|---|
| Cost | €0. Static files on GitHub Pages, in a repo Saad owns. |
| Stack | Plain HTML, CSS, JavaScript (ES modules). No framework, no build step, no runtime dependencies. FSRS is ported in-house (~200 lines), not imported. |
| Network | Loads only its own files. No analytics, CDNs, external fonts or APIs. No cloud speech recognition. |
| Offline | Works fully offline after first visit (service worker). |
| iPhone | Add to Home Screen: manifest, apple-touch-icon 180×180, safe-area insets, tap targets ≥ 44 px, no hover-only UI. |
| Storage | IndexedDB on the device. Backup/restore to a JSON file. |
| Privacy | No accounts. Voice recordings stay in memory for the current card only and are never saved or sent. |
| Size | App shell < 300 KB excluding decks. |

### 3. Deck file format (v2)

Plain text in `decks/`, listed in `decks/index.json`. Adding a lesson = one `.txt` file + one line in `index.json`, no code changes.

```
#deck | <deckId> | <title> | <order> | tags=<comma list>
<type> :: <german> :: <english> :: <french> [:: key=value ; key=value ...]
```

- Field order is now **German, English, French** (v1 was German, French, English).
- Spaces around `::`, `|`, `;` and `=` are trimmed. Blank lines and lines starting with `//` are ignored.
- Parse problems go to a "Deck problems" list in Settings and never crash the app.

**Note types**

| Type | Use | `german` field | Example |
|---|---|---|---|
| `n` | noun | with article | `n :: der Tisch :: table :: la table :: pl=die Tische ; img=🪑 ; ex=Der Tisch ist neu. ; exen=The table is new.` |
| `v` | verb | infinitive | `v :: sprechen :: to speak :: parler :: du=sprichst ; er=spricht ; perf=hat gesprochen ; ex=Ich spreche Arabisch.` |
| `w` | other word (adjective, adverb, question word, number…) | word | `w :: auch :: also, too :: aussi :: ex=Ich lerne auch Deutsch.` |
| `p` | phrase / chunk | full phrase | `p :: Wie heißen Sie? :: What's your name? (formal) :: Comment vous appelez-vous ?` |
| `c` | cloze (grammar or vocab in a sentence) | sentence with `{{answer}}` | `c :: Ich {{komme}} aus Marokko. :: I come from Morocco. :: Je viens du Maroc. :: hint=kommen` |
| `o` | word order puzzle | tiles separated by `/` | `o :: Ich / rufe / dich / morgen / an. :: I'll call you tomorrow. :: Je t'appelle demain. :: alt=Morgen / rufe / ich / dich / an.` |

**Optional keys**

| Key | Applies to | Meaning |
|---|---|---|
| `pl` | n | plural with article, or `-` for no plural, or `only` for plural-only nouns |
| `img` | n, w, v | one emoji shown with the English (picture cue for concrete words) |
| `ex`, `exen` | n, v, w | example sentence (≤ 8 words, simple, about Saad's life) and its English |
| `du`, `er` | v | present forms, only when the stem changes or is irregular |
| `perf` | v | Perfekt with hat/ist (from A2 decks onward) |
| `sep` | v | separable prefix, e.g. `sep=an` for anrufen |
| `hint` | c, any | shown under the prompt |
| `tip` | any | shown on the back: gender rule (`-ung → die`), pronunciation, memory trick |
| `ff` | any | false-friend warning shown in orange, e.g. `ff=Gift = poison, not a gift` |
| `alt` | o | other accepted orders, separated by `||` |
| `set` | any | confusable group, e.g. `set=weekdays`. Notes in the same set are never introduced on the same day |
| `lvl` | any | `A1` or `A2` (defaults to deck tag) |
| `tags` | any | extra tags, e.g. `topic=work` |

**IDs:** note ID = stable hash of `type + german` (normalised: trimmed, single spaces). Card ID = note ID + template name. Editing meanings, examples or keys never resets progress. If the same note appears in two decks (e.g. course deck and Core deck), it is one note, listed under the first deck by order.

### 4. Card templates (what each note produces)

Each note produces one or more cards. Siblings (cards from the same note) are never shown on the same day: when one is reviewed or introduced, the others wait until the next day.

| Note | Card | Front | Interaction | Back |
|---|---|---|---|---|
| `n` | **recognise** | `der Tisch` in its article colour + 🔊 | tap to reveal | English, French, emoji, plural, example + audio |
| `n` | **produce** | emoji + English (French under) | tap **der / die / das** first, then say the noun aloud, then reveal | `der Tisch` in colour + audio. Wrong article pre-selects Again |
| `n` | **plural** (unlocks when *produce* reaches 7-day stability; skipped for `pl=-`) | `der Tisch → die ___` | say it, reveal | `die Tische` + audio + `tip` |
| `v` | recognise / produce | as for nouns, without article buttons | | |
| `v` | **forms** (only if `du`/`er`/`perf` present; unlocks like plural) | `sprechen → er ___` (or `Perfekt?`) | say it, reveal | `er spricht` / `hat gesprochen` |
| `w` | recognise / produce | as for verbs | | |
| `p` | **produce** | English (French under) | say it aloud (optional record & compare), reveal | German + audio |
| `p` | **listen** | 🔊 only, auto-plays; replay button; "slow" button (0.7×) | try to understand, reveal | German text + English + French |
| `c` | **cloze** | sentence with gap + `hint` + English | say/think the answer, reveal | full sentence with answer highlighted + audio |
| `o` | **order** | English + shuffled tiles | tap tiles in order; Check | correct sentence + audio; any `alt` order counts as right. Wrong order pre-selects Again |

Rules:
- Article colours: der `#2563eb`-ish blue, die red, das green (tune for contrast in dark mode). Used on every German noun anywhere in the app, including example sentences when the noun is the card's own noun.
- After reveal: **Again / Hard / Good / Easy**, each showing its next interval. A line under the buttons: "Not sure? Use Good if you got it, Again if you didn't."
- **Typing (setting, default off):** for produce cards of `n`, `w`, `v`, a text box replaces "say it aloud". Lenient check: case-insensitive except noun capitalisation (warned, not failed), `ae/oe/ue/ss` accepted for `ä/ö/ü/ß`, one-letter typo = "almost" (suggest Hard). A wrong article = wrong.
- **Record & compare** (on produce and listen cards for `p`, `c`): 🎙 button records with `MediaRecorder` (in memory only), then plays your recording followed by the TTS version. Hidden if the browser lacks support.

### 5. Scheduling: FSRS

- Port **FSRS-6** (open-spaced-repetition; reference implementation `ts-fsrs`) as pure functions in `srs.js`, with the published **default parameters**. No parameter optimisation in v1 (needs months of data; README "Ideas for v2").
- Per-card state: `stability`, `difficulty`, `due`, `state` (new / learning / review / relearning), `step`, `reps`, `lapses`, `lastReview`.
- **Desired retention:** default **0.90**, setting with choices 0.85 / 0.90 / 0.95 and a one-line explanation ("higher = remember more, more reviews").
- **Learning steps:** new 1 min → 10 min → graduate; relearning 10 min. Same-day steps use FSRS short-term stability rules as in `ts-fsrs`.
- **Maximum interval:** 365 days. **Fuzz** on intervals ≥ 3 days as in `ts-fsrs`.
- **Day boundary 04:00 local.**
- **Leeches:** a card with 6 lapses is tagged "leech", shown with a 🧩 badge, and listed on the Decks screen ("Hard words"). It keeps being scheduled.

### 6. Daily limits and the backlog guard

- **New notes per day** (counted per note, not per card): default **8**, setting 3–20. Beside the setting: "Expected daily reviews in 30 days: ~N" (simple forecast from current cards + new rate).
- **Backlog guard:** if due reviews > 120 at session start, new cards pause and the home screen says "Catching up: new words paused until reviews are under 60." Setting to turn the guard off.
- Reviews per day: no hard cap by default (setting available).
- **Introducing new notes:** deck order, then file order, skipping notes whose `set` already had a note introduced today. Course decks first; Core deck notes fill in only when there are no unseen course notes in decks already unlocked, or by a "Core words per day" setting (default 3 of the 8).
- **Deck unlocking:** a deck's new cards only start when Saad taps "Start this deck" (so the app follows his lesson pace). Reviews of started decks always run.

### 7. Session

- **Order:** due learning/relearning cards first, then reviews and new cards **interleaved** (one new card after every 4 reviews), mixing all decks and card types. Never the same note type 4 times in a row if another type is available.
- **Time box:** the Start button offers **5 min / 15 min / Until done**. A timed session stops at the next card after the time runs out; leftovers stay due.
- Progress bar, **Undo** for the last grade, end screen with counts, accuracy and "Hard words today".

### 8. Extra modes (none of these change scheduling)

1. **Daily quiz** (~3 min, 10 items): from cards seen in the last 14 days plus leeches; formats mixed: article tap, cloze, word order, listening with 4 answer choices (the choices are meanings of other cards of the same type). Stores date + score; shows a 14-day score line.
2. **Car mode** (hands-free, eyes-free): picks up to 30 seen `p`, `n`, `w`, `v` cards (weak ones first). For each: speak English (en-US/en-GB voice) → 4 s pause → speak German → 2 s → speak German again. Big Pause/Next buttons, screen kept awake with the Wake Lock API where supported. A note on first use: "Keep the screen on and the phone in its mount. iPhone stops speech when the screen locks."
3. **Shadowing**: plays a `p`/`c` sentence at 0.85×, gap of the sentence's length for repeating, then normal speed. Optional record & compare.
4. **Drills**: Articles drill (20 seen nouns, der/die/das only), Word-order drill (10 `o` cards), Leech drill (all leeches).
5. **Copy weak words for Claude**: copies leeches + cards graded Again in the last 7 days as plain text (German — English), with a first line "Please run a speaking session with these words:".

### 9. Audio

- Web Speech API, `lang="de-DE"`. Pick the best installed German voice (prefer names containing "Enhanced"/"Premium", then any de-DE). Voice picker and speed (0.7–1.0, default 0.9) in Settings.
- Settings shows a tip: "Better voice for free: iPhone Settings → Accessibility → Spoken Content → Voices → German → download *Anna (Enhanced)*."
- Autoplay after reveal (toggle). If no German voice exists, hide 🔊 and listen cards, and show a note in Settings.

### 10. Screens

1. **Today**: due / new counts, Start (5 / 15 / until done), Daily quiz, Car mode, streak, 14-day review bar, "about N min", backlog-guard message when active.
2. **Session** (section 7).
3. **Decks**: per deck: title, level tag, % seen, % mature (stability ≥ 21 days), Start/Pause deck; "Hard words" list; drills; words-known counter ("A1: 412 / 650 · A2: 120 / 650").
4. **Settings**: new notes/day + forecast, Core words/day, desired retention, backlog guard, typing mode, audio (autoplay, voice, speed), backup/restore JSON (in-page confirmation, no `confirm()`), Deck problems, Reset (typed "RESET").

Design: calm, large German type, light/dark following system, article colours readable in both.

### 11. Repo layout

```
/index.html  /app.js (UI + router)  /srs.js (FSRS, pure)  /decks.js (parser + card generation, pure)
/queue.js (daily queue, limits, siblings, sets, backlog guard; pure)  /store.js (IndexedDB + backup)
/audio.js (TTS, recording)  /modes.js (quiz, car, shadowing, drills)  /sw.js  /manifest.webmanifest
/icons/  /decks/index.json  /decks/*.txt  /tests/ (node --test, no dependencies)  /README.md
```

### 12. Acceptance checks (run before telling Saad it's live)

- `node --test tests/` passes, covering:
  - Parser: every line of every deck parses; malformed lines are reported, not thrown; keys are read correctly.
  - Card generation: a noun with `pl=-` makes no plural card; a verb with no `du/er/perf` makes no forms card.
  - FSRS: matches `ts-fsrs` reference outputs for at least 3 published review sequences (within 0.01 days).
  - Siblings: two cards of one note are never both due on the same day.
  - Sets: two notes with the same `set` are never introduced on the same day.
  - Backlog guard: with 121 due reviews, zero new cards are queued.
  - Word order: the main order and every `alt` order are accepted; others rejected.
  - Typing check: `Strasse` = `Straße`; wrong article fails.
  - IDs stay the same after editing a meaning.
  - Backup → reset → restore gives identical state.
- Manual checks at 390×844 with screenshots: Today, noun produce card before/after article tap, word-order card, listen card, car mode, Settings. No horizontal scroll. Works offline after first load.
- `grep` for `http` in code: only relative URLs (and none in decks except plain text).

### 13. Deployment (done by the build session)

1. The repo `wortkiste` is public (free Pages needs public; decks hold no personal data beyond example sentences).
2. Push to `main` and publish with GitHub Pages (a GitHub Actions deploy workflow, or Pages from `main` / root). If a setting can only be changed by Saad in the GitHub website, give him the exact taps.
3. Send Saad the URL. He opens it in Safari → Share → Add to Home Screen.

### 14. Content rules for decks (for the Claude that writes decks)

Every new deck (from a class PDF or the Core list) follows these rules:

1. **One fact per card.** No lists ("Montag–Sonntag" is 7 notes with `set=weekdays`).
2. **Every noun** has article + plural (`pl`), and an emoji when one clearly fits.
3. **Every verb** lists irregular `du`/`er` forms, `sep` if separable, and `perf` from A2 onward.
4. **Example sentences** are ≤ 8 words, use known words, and are about Saad's real life where possible (Marrakech, Morocco, sales job, learning German, Ausbildung plans). Not textbook names.
5. **Meanings:** natural English, then French. Flag false friends with `ff` (German–English or German–French, e.g. *Chef* = boss, *bekommen* ≠ become, *Rat* = advice).
6. **Gender tips:** add `tip` when an ending rule applies (`-ung/-heit/-keit/-ion/-tät → die`, `-chen/-lein → das`, days/months/seasons → `der`).
7. **Chunks over single words** for social language: "Wie geht's?", "Ich hätte gern…", "Können Sie das wiederholen?".
8. **Grammar as cloze in sentences**, not abstract rules: "Ich {{habe}} einen Bruder." beats "haben, ich-form?". Each grammar point gets 5–10 cloze cards and 3–5 word-order cards.
9. **Confusables** get the same `set` (weekdays, months, numbers 13/30, links/rechts, kennen/wissen, fragen/antworten…).
10. **Core deck:** words from the Goethe-Zertifikat A1 and A2 Wortliste that are not already in course decks, ordered by everyday usefulness, in batches of 50, tagged `lvl=A1|A2`. Meanings and examples are written fresh by Claude.
11. Size: a lesson deck is ~40–80 notes; ~25% `c`/`o` cards.

### Out of scope for v1

Accounts, cloud sync, speech recognition, photos/images beyond emoji, Arabic meanings, gamification beyond streak and quiz scores, FSRS parameter optimisation.

---

## Part C. Version 2, Phase 1: the guided daily lesson (APPROVED by Saad, 2026-11-15)

Where Part C differs from Parts A/B, Part C wins. Plan page: see README "Approved plan for version 2".

### C1. One button, a full path, "Skip to…"
- **Today** shows one lesson card ("Today's lesson · about N min · R reviews · N new") with one **Start** (or **Continue**) button.
- The lesson runs these steps in order, with step dots at the top:
  1. **Warm-up** (~1 min): 3 words already learnt, highest recall first; hear them and see them. Does not change scheduling. Skipped when nothing has been learnt yet.
  2. **Reviews**: due learning and review cards (mixed across decks and types, as section 7; the "4 reviews : 1 new" rule no longer applies because new words have their own step).
  3. **New words**: each brand-new note is **taught first** (teach screen: picture, word in article colour, audio, meaning, plural/forms, example, tip), then checked straight away with its first card. Learning steps bring it back later in the same step.
  4. **Challenge**: 5 quiz questions (formats from section 8.1), today's words first. Score shown on the finish screen, not stored as the daily quiz.
  5. **Finish**: streak, cards, new words, % right first time, challenge score, tomorrow's preview, one suggestion (Car mode in the evening, otherwise shadowing or the daily quiz).
- **Skip to…** (bottom sheet) jumps to any step or "Finish for today". Skipped cards stay due. Warm-up and challenge run once per day.
- The 5 / 15 min time box moves to "More practice → Quick review (5 min)".

### C2. Cards
- First card of a new `n`, `v`, `w` note is **produce** (the check after teaching); *recognise* follows on a later day (sibling rule unchanged). Card IDs do not change.
- Grading: two big buttons **✗ Missed it** (= Again) and **✓ Got it** (= Good), plus small **Hard** and **Easy** links, each with its next interval.
- **The app grades itself** where it can check the answer, and shows **Continue**: word order (right = Good, wrong = Again), wrong article (Again), typing mode (correct = Good, almost = Hard, wrong = Again). Undo still works.
- Feedback: short sounds generated on the device (Web Audio, no files, no network; setting to turn off), a combo counter for answers in a row, small animations (off with "reduce motion").

### C3. Screens and navigation
- Three tabs: **Today**, **Journey** (lessons as a path with Start/Pause, words-known goal bar toward A2, hard words), **Me** (streak, stats, 14-day bars, quiz scores, settings).
- **More practice** (from Today and the finish screen): Quick review 5 min, Daily quiz, Car mode, Shadowing, Drills, Copy weak words for Claude.
- Visual design (colours, type, final look) is a separate later pass.

---

## Part D. Version 2, Phase 2: natural voices (APPROVED by Saad, 2026-11-15)

### D1. Recorded voices
- Every German text the app can speak (`audioTexts()` in decks.js: the note's German, example, plural, verb forms, cloze sentence, word-order sentence, plus a few fixed phrases) is recorded once with free, open-source **Piper** voices, all **CC0**: Kerstin (female, medium), Thorsten (male, high), and Thorsten "emotional" (amused, surprised, whispering, sleepy).
- Files: `audio/<voice>/<key>.mp3` (mono MP3, ~5 KB each), `key = audioKey(text)` (same stable hash as note IDs, on the cleaned-up text). `audio/index.json` lists the keys per voice.
- Made by `tools/make_audio.py` (dev tool, not part of the app). Only missing clips are made. **Every new deck must be recorded before publishing**; a test fails if any text lacks a clip.
- No network call to any speech service at runtime: the clips are the app's own files.

### D2. Voice picker (Me → Settings → Voice)
- **Kerstin & Thorsten** (default): both voices, a stable choice per text, so you hear different speakers (talker variety trains listening).
- **Kerstin**, **Thorsten**, **Thorsten's moods** (a random mood each time), **iPhone voice** (Web Speech, as before).
- Speed (0.7–1.0×) and the 🐢 slow button work on recorded clips too (pitch kept).
- If a clip is missing, the iPhone voice is used; if neither exists, 🔊 buttons and listening cards stay hidden (as section 9).

### D3. Offline
- Clips are cached on the device in their own cache, kept across app updates.
- Clips for started lessons (and every word already introduced) are saved automatically in the background when online; Settings has "Save all voices for offline".
