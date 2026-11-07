# Notes for Claude Code

POTS Tracker: a public, open-source daily plan and log for POTS, long COVID, post-concussion symptoms and migraine. It will ship on the App Store as an iPhone app (a Capacitor layer around the web app) and runs as a web app too.

## Privacy rules (never break these)

- People's health data stays on their own device. The project owner must never see or touch anyone's data.
- No server stores user data. No accounts, no analytics, no crash reporting that carries data, no third-party scripts, fonts or images.
- Keep the content security policy strict (in `public/index.html` and `vercel.json`): `connect-src 'self'` and nothing that sends data elsewhere.
- Wearable data comes in on the device only: Apple Health in the iPhone app, WHOOP's export file in either version. No WHOOP API or other cloud sync unless it runs on the user's own device without an intermediary server.
- Reminders are scheduled on the device (local notifications), or given as a calendar file.
- The repository holds no personal data: no logs, no real dates of anyone's cycle, no doctor names, no one's baselines.

## Interface principles (from the owner)

- Plain words, one instruction per line, sentence case. No eyebrow labels, small helper text or clutter.
- Setup is meant to be fun (this is a miserable disease): big playful type, the out-of-breath heart, short plain text, one question per screen, each skippable. Order: So you have POTS; flourishing life; conditions; when you're ready; about you (age, sex at birth); tracker; when it started; symptoms; exercise; energy; days out; bedtime; cycle (skipped after male); anything else; the plan. Logic for turning answers into settings lives in `core.js` (`settingsFromAnswers`, `weekFor`, `sessionFor`, `findShift`, `beforeAfter`).
- After setup, the app has the same structure as the owner's personal app: Today (flare and after-flare banners, the day with its Why line and "How to do the session", this week), the two check-ins, Calendar (its box previews a coming day), Review (charts, this week, log) and Settings (cycle, data, wearables, reminders, then plan, conditions, about you).
- Today tells and asks nothing; the check-ins ask and tell nothing about the day. Settings holds settings.
- Check-ins open by themselves: the morning one from 4 am until done, the evening one from 10 pm until 4 am (after midnight it counts for the day before). "Not now" keeps one closed for the rest of that day.
- Evening symptoms are taps; a 0 to 10 box appears only for a tapped one.
- Day colours say what a day is for: the main session blue; floor sets, light sessions and other exercise violet; rest grey; busy plain. A day with no session and no plans is blank in the calendar; its name is "No session". Cycle markers use red alone: period, mid-cycle and luteal.
- The first screen explains POTS in a quotation from the 2019 NIH expert consensus (Vernino and others, Autonomic Neuroscience 2021, PMC8455420), with its source underneath. Keep any explanation of a condition quoted from a published source, word for word, never written by us.
- The privacy policy (`public/privacy.html`) is the ONC 2018 Model Privacy Notice, filled in. Keep its wording; change only the options and the blanks, and list any of our own words in the README's Privacy section. Update it, and its date, whenever the app's handling of data changes.
- Safety wording (a medical note, when to get care) is deferred: the owner will define it. Apple asks health apps that give advice to remind people to check with a doctor (App Store guideline 1.4.1), so it is needed before submission.

## Code

- `public/core.js` is pure and tested (`npm test`). Put logic there, not in `app.js`.
- `public/app.js` holds the screens, storage (localStorage, keys `pt.settings`, `pt.days`, `pt.notNow`) and the bridges to Capacitor plugins (`HealthData`, `LocalNotifications`, `Filesystem`, `Share`), all optional.
- No build step and no runtime dependencies for the web app.
- `ios/` is the Capacitor iPhone project (Swift Package Manager). The Apple Health plugin and `MainViewController`, which registers it, live in `ios/App/App/AppDelegate.swift`, so no Xcode project edits are needed for them. After changing `public/`, run `npx cap sync ios`. CI (`.github/workflows/ci.yml`) runs the tests and an unsigned simulator build on macOS.
- Dates are local `YYYY-MM-DD`; never `toISOString` for calendar dates.
- Writing: no em or en dashes; short sentences; sentence case.
