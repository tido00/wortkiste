# Wortkiste: rules for Claude Code

This repo is Saad's personal German flashcard app. **SPEC.md is the plan. Build exactly what it says.**

## The end goal
An app Saad opens from his iPhone home screen, every day, for 5–20 minutes, that takes him from A1 to passing the Goethe A2 exam. It must be free, private, offline-capable, and simple enough that he never needs to touch code or GitHub. Adding a lesson later = adding one deck file.

## Who Saad is
Adult beginner in German. Native Arabic/Darija, fluent French and English. Not a developer: he does not know Git or GitHub, so never ask him to run commands or edit files. Give him plain-language updates, short, with links he can tap on his phone.

## Permissions Saad has given (2026-11-15)
Saad has given you full access to do the whole job yourself: create files, commit, push to `main`, set up GitHub Pages (GitHub Actions deploy), and fix problems until the app is live. You don't need to ask before each step.

Still ask him first before: deleting the repo or its history (force push), making anything paid, adding any third-party service, tracker or external network call (SPEC.md forbids them), or changing the learning design in SPEC.md Part A.

## How to work
- Model: Opus 5.5. Switch to Fable only if stuck (e.g. FSRS tests fail twice after real fixes).
- Plan first, in a short checklist, then build in small commits.
- Run `node --test tests/` before every push. Never skip or delete a failing test to get green.
- Anything outside SPEC.md goes under "Ideas for v2" in README.md. Don't build it.
- When done, give Saad: the app URL, and 3 steps to add it to his iPhone home screen (Safari → Share → Add to Home Screen).
- If something needs a click only Saad can do (e.g. a GitHub setting the API can't change), tell him the exact taps, one per line.
