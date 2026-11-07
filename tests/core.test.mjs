// The plan, the checks and the file formats. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../public/core.js";

const TODAY = "2026-03-20";  // a Friday
const settings = (o = {}) => Object.assign({}, C.DEFAULT_SETTINGS, { onboarded: true, conditions: ["pots"], pem: "no", plan: C.newPlan("pots", "2026-03-01") }, o);
// Mornings with steady readings for the days before `upto`, so baselines exist.
function history(upto, n = 14, m = { rhr: 60, hrv: 50, scale: 1, sleep: 8 }, steps = 6000) {
  const days = {};
  for (let i = 1; i <= n; i++) days[C.shiftISO(upto, -i)] = { morning: Object.assign({}, m), wearable: { steps } };
  return days;
}

test("the template follows the conditions; post-exertional malaise means pacing", () => {
  assert.equal(C.pickTemplate(["pots"], "no"), "pots");
  assert.equal(C.pickTemplate(["pots"], "yes"), "pacing");
  assert.equal(C.pickTemplate(["longcovid"], "unsure"), "pacing");
  assert.equal(C.pickTemplate(["migraine"], "unsure"), "migraine");
  assert.equal(C.pickTemplate(["concussion", "migraine"], "no"), "concussion");
  assert.equal(C.pickTemplate([], "no"), "pacing", "nothing chosen: the gentlest plan");
  const p = C.newPlan("pots", TODAY);
  p.week.mon = "rest";
  assert.equal(C.TEMPLATES.pots.week.mon, "session", "a plan is a copy; editing it leaves the template alone");
});

test("the evening asks about the chosen conditions' symptoms, plus any already logged", () => {
  assert.deepEqual(C.symptomKeys(["migraine"]), ["headache", "nausea", "light", "noise", "dizzy"]);
  const both = C.symptomKeys(["pots", "migraine"]);
  assert.equal(both.filter(k => k === "headache").length, 1);
  assert.ok(C.symptomKeys(["migraine"], ["legs"]).includes("legs"));
});

test("a check-in after midnight counts for the day before", () => {
  assert.equal(C.logDayISO(new Date(2026, 2, 21, 0, 30)), "2026-03-20");
  assert.equal(C.logDayISO(new Date(2026, 2, 21, 4, 0)), "2026-03-21");
});

test("cycle: off unless tracked; the week before a period; predicted cycles", () => {
  assert.equal(C.cycleOf(TODAY, settings(), TODAY), null);
  const s = settings({ cycle: { track: true, starts: ["2026-03-01"], length: 28 } });
  assert.deepEqual(C.cycleOf("2026-03-02", s, TODAY), { day: 2, period: true, late: false, predicted: false });
  assert.equal(C.cycleOf("2026-03-23", s, TODAY).late, true, "day 23 of 28");
  const next = C.cycleOf("2026-03-30", s, TODAY);
  assert.deepEqual([next.day, next.predicted], [2, true], "the next cycle is predicted from day 29");
  assert.equal(C.cycleOf("2026-02-20", s, TODAY), null, "nothing before the first logged start");
});

test("baselines are medians of your own last 28 days, from 7 days on", () => {
  const days = history(TODAY, 6);
  assert.equal(C.baselines(days, TODAY).rhr.value, null, "six days is not enough");
  days[C.shiftISO(TODAY, -7)] = { morning: { rhr: 70, hrv: 40 }, wearable: { steps: 9000 } };
  const b = C.baselines(days, TODAY);
  assert.deepEqual([b.rhr.value, b.hrv.value, b.steps.value], [60, 50, 6000]);
});

test("the morning check: red lines against your baseline, amber below them, short nights", () => {
  const base = { rhr: { value: 60 }, hrv: { value: 50 }, steps: { value: 6000 } }, L = C.DEFAULT_LIMITS;
  assert.deepEqual(C.gate({ rhr: 64 }, base, L, false).red, ["resting heart rate 64 is high for you"]);
  assert.deepEqual(C.gate({ hrv: 42 }, base, L, false).red, ["HRV 42 is low for you"], "15 percent under 50 is 42.5, rounded to 43");
  assert.equal(C.gate({ hrv: 44 }, base, L, false).red.length, 0);
  assert.deepEqual(C.gate({ scale: 4 }, base, L, false).amber, ["symptoms 4 out of 10"]);
  assert.deepEqual(C.gate({ rise: 32 }, base, L, true).amber, ["standing rise of 32"]);
  assert.equal(C.gate({ rise: 45 }, base, L, false).red.length, 0, "the standing test counts only for POTS");
  assert.equal(C.gate({ sleep: 5.5 }, base, L, false).short, true);
  assert.equal(C.gate({ sleep: null }, base, L, false).short, false, "no sleep reading is not a short night");
  assert.equal(C.gate({ rhr: 64 }, { rhr: { value: null }, hrv: { value: null } }, L, false).red.length, 0, "no baseline yet, no heart red line");
});

test("the plan for a day: as planned, rest, light, busy", () => {
  const s = settings();
  const days = history(TODAY);
  const planned = C.planFor(TODAY, s, days, TODAY);
  assert.deepEqual([planned.type, planned.label, planned.tone, planned.ceiling], ["session", "Cardio day", "blue", 4500], "Friday is a session; three quarters of 6,000 steps");
  assert.equal(planned.minutes, 24, "two weeks since 1 Mar: 20 + 2 + 2");
  const red = C.planFor(TODAY, s, Object.assign({}, days, { [TODAY]: { morning: { rhr: 66, scale: 1 } } }), TODAY);
  assert.deepEqual([red.type, red.label, red.ceiling, red.why[0]], ["rest", "Rest day", 3000, "resting heart rate 66 is high for you"]);
  const short = C.planFor(TODAY, s, Object.assign({}, days, { [TODAY]: { morning: { sleep: 5, scale: 1 } } }), TODAY);
  assert.equal(short.label, "Rest day, short night");
  const light = C.planFor(TODAY, s, Object.assign({}, days, { [TODAY]: { morning: { scale: 4 } } }), TODAY);
  assert.deepEqual([light.type, light.lines[1]], ["light", "Lying or seated cardio: bike, rower or pool, 12 min, easy"]);
  const busy = C.planFor(TODAY, s, Object.assign({}, days, { [TODAY]: { morning: { scale: 1, plans: { meetings: 1 } } } }), TODAY);
  assert.deepEqual([busy.type, busy.label, busy.short, busy.ceiling, busy.notes[0]], ["open", "Busy day", "Busy", 6000, "Your plans take the place of today's session."]);
  const free = C.planFor("2026-03-19", s, days, TODAY);
  assert.deepEqual([free.type, free.label, free.short, free.tone], ["open", "No session", "", "free"], "Thursday has no session and no plans: no word in the calendar");
});

test("travel makes the next day a rest day", () => {
  const s = settings(), days = history(TODAY);
  days[C.shiftISO(TODAY, -1)] = { morning: { scale: 1, plans: { travel: 1 } } };
  const p = C.planFor(TODAY, s, days, TODAY);
  assert.deepEqual([p.type, p.notes[0]], ["rest", "A rest day after yesterday's travel."]);
});

test("pacing: no step-ups, and a heart-rate ceiling from your resting heart rate", () => {
  const s = settings({ conditions: ["longcovid"], pem: "yes", plan: C.newPlan("pacing", "2026-01-01") });
  const p = C.planFor("2026-03-19", s, history("2026-03-19"), TODAY);
  assert.deepEqual([p.type, p.minutes], ["session", 10], "Thursday is gentle movement; still 10 minutes after 11 weeks");
  assert.ok(p.lines.includes("Keep your heart rate under 75"), p.lines);
});

test("progression holds in the week before a period", () => {
  const s = settings({ cycle: { track: true, starts: ["2026-02-20"], length: 28 } });
  s.plan.start = "2026-03-01";
  // From 1 to 20 Mar: days 10 to 28 of the cycle; days 22 to 28 (13 to 19 Mar) hold. 19 days, 7 held: 12, one week.
  assert.equal(C.sessionMinutes(s.plan, TODAY, s, TODAY), 22);
});

test("flares: two red mornings start one, two good mornings end it; a crash starts one the next day", () => {
  const s = settings(), days = history("2026-03-16");
  days["2026-03-16"] = { morning: { rhr: 70, scale: 1 } };
  days["2026-03-17"] = { morning: { rhr: 70, scale: 1 } };
  assert.equal(C.flareOn(days, "2026-03-16", s, TODAY).active, false);
  assert.deepEqual([C.flareOn(days, "2026-03-17", s, TODAY).active, C.flareOn(days, "2026-03-18", s, TODAY).length], [true, 2]);
  assert.equal(C.planFor("2026-03-18", s, days, TODAY).type, "flare");
  days["2026-03-18"] = { morning: { rhr: 60, hrv: 50, scale: 1 } };
  days["2026-03-19"] = { morning: { rhr: 60, hrv: 50, scale: 1 } };
  assert.equal(C.flareOn(days, "2026-03-19", s, TODAY).active, false);
  const crash = history(TODAY);
  crash[C.shiftISO(TODAY, -1)].evening = { crash: true };
  assert.equal(C.flareOn(crash, TODAY, s, TODAY).active, true);
  const tonight = history(TODAY); tonight[TODAY] = { evening: { crash: true } };
  assert.equal(C.flareOn(tonight, C.shiftISO(TODAY, 1), s, TODAY).active, true, "tomorrow shows the flare after a crash tonight");
});

test("training a day held: the evening's answer and workouts by sport", () => {
  const plan = C.newPlan("pots", TODAY);
  assert.deepEqual(C.sessionsDone({ evening: { session: "full" } }, plan), ["Cardio"]);
  assert.deepEqual(C.sessionsDone({ wearable: { workouts: [{ name: "Swimming" }, { name: "Walking" }, { name: "Functional Fitness", strain: 6.1 }, { name: "Cycling", strain: 0 }] } }, plan), ["Pool", "Lift"]);
});

test("WHOOP export: cycles dated by wake, workouts by start, quoted cells", () => {
  const cycles = [
    '"Cycle start time","Cycle end time","Cycle timezone","Recovery score %","Resting heart rate (bpm)","Heart rate variability (ms)","Skin temp (celsius)","Blood oxygen %","Day Strain","Energy burned (cal)","Max HR (bpm)","Average HR (bpm)","Sleep onset","Wake onset","Sleep performance %","Respiratory rate (rpm)","Asleep duration (min)"',
    '2026-03-18 23:10:00,2026-03-19 22:55:00,UTC-04:00,64,58,61.4,33.8,96.2,8.3,1900,150,70,2026-03-18 23:15:00,2026-03-19 07:02:00,88,15.2,452',
    '2026-03-19 22:55:00,,UTC-04:00,,,,,,,,,,,,,,'
  ].join("\n");
  assert.equal(C.whoopFileKind(cycles), "cycles");
  assert.deepEqual(C.parseWhoopCycles(cycles), { "2026-03-19": { recovery: 64, rhr: 58, hrv: 61, sleepHours: 7.5, sleepPct: 88, strain: 8.3, respRate: 15.2, skinTempC: 33.8, spo2: 96.2 } });
  const workouts = 'Cycle start time,Workout start time,Workout end time,Duration (min),Activity name,Activity Strain\n2026-03-18 23:10:00,2026-03-19 17:00:00,2026-03-19 17:30:00,30,"Swimming, pool",9.1';
  assert.equal(C.whoopFileKind(workouts), "workouts");
  assert.deepEqual(C.parseWhoopWorkouts(workouts), { "2026-03-19": [{ name: "Swimming, pool", minutes: 30, strain: 9.1 }] });
});

test("reminders: a calendar file with two daily alarms", () => {
  const ics = C.reminderICS({ morning: "10:00", evening: "22:30" }, new Date(2026, 2, 20, 12, 0), "https://example.test/");
  assert.ok(ics.includes("\r\n") && !/[^\r]\n/.test(ics), "lines end in CRLF");
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(ics, /DTSTART:20260321T100000\r\nDURATION:PT5M\r\nRRULE:FREQ=DAILY\r\nSUMMARY:Morning check-in/);
  assert.match(ics, /DTSTART:20260321T223000/);
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
});

test("spreadsheet export: one row per day, symptoms by name, quoted notes", () => {
  const s = settings({ conditions: ["migraine"] });
  const csv = C.exportCSV({ [TODAY]: { morning: { scale: 2 }, evening: { symptoms: { headache: 6, light: null }, migraine: true, notes: "late, loud dinner" } } }, s, TODAY);
  const [head, row] = csv.trim().split("\r\n");
  assert.match(head, /^Date,Cycle day,Sleep \(h\),Resting HR/);
  assert.ok(head.includes("Headache") && head.includes("Light sensitivity"));
  assert.ok(row.startsWith(TODAY) && row.includes(',6,') && row.includes(',yes,') && row.endsWith('"late, loud dinner"'), row);
});

test("setup: answers become the plan, the week, the session and the symptoms to ask about", () => {
  const s = C.settingsFromAnswers({ conditions: ["pots", "migraine"], age: 34, sex: "female", pem: "no", goodDay: "10to20", exercise: ["swim", "bike", "walk"],
    outDays: ["tue", "thu"], symptoms: ["headache", "lightheaded", "nope"], cycle: "yes", lastPeriod: "2026-03-02", onset: "2026-02-01", symptomNote: " dizzy in showers ", other: "" }, TODAY);
  assert.equal(s.plan.template, "pots");
  assert.deepEqual(s.plan.week, { mon: "session", tue: "open", wed: "open", thu: "open", fri: "session", sat: "rest", sun: "session" }, "sessions on the days at home");
  assert.deepEqual([s.plan.session.title, s.plan.session.minutes, s.plan.session.short], ["Lying or seated cardio: swimming or a stationary bike", 15, "Cardio"]);
  assert.deepEqual([s.symptoms, s.age, s.ageAsOf, s.sex, s.onset, s.context.symptoms], [["headache", "lightheaded"], 34, TODAY, "female", "2026-02-01", "dizzy in showers"]);
  assert.deepEqual([s.cycle.track, s.cycle.starts], [true, ["2026-03-02"]]);
  assert.deepEqual(C.symptomKeys(s.conditions, ["fog"], s.symptoms), ["headache", "lightheaded", "fog"], "the evening asks about the chosen symptoms");
});

test("setup: no period questions after male; pacing after post-exertional malaise; a single kind of exercise names the session", () => {
  assert.equal(C.asksCycle({ sex: "male" }), false);
  assert.equal(C.asksCycle({ sex: "unsaid" }), true);
  const m = C.settingsFromAnswers({ conditions: ["pots"], sex: "male", cycle: "yes", lastPeriod: "2026-03-02" }, TODAY);
  assert.equal(m.cycle.track, false);
  const p = C.settingsFromAnswers({ conditions: ["longcovid"], pem: "yes", goodDay: "lt10", exercise: ["home"] }, TODAY);
  assert.deepEqual([p.plan.template, p.plan.session.minutes, p.plan.session.title], ["pacing", 5, "Gentle movement, lying or seated: exercises at home"]);
  assert.deepEqual(C.weekFor("pacing", []), { mon: "session", tue: "rest", wed: "session", thu: "rest", fri: "open", sat: "open", sun: "rest" }, "pacing rests after sessions");
  assert.equal(C.sessionFor("concussion", ["walk"]).short, "Walk");
  assert.equal(C.settingsFromAnswers({ conditions: ["other"], pem: "no" }, TODAY).plan.template, "concussion", "other: light daily activity");
});

test("before and since the start, and where resting heart rate rose", () => {
  const days = {};
  for (let i = 0; i < 60; i++) {
    const k = C.shiftISO("2026-01-01", i), after = k >= "2026-01-31";
    days[k] = { wearable: { rhr: after ? 63 : 56, hrv: after ? 48 : 70, sleepHours: after ? 6.8 : 7.6 } };
  }
  const ba = C.beforeAfter(days, "2026-01-31");
  assert.deepEqual([ba.rhr, ba.hrv], [{ before: 56, after: 63 }, { before: 70, after: 48 }]);
  const shift = C.findShift(days);
  assert.deepEqual([shift.date, shift.delta], ["2026-01-31", 7]);
  const flat = {}; for (let i = 0; i < 60; i++) flat[C.shiftISO("2026-01-01", i)] = { wearable: { rhr: 58 + (i % 2) } };
  assert.equal(C.findShift(flat), null, "no rise of 3 or more: nothing to report");
  assert.equal(C.beforeAfter(days, ""), null);
});

test("heart-rate guide: your own number, resting heart rate plus 15 when pacing, else from age", () => {
  const base = { rhr: { value: 60 }, hrv: { value: null }, steps: { value: null } };
  const pots = settings({ age: 30, ageAsOf: "2025-01-01" });
  assert.equal(C.ageNow(pots, TODAY), 31, "a year on, a year older");
  assert.equal(C.hrCap(pots, base, TODAY), Math.round((220 - 31) * 0.7));
  const pacing = settings({ age: 30, plan: C.newPlan("pacing", TODAY) });
  assert.equal(C.hrCap(pacing, base, TODAY), 75);
  assert.equal(C.hrCap(pacing, { rhr: { value: null } }, TODAY), Math.round(190 * 0.55));
  const own = settings({ age: 30 }); own.plan.hrCap = 125;
  assert.equal(C.hrCap(own, base, TODAY), 125);
  assert.equal(C.hrCap(settings(), base, TODAY), null, "no age, no guide");
  const p = C.planFor(TODAY, settings({ age: 40, ageAsOf: TODAY }), history(TODAY), TODAY);
  assert.ok(p.lines.includes("Keep your heart rate under 126"), p.lines);
});
