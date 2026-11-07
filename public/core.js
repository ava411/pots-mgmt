// POTS Tracker core: the plan, the checks and the file formats. No screen code and no storage here, so it can be
// tested on its own. Everything below is a starting point that each person edits; nothing is tuned to one person.

/* ============================ Conditions, symptoms, templates ============================ */
export const CONDITIONS = [["pots", "POTS"], ["migraine", "Migraine"], ["concussion", "Post-concussion"], ["longcovid", "Long COVID or respiratory illness"], ["other", "Other"]];
export const SYMPTOMS = {
  headache: "Headache", dizzy: "Dizziness", lightheaded: "Lightheaded", legs: "Heavy legs", heart: "Racing heart",
  fatigue: "Fatigue", fog: "Brain fog", breath: "Breathless", eyes: "Eye strain", light: "Light sensitivity",
  noise: "Noise sensitivity", nausea: "Nausea", pain: "Pain", sleep: "Poor sleep"
};
export const CONDITION_SYMPTOMS = {
  pots: ["lightheaded", "legs", "heart", "fatigue", "fog", "breath"],
  longcovid: ["fatigue", "fog", "breath", "heart", "pain", "sleep"],
  concussion: ["headache", "dizzy", "eyes", "light", "noise", "fog", "nausea"],
  migraine: ["headache", "nausea", "light", "noise", "dizzy"],
  other: ["fatigue", "fog", "pain", "sleep", "headache", "dizzy"]
};
export const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
// A week is made of three kinds of day: a session, no session, or rest.
export const TEMPLATES = {
  pots: {
    label: "Build up slowly",
    about: "Lying or seated cardio three times a week, a little longer each week.",
    week: { mon: "session", tue: "open", wed: "session", thu: "open", fri: "session", sat: "open", sun: "rest" },
    session: { title: "Lying or seated cardio: bike, rower or pool", short: "Cardio", day: "Cardio day", minutes: 20, addPerWeek: 2, maxMinutes: 45 }
  },
  pacing: {
    label: "Pacing",
    about: "Gentle movement within your limits, with no step-ups. The aim is fewer crashes.",
    week: { mon: "session", tue: "rest", wed: "open", thu: "session", fri: "rest", sat: "open", sun: "rest" },
    session: { title: "Gentle movement, lying or seated", short: "Move", day: "Gentle movement", minutes: 10, addPerWeek: 0, maxMinutes: 10 },
    hrAboveRest: 15
  },
  concussion: {
    label: "Light daily activity",
    about: "Easy cardio most days, below the level that brings symptoms on, a little longer each week.",
    week: { mon: "session", tue: "session", wed: "session", thu: "session", fri: "session", sat: "session", sun: "rest" },
    session: { title: "Easy walk or bike. Stop if symptoms rise by 2 or more", short: "Cardio", day: "Cardio day", minutes: 15, addPerWeek: 2, maxMinutes: 40 }
  },
  migraine: {
    label: "Steady routine",
    about: "Easy cardio three times a week and a steady routine. The log counts migraine days.",
    week: { mon: "session", tue: "open", wed: "session", thu: "open", fri: "session", sat: "open", sun: "open" },
    session: { title: "Easy cardio", short: "Cardio", day: "Cardio day", minutes: 20, addPerWeek: 2, maxMinutes: 40 }
  }
};
export const DEFAULT_LIMITS = { sleepMin: 6.5, rhrAbove: 4, hrvBelowPct: 15, symptomRed: 6, symptomAmber: 4, riseRed: 40, riseAmber: 30 };
// Plans tapped in the morning, and roughly how many steps each takes.
export const PLAN_STEPS = { chores: 500, meetings: 1500, events: 2500, travel: 3000 };
export const PLAN_LABEL = { chores: "Chores", meetings: "In-person meetings", events: "Events", travel: "Travel" };
// Baselines are medians of your own last 28 days; they need 7 days with the reading.
export const BASELINE = { days: 28, min: 7 };
export const DEFAULT_SETTINGS = { onboarded: false, conditions: [], pem: "no", cycle: { track: false, starts: [], length: 28 }, plan: null, reminders: { morning: "10:00", evening: "22:00" },
  onset: "", tracker: "", symptoms: [], exercise: [], goodDay: "", outDays: [], context: { symptoms: "", other: "" }, age: null, ageAsOf: "", sex: "" };
export const SEXES = [["female", "Female"], ["male", "Male"], ["intersex", "Intersex"], ["unsaid", "Prefer not to say"]];
// Periods are asked about unless the person said male at birth.
export function asksCycle(x) { return !x || x.sex !== "male"; }
export function ageNow(s, today) {
  const a = num(s && s.age);
  if (a == null) return null;
  return isDate(s.ageAsOf) && isDate(today) ? a + Math.floor(daysBetween(parseISO(s.ageAsOf), parseISO(today)) / 365.25) : a;
}
// A heart-rate guide for sessions: the person's own number, else resting heart rate plus 15 when pacing, else 70
// percent of the age-based maximum (220 minus age), 55 percent when pacing.
export function hrCap(s, base, today) {
  const P = s.plan || {}, own = num(P.hrCap);
  if (own != null) return own;
  const pacing = P.template === "pacing", age = ageNow(s, today);
  if (pacing && base && base.rhr && base.rhr.value != null) return base.rhr.value + (TEMPLATES.pacing.hrAboveRest || 15);
  return age != null ? Math.round((220 - age) * (pacing ? 0.55 : 0.7)) : null;
}
// Exercise people might manage at least once a week, by what they have access to.
export const EXERCISES = [["home", "Exercises at home, no equipment"], ["gym", "Exercises with basic gym equipment"], ["swim", "Swimming"], ["bike", "A stationary or recumbent bike"],
  ["cycle", "Cycling outdoors"], ["row", "A rowing machine"], ["walk", "Walking"], ["yoga", "Yoga or Pilates"]];
const EXERCISE_WORD = { home: "exercises at home", gym: "gym exercises", swim: "swimming", bike: "a stationary bike", cycle: "cycling", row: "rowing", walk: "walking", yoga: "yoga or Pilates" };
const EXERCISE_SHORT = { swim: "Pool", bike: "Bike", cycle: "Bike", row: "Row", walk: "Walk" };
// How long a good day allows before symptoms build, and the first session length it gives.
export const GOOD_DAY = [["lt10", "Under 10 minutes", 10], ["10to20", "10 to 20 minutes", 15], ["20to40", "20 to 40 minutes", 20], ["gt40", "Over 40 minutes", 30]];

// Post-exertional malaise points to pacing, whatever else is chosen.
export function pickTemplate(conditions, pem) {
  const has = c => (conditions || []).includes(c);
  if (pem === "yes" || (pem === "unsure" && has("longcovid"))) return "pacing";
  if (has("pots")) return "pots";
  if (has("concussion") || has("other")) return "concussion";
  if (has("migraine")) return "migraine";
  return "pacing";
}
export function newPlan(template, start) {
  const T = TEMPLATES[template] || TEMPLATES.pacing;
  return { template: TEMPLATES[template] ? template : "pacing", start, week: Object.assign({}, T.week), session: Object.assign({}, T.session),
    steps: { open: null, session: null, rest: null }, limits: Object.assign({}, DEFAULT_LIMITS), bedtime: "", note: "" };
}
// The symptoms the evening asks about: those of the chosen conditions, in that order, plus any already logged.
export function symptomKeys(conditions, logged = [], chosen = []) {
  const out = [];
  const list = conditions && conditions.length ? conditions : CONDITIONS.map(c => c[0]);
  if (chosen && chosen.length) chosen.forEach(k => { if (SYMPTOMS[k] && !out.includes(k)) out.push(k); });
  else list.forEach(c => (CONDITION_SYMPTOMS[c] || []).forEach(k => { if (!out.includes(k)) out.push(k); }));
  logged.forEach(k => { if (!out.includes(k)) out.push(k); });
  return out;
}
export function hasCondition(s, c) { return !!(s && s.conditions && s.conditions.includes(c)); }
export function asksCrash(s) { return !!s && (s.pem === "yes" || s.pem === "unsure" || hasCondition(s, "longcovid")); }

/* ============================ Dates (local calendar dates, YYYY-MM-DD) ============================ */
export function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
export function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
export function todayISO(now = new Date()) { return iso(now); }
export function shiftISO(s, n) { return iso(addDays(parseISO(s), n)); }
export function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseISO(s)); }
// The day a check-in belongs to: one done after midnight and before 4 am counts for the day before.
export function logDayISO(now = new Date()) { return iso(now.getHours() < 4 ? addDays(now, -1) : now); }
export function mondayOf(d) { const x = new Date(d); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
export function num(v) { if (v == null || v === "") return null; const n = Number(v); return isFinite(n) ? n : null; }
const round100 = x => Math.round(x / 100) * 100;
export function median(a) {
  const s = a.slice().sort((x, y) => x - y), n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
}

/* ============================ Cycle (optional) ============================ */
// From the period starts the person logs. Day 1 is a start; the last 7 days before the next start are the week
// before a period, when progression holds. Dates after today follow predicted cycles.
export function nextStart(s, today) {
  const starts = cycleStarts(s); if (!starts.length) return null;
  const due = shiftISO(starts[starts.length - 1], cycleLength(s));
  return due <= today ? shiftISO(today, 1) : due;
}
export function cycleStarts(s) { return Array.from(new Set(((s && s.cycle && s.cycle.starts) || []).filter(isDate))).sort(); }
export function cycleLength(s) { return Math.max(20, Math.min(45, Number(s && s.cycle && s.cycle.length) || 28)); }
export function cycleOf(dateStr, s, today) {
  if (!s || !s.cycle || !s.cycle.track) return null;
  const starts = cycleStarts(s), len = cycleLength(s);
  if (!starts.length || dateStr < starts[0]) return null;
  let a = starts[0]; starts.forEach(x => { if (x <= dateStr) a = x; });
  let day = daysBetween(parseISO(a), parseISO(dateStr)) + 1, predicted = false;
  if (dateStr > today && a === starts[starts.length - 1]) {
    const next = nextStart(s, today);
    if (dateStr >= next) { day = daysBetween(parseISO(next), parseISO(dateStr)) % len + 1; predicted = true; }
  }
  return { day, period: day <= 3, late: day > len - 7, predicted };
}

/* ============================ Readings and baselines ============================ */
// A day's readings: what the morning check-in holds, else the wearable's numbers (Apple Health or a WHOOP file).
export function readingsOf(entry) {
  const m = (entry && entry.morning) || {}, w = (entry && entry.wearable) || {};
  const pick = (a, b) => num(a) != null ? num(a) : num(b);
  return { sleep: pick(m.sleep, w.sleepHours), rhr: pick(m.rhr, w.rhr), hrv: pick(m.hrv, w.hrv), recovery: num(w.recovery), scale: num(m.scale), rise: num(m.rise) };
}
export function stepsOf(entry) { const w = entry && entry.wearable, e = entry && entry.evening; return num(w && w.steps) != null ? num(w.steps) : num(e && e.steps); }
export function baselineOf(days, dateStr, pick) {
  const vals = [];
  for (let i = 1; i <= BASELINE.days; i++) { const v = pick(days[shiftISO(dateStr, -i)]); if (v != null) vals.push(v); }
  return { value: vals.length >= BASELINE.min ? Math.round(median(vals)) : null, n: vals.length };
}
export function baselines(days, dateStr) {
  return { rhr: baselineOf(days, dateStr, e => readingsOf(e).rhr), hrv: baselineOf(days, dateStr, e => readingsOf(e).hrv), steps: baselineOf(days, dateStr, stepsOf) };
}

/* ============================ Morning check ============================ */
// Red lines are set against your own baseline: resting heart rate 4 above it, HRV 15 percent below it. Symptoms and
// the standing rise (POTS) have fixed lines. A short night means rest; a missing sleep reading does not.
export function gate(r, base, L, standing) {
  const red = [], amber = [];
  if (base.rhr.value != null && r.rhr != null && r.rhr >= base.rhr.value + L.rhrAbove) red.push(`resting heart rate ${r.rhr} is high for you`);
  if (base.hrv.value != null && r.hrv != null && r.hrv <= Math.round(base.hrv.value * (100 - L.hrvBelowPct) / 100)) red.push(`HRV ${r.hrv} is low for you`);
  if (r.scale != null && r.scale >= L.symptomRed) red.push(`symptoms ${r.scale} out of 10`);
  else if (r.scale != null && r.scale >= L.symptomAmber) amber.push(`symptoms ${r.scale} out of 10`);
  if (standing && r.rise != null) {
    if (r.rise >= L.riseRed) red.push(`standing rise of ${r.rise}`);
    else if (r.rise >= L.riseAmber) amber.push(`standing rise of ${r.rise}`);
  }
  const short = r.sleep != null && r.sleep < L.sleepMin;
  return { red, amber, short, good: !red.length && !amber.length && !short };
}
export function limitsOf(s) { return Object.assign({}, DEFAULT_LIMITS, s && s.plan && s.plan.limits); }
export function gateFor(days, dateStr, s) {
  return gate(readingsOf(days[dateStr]), baselines(days, dateStr), limitsOf(s), hasCondition(s, "pots"));
}

/* ============================ Flare ============================ */
// Two red mornings in a row start a flare, and so does a crash logged in the evening (from the next day). Two good
// mornings in a row end it. A day without a morning check-in breaks either run. Dates after today take today's
// state, plus a crash logged this evening. Looks back 60 days.
export function flareOn(days, dateStr, s, today) {
  const upto = dateStr < today ? dateStr : today;
  let active = false, start = null, reds = 0, goods = 0;
  for (let d = parseISO(shiftISO(upto, -60)), end = parseISO(upto); d <= end; d = addDays(d, 1)) {
    const k = iso(d), e = days[k], prev = days[shiftISO(k, -1)];
    if (prev && prev.evening && prev.evening.crash && !active) { active = true; start = k; goods = 0; }
    if (!e || !e.morning) { reds = 0; goods = 0; continue; }
    const g = gateFor(days, k, s);
    if (g.red.length) { reds++; goods = 0; if (!active && reds >= 2) { active = true; start = k; } }
    else if (g.good) { goods++; reds = 0; if (active && goods >= 2) { active = false; start = null; } }
    else { reds = 0; goods = 0; }
  }
  if (!active && dateStr > today && days[today] && days[today].evening && days[today].evening.crash) { active = true; start = shiftISO(today, 1); }
  return { active, start, length: active ? daysBetween(parseISO(start), parseISO(dateStr > today ? dateStr : upto)) + 1 : 0 };
}

/* ============================ The plan for a day ============================ */
export function plansOf(entry) {
  const p = (entry && entry.morning && entry.morning.plans) || {};
  const n = k => Math.max(0, Math.round(num(p[k]) || 0));
  return { chores: n("chores"), meetings: n("meetings"), events: n("events"), travel: n("travel") };
}
export function planLoad(plans) { return Object.keys(PLAN_STEPS).reduce((t, k) => t + PLAN_STEPS[k] * (plans[k] || 0), 0); }
// Step limits: the person's own numbers, else their usual steps (open day), three quarters of it on a session day
// and half on a rest day.
export function stepLimits(plan, base) {
  const st = (plan && plan.steps) || {}, open = num(st.open) != null ? num(st.open) : base.steps.value;
  const session = num(st.session) != null ? num(st.session) : (open != null ? round100(open * 0.75) : null);
  const rest = num(st.rest) != null ? num(st.rest) : (open != null ? round100(open * 0.5) : null);
  return { open, session, rest };
}
// Session length: a little longer each week since the plan started, not counting the week before a period.
export function sessionMinutes(plan, dateStr, s, today) {
  const S = plan.session;
  if (!num(S.addPerWeek) || !isDate(plan.start) || dateStr <= plan.start) return num(S.minutes) || 0;
  let n = 0;
  for (let d = parseISO(plan.start), end = parseISO(dateStr); d < end; d = addDays(d, 1)) { const c = cycleOf(iso(d), s, today); if (!(c && c.late)) n++; }
  return Math.min(num(S.maxMinutes) || num(S.minutes), num(S.minutes) + num(S.addPerWeek) * Math.floor(n / 7));
}
export function fmtBed(t) {
  if (!/^\d{1,2}:\d{2}$/.test(t || "")) return "";
  const [h, m] = t.split(":").map(Number);
  if (h === 0 && m === 0) return "midnight";
  return (h % 12 || 12) + (m ? ":" + String(m).padStart(2, "0") : "") + (h < 12 ? " am" : " pm");
}
const n0 = v => Math.round(v).toLocaleString("en-US");

// Everything the day asks for. With a check-in, the morning check can turn a day into rest or a light session, and
// plans can move a session off; without one, the week's plan. A flare replaces both.
export function planFor(dateStr, s, days, today) {
  const P = s.plan, T = TEMPLATES[P.template] || TEMPLATES.pacing, L = limitsOf(s);
  const afterTravel = plansOf(days[shiftISO(dateStr, -1)]).travel > 0;
  const kind = afterTravel ? "rest" : (P.week[DOW[parseISO(dateStr).getDay()]] || "open");
  const entry = days[dateStr] || {}, checkedIn = !!entry.morning;
  const base = baselines(days, dateStr), r = readingsOf(entry), steps = stepLimits(P, base);
  const plans = plansOf(entry), load = planLoad(plans);
  const busy = checkedIn && (plans.meetings + plans.events + plans.travel > 0 || (steps.open != null && load > steps.open / 2));
  const g = checkedIn ? gate(r, base, L, hasCondition(s, "pots")) : null;
  const fl = flareOn(days, dateStr, s, today);
  let type, why = [];
  if (fl.active) type = "flare";
  else if (!g) type = kind;
  else if (g.short) { type = "rest"; why = [`${r.sleep} hours of sleep`]; }
  else if (g.red.length) { type = "rest"; why = g.red; }
  else if (kind === "rest") type = "rest";
  else if (busy || kind === "open") type = "open";
  else if (g.amber.length) { type = "light"; why = g.amber; }
  else type = "session";

  const minutes = sessionMinutes(P, dateStr, s, today);
  const ceiling = type === "session" || type === "light" ? steps.session : (type === "open" ? steps.open : steps.rest);
  const label = { flare: "Flare", rest: g && g.short ? "Rest day, short night" : "Rest day", open: busy ? "Busy day" : "No session", light: "Light day", session: P.session.day || T.session.day }[type];
  const short = { flare: "Flare", rest: "Rest", open: busy ? "Busy" : "", light: "Light", session: P.session.short || T.session.short }[type];
  const tone = type === "session" ? "blue" : (type === "light" ? "plum" : (type === "rest" || type === "flare" ? "rest" : "free"));

  const lines = [];
  if (ceiling != null) lines.push(`Up to ${n0(ceiling)} steps` + (load ? `; your plans take about ${n0(load)}` : ""));
  if (type === "session") lines.push(`${P.session.title}, ${minutes} min`);
  if (type === "light") lines.push(`${P.session.title}, ${Math.max(5, Math.round(minutes / 2))} min, easy`);
  const cap = hrCap(s, base, today);
  if ((type === "session" || type === "light") && cap != null) lines.push(`Keep your heart rate under ${cap}`);
  if (fmtBed(P.bedtime)) lines.push(`In bed by ${fmtBed(P.bedtime)}`);
  if (P.note) lines.push(P.note);
  const notes = [];
  if (type === "flare") notes.push("Rest as much as you can. Your plan picks up after two good mornings.");
  else if (type === "rest" && g && g.short) notes.push("Lie down in the afternoon if you can.");
  else if (type === "rest" && g && g.red.length) notes.push("Check in again tomorrow morning.");
  else if (type === "rest" && afterTravel) notes.push("A rest day after yesterday's travel.");
  else if (type === "open" && busy && kind === "session") notes.push("Your plans take the place of today's session.");
  return { date: dateStr, type, kind, label, short, tone, why, lines, notes, ceiling, minutes, checkedIn, plans, load, base, flare: fl, cycle: cycleOf(dateStr, s, today), readings: r, gate: g };
}

/* ============================ Training a day held ============================ */
// From the evening check-in, and from workouts read from Apple Health or a WHOOP file. Walking and everyday activity
// don't count.
const SPORT_WORD = [[/swim/, "Pool"], [/(strength|weight|powerlifting|functional)/, "Lift"], [/(cycling|bike|biking)/, "Bike"], [/spin/, "Spin"],
  [/(running|run\b)/, "Run"], [/row/, "Row"], [/climb/, "Climb"], [/yoga/, "Yoga"], [/pilates/, "Pilates"], [/danc/, "Dance"],
  [/(soccer|football)/, "Soccer"], [/tennis/, "Tennis"], [/hik/, "Hike"], [/elliptical/, "Ellip"]];
export function sessionsDone(entry, plan) {
  const words = [], add = w => { if (w && !words.includes(w)) words.push(w); };
  const ev = (entry && entry.evening) || {};
  if (ev.session === "full") add((plan && plan.session && plan.session.short) || "Session");
  if (ev.session === "light") add("Light");
  ((entry && entry.wearable && entry.wearable.workouts) || []).forEach(w => {
    const t = String(w && w.name || "").toLowerCase(), hit = SPORT_WORD.find(([re]) => re.test(t));
    if (hit && !(num(w.strain) === 0)) add(hit[1]);
  });
  return words;
}

/* ============================ WHOOP data export ============================ */
// WHOOP's data export (requested in the WHOOP app) holds physiological_cycles.csv and workouts.csv. Columns are found
// by name, so small changes in WHOOP's headers still read.
export function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  const t = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ""));
}
function column(head, re) { return head.findIndex(h => re.test(h.toLowerCase())); }
const datePart = v => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || "").trim()); return m ? m[1] : null; };
export function whoopFileKind(text) {
  const head = (parseCSV(String(text).split(/\r?\n/).slice(0, 2).join("\n"))[0] || []).map(h => h.toLowerCase());
  if (head.some(h => /recovery score/.test(h))) return "cycles";
  if (head.some(h => /activity name/.test(h))) return "workouts";
  return null;
}
// Physiological cycles: one row per day, dated by the morning you woke (the wake onset), else the cycle's start.
export function parseWhoopCycles(text) {
  const rows = parseCSV(text); if (!rows.length) return {};
  const head = rows[0], col = re => column(head, re);
  const c = { start: col(/cycle start/), wake: col(/wake onset/), rec: col(/recovery score/), rhr: col(/resting heart rate/), hrv: col(/heart rate variability/),
    asleep: col(/asleep duration/), perf: col(/sleep performance/), strain: col(/day strain/), resp: col(/respiratory rate/), temp: col(/skin temp/),
    spo2: col(/blood oxygen/), steps: col(/steps/) };
  const out = {};
  for (const r of rows.slice(1)) {
    const date = datePart(r[c.wake]) || datePart(r[c.start]);
    if (!date) continue;
    const v = i => (i < 0 ? null : num(String(r[i] || "").replace("%", "").trim()));
    const day = { recovery: v(c.rec), rhr: v(c.rhr), hrv: v(c.hrv), sleepHours: v(c.asleep) != null ? Math.round(v(c.asleep) / 6) / 10 : null,
      sleepPct: v(c.perf), strain: v(c.strain), respRate: v(c.resp), skinTempC: v(c.temp), spo2: v(c.spo2), steps: v(c.steps) };
    Object.keys(day).forEach(k => { if (day[k] == null) delete day[k]; else if (k === "rhr" || k === "hrv" || k === "recovery" || k === "steps") day[k] = Math.round(day[k]); });
    if (Object.keys(day).length) out[date] = Object.assign(out[date] || {}, day);
  }
  return out;
}
export function parseWhoopWorkouts(text) {
  const rows = parseCSV(text); if (!rows.length) return {};
  const head = rows[0], col = re => column(head, re);
  const c = { start: col(/workout start/), name: col(/activity name/), strain: col(/activity strain/), mins: col(/duration/) };
  const out = {};
  for (const r of rows.slice(1)) {
    const date = datePart(r[c.start]);
    if (!date || c.name < 0) continue;
    const w = { name: String(r[c.name] || "").trim(), minutes: num(r[c.mins]), strain: num(r[c.strain]) };
    if (!w.name) continue;
    (out[date] = out[date] || []).push(w);
  }
  return out;
}

/* ============================ Calendar reminders ============================ */
// Two daily alarms as a calendar file, for phones where the app can't schedule its own reminders.
export function reminderICS(times, now = new Date(), url = "") {
  const pad = n => String(n).padStart(2, "0");
  const stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + "T" + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + "00Z";
  const first = addDays(now, 1), d = first.getFullYear() + pad(first.getMonth() + 1) + pad(first.getDate());
  const ev = (id, time, title) => {
    const [h, m] = (/^\d{1,2}:\d{2}$/.test(time || "") ? time : "10:00").split(":").map(Number);
    return ["BEGIN:VEVENT", `UID:pots-tracker-${id}@local`, `DTSTAMP:${stamp}`, `DTSTART:${d}T${pad(h)}${pad(m)}00`, "DURATION:PT5M", "RRULE:FREQ=DAILY",
      `SUMMARY:${title}`, url ? `URL:${url}` : null, "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${title}`, "TRIGGER:PT0M", "END:VALARM", "END:VEVENT"].filter(Boolean);
  };
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//POTS Tracker//EN", "CALSCALE:GREGORIAN",
    ...ev("morning", times.morning, "Morning check-in"), ...ev("evening", times.evening, "Evening check-in"), "END:VCALENDAR"].join("\r\n") + "\r\n";
}

/* ============================ Spreadsheet export ============================ */
export function exportCSV(days, s, today) {
  const keys = Object.keys(days).filter(isDate).sort();
  const sym = symptomKeys(s.conditions, Array.from(new Set(keys.flatMap(k => Object.keys(((days[k] || {}).evening || {}).symptoms || {})))));
  const head = ["Date", "Cycle day", "Sleep (h)", "Resting HR", "HRV (ms)", "Recovery %", "Steps", "Symptoms, morning (0-10)", "Standing rise",
    "Session", ...sym.map(k => SYMPTOMS[k] || k), "Migraine", "Rescue medication", "Crash", "Workouts", "Notes"];
  const cell = v => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const out = [head.map(cell).join(",")];
  for (const k of keys) {
    const e = days[k] || {}, r = readingsOf(e), ev = e.evening || {}, c = cycleOf(k, s, today), sy = ev.symptoms || {};
    const yn = v => v === true ? "yes" : (v === false ? "no" : "");
    out.push([k, c ? c.day : "", r.sleep, r.rhr, r.hrv, r.recovery, stepsOf(e), r.scale, r.rise, ev.session || "",
      ...sym.map(x => (Object.prototype.hasOwnProperty.call(sy, x) ? (sy[x] == null ? "yes" : sy[x]) : "")),
      yn(ev.migraine), yn(ev.rescue), yn(ev.crash), ((e.wearable && e.wearable.workouts) || []).map(w => w.name).join("; "), ev.notes || ""].map(cell).join(","));
  }
  return out.join("\r\n") + "\r\n";
}

/* ============================ Setup: answers into a plan ============================ */
const joinOr = a => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " or " + a[a.length - 1];
// The template's number of session and rest days, placed on the days the person is home: sessions spread out, rest
// after sessions when pacing, else at the weekend.
export function weekFor(template, outDays = []) {
  const T = TEMPLATES[template] || TEMPLATES.pacing;
  const nSession = WEEK.filter(d => T.week[d] === "session").length, nRest = WEEK.filter(d => T.week[d] === "rest").length;
  const home = WEEK.filter(d => !outDays.includes(d)), sessions = [];
  for (let i = 0; i < home.length && sessions.length < nSession; i += 2) sessions.push(home[i]);
  for (let i = 1; i < home.length && sessions.length < nSession; i += 2) sessions.push(home[i]);
  const left = home.filter(d => !sessions.includes(d));
  const afterSession = d => sessions.includes(WEEK[(WEEK.indexOf(d) + 6) % 7]);
  const rank = d => template === "pacing" ? (afterSession(d) ? 0 : (d === "sun" ? 1 : 2)) : (d === "sun" ? 0 : (d === "sat" ? 1 : 2));
  const rests = left.slice().sort((a, b) => rank(a) - rank(b) || WEEK.indexOf(a) - WEEK.indexOf(b)).slice(0, nRest);
  const week = {};
  WEEK.forEach(d => { week[d] = sessions.includes(d) ? "session" : (rests.includes(d) ? "rest" : "open"); });
  return week;
}
// The session in the person's own terms: the template's kind of activity, done with what they have.
export function sessionFor(template, exercise = [], goodDay = "") {
  const T = TEMPLATES[template] || TEMPLATES.pacing, S = Object.assign({}, T.session);
  const cardio = ["swim", "bike", "row", "cycle", "walk"].filter(k => exercise.includes(k));
  const seated = ["swim", "bike", "row"].filter(k => exercise.includes(k));
  if (template === "pots" && (seated.length || cardio.length)) S.title = "Lying or seated cardio: " + joinOr((seated.length ? seated : cardio).map(k => EXERCISE_WORD[k]));
  if (template === "pacing" && (exercise.includes("home") || exercise.includes("yoga"))) S.title = "Gentle movement, lying or seated: " + joinOr(["home", "yoga"].filter(k => exercise.includes(k)).map(k => EXERCISE_WORD[k]));
  if (template === "concussion" && cardio.length) S.title = "Easy " + joinOr(cardio.map(k => EXERCISE_WORD[k])) + ". Stop if symptoms rise by 2 or more";
  if (template === "migraine" && exercise.length) S.title = "Easy " + joinOr(exercise.map(k => EXERCISE_WORD[k]));
  const used = template === "pots" ? (seated.length ? seated : cardio) : cardio;
  if (template !== "pacing" && used.length && new Set(used.map(k => EXERCISE_SHORT[k])).size === 1) S.short = EXERCISE_SHORT[used[0]];
  const g = GOOD_DAY.find(x => x[0] === goodDay);
  if (g) S.minutes = template === "pacing" ? (goodDay === "lt10" ? 5 : 10) : Math.min(g[2], S.maxMinutes);
  S.maxMinutes = Math.max(S.minutes, S.maxMinutes);
  return S;
}
// Medians before and since the start of the illness or injury: up to 90 days before, everything after.
export function beforeAfter(days, onset) {
  if (!isDate(onset)) return null;
  const keys = Object.keys(days).filter(isDate), from = shiftISO(onset, -90), out = {};
  const pick = { rhr: e => readingsOf(e).rhr, hrv: e => readingsOf(e).hrv, sleep: e => readingsOf(e).sleep, steps: stepsOf };
  for (const [f, get] of Object.entries(pick)) {
    const before = keys.filter(k => k >= from && k < onset).map(k => get(days[k])).filter(v => v != null);
    const after = keys.filter(k => k >= onset).map(k => get(days[k])).filter(v => v != null);
    if (before.length >= 7 && after.length >= 7) out[f] = { before: median(before), after: median(after) };
  }
  return Object.keys(out).length ? out : null;
}
// The day resting heart rate rose most: compares the 28 days before and after each day (14 readings each side at
// least). A rise under 3 beats is not reported.
export function findShift(days) {
  const keys = Object.keys(days).filter(isDate).sort(), rhr = {};
  keys.forEach(k => { const v = readingsOf(days[k]).rhr; if (v != null) rhr[k] = v; });
  const dated = Object.keys(rhr);
  if (dated.length < 28) return null;
  let best = null;
  for (let d = parseISO(dated[0]), end = parseISO(dated[dated.length - 1]); d <= end; d = addDays(d, 1)) {
    const k = iso(d), before = [], after = [];
    for (let i = 1; i <= 28; i++) { const b = rhr[shiftISO(k, -i)], a = rhr[shiftISO(k, i - 1)]; if (b != null) before.push(b); if (a != null) after.push(a); }
    if (before.length < 14 || after.length < 14) continue;
    // Averages peak exactly at the change; medians would tie for two weeks either side of it.
    const mean = x => x.reduce((t, v) => t + v, 0) / x.length, delta = Math.round((mean(after) - mean(before)) * 10) / 10;
    if (!best || delta > best.delta) best = { date: k, before: median(before), after: median(after), delta };
  }
  return best && best.delta >= 3 ? best : null;
}
// Everything setup asked, as settings: the plan, the week, the session, the symptoms to ask about, the cycle.
export function settingsFromAnswers(a, today) {
  const conditions = (a.conditions || []).filter(c => CONDITIONS.some(x => x[0] === c));
  const pem = a.pem || "unsure", template = pickTemplate(conditions, pem);
  const plan = newPlan(template, today);
  plan.week = weekFor(template, a.outDays || []);
  plan.session = sessionFor(template, a.exercise || [], a.goodDay || "");
  const track = asksCycle(a) && a.cycle === "yes", age = num(a.age);
  return Object.assign({}, DEFAULT_SETTINGS, {
    onboarded: true, conditions, pem, plan,
    cycle: { track, starts: track && isDate(a.lastPeriod) ? [a.lastPeriod] : [], length: 28 },
    onset: isDate(a.onset) ? a.onset : "", tracker: a.tracker || "", symptoms: (a.symptoms || []).filter(k => SYMPTOMS[k]),
    exercise: a.exercise || [], goodDay: a.goodDay || "", outDays: a.outDays || [],
    context: { symptoms: (a.symptomNote || "").trim(), other: (a.other || "").trim() },
    age: age != null && age >= 10 && age <= 110 ? Math.round(age) : null, ageAsOf: today, sex: SEXES.some(x => x[0] === a.sex) ? a.sex : ""
  });
}
