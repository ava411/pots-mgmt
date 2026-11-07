# POTS Tracker

A daily plan and log for POTS, long COVID, post-concussion symptoms and migraine. Your data stays on your phone.

## Privacy

- Everything you enter stays on your device. There are no accounts, and no server stores anything.
- The app loads only its own files. Its content security policy stops it from sending data to any other site, and it uses no analytics or outside fonts.
- Backups are files you save and keep yourself.

## What it does

- **Morning check-in.** It opens by itself until it's done. Sleep, resting heart rate and HRV come from Apple Health or a WHOOP file when you have them; otherwise you type them, or leave them out. You rate your symptoms 0 to 10, do the standing test if you have POTS, and tap what's planned today (chores, meetings, events, travel).
- **Today.** The day's plan: a session, a light session, no session or rest; a step limit; bedtime; and a line of your own, such as a fluid target.
- **Evening check-in.** It opens by itself from 10 pm. Tap the symptoms you had and score them, say whether you had a migraine or took rescue medication, whether you crashed, and whether you did the session.
- **Calendar.** What each day is for, the exercise you did, and your cycle if you track it. The box underneath previews tomorrow.
- **Review.** Four weeks of resting heart rate, HRV, symptoms, standing rise and steps, against your limits, and this week in plain lines.

## Starting plans

The answers at setup pick a starting plan. Everything in it can be changed in Settings, ideally with your clinician.

| Conditions | Starting plan | What it does |
| --- | --- | --- |
| POTS | Build up slowly | Lying or seated cardio three times a week, a little longer each week |
| Long COVID, or symptoms that get worse a day or two after doing too much | Pacing | Gentle movement within your limits, with no step-ups |
| Post-concussion | Light daily activity | Easy cardio most days, below the level that brings symptoms on |
| Migraine | Steady routine | Easy cardio three times a week; the log counts migraine days |

Limits come from your own data. After 7 mornings with readings, a resting heart rate 4 above your usual, or HRV 15 percent below it, turns the day into rest. So does a symptom score of 6 or more, or a standing rise of 40 or more. A score of 4 or 5, or a rise of 30 to 39, makes it a light day. Two such rest mornings in a row, or a crash, start a flare, which ends after two good mornings. Steps follow your own usual count. Every number can be changed.

## Wearables

- **Apple Watch and WHOOP, through Apple Health** (iPhone app). The Apple Watch records into Apple Health, and WHOOP can sync to Apple Health from its own app. Recovery reads sleep, resting heart rate, HRV, steps, workouts and logged periods from there, on the phone.
- **WHOOP recovery scores** aren't in Apple Health. Request your data export in the WHOOP app, unzip the file WHOOP sends, and import `physiological_cycles.csv` (and `workouts.csv`) in Settings. The file is read on the phone.
- No wearable: type the numbers you have, or skip them.

## Reminders

The iPhone app schedules its own reminders on the phone. On the web version, Settings makes a calendar file with two daily alarms for your calendar app.

## Use it

- **Web:** open the site on your phone and add it to your home screen. On an iPhone, the home-screen app keeps its data more reliably than a Safari tab.
- **iPhone app:** coming to the App Store.

## Run your own copy

The app is a static site in `public/`, with no build step. Any static host works; `vercel.json` sets the security headers on Vercel.

```
npm test        # the plan engine, WHOOP files, calendar file and spreadsheet export
```

## Layout

- `public/core.js`: the plan, the checks and the file formats. No screen code or storage, so it can be tested on its own.
- `public/app.js`: the screens, storage on the device, and the bridges to the iPhone app.
- `public/index.html`: the page and its styles. `sw.js` keeps the app working offline.
- `tests/`: unit tests (`node --test`, no dependencies).

## License

MIT
