// POTS Tracker screens. Data lives only on this device (localStorage); nothing is sent anywhere.
// The iPhone app adds Apple Health and scheduled reminders through Capacitor plugins; the web version does without.
import * as C from "./core.js";
const { SYMPTOMS, CONDITIONS, TEMPLATES, WEEK, PLAN_LABEL, todayISO, shiftISO, parseISO, iso, addDays, logDayISO, mondayOf, num, isDate } = C;

/* ============================ The iPhone layer, when present ============================ */
const cap = window.Capacitor, NATIVE = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
// Plugins without a JavaScript package here are reached by name through Capacitor's bridge.
const plugin = name => {
  if (!NATIVE) return null;
  try { return (cap.Plugins && cap.Plugins[name]) || (cap.registerPlugin ? cap.registerPlugin(name) : null); } catch (e) { return null; }
};
const Health = plugin("HealthData"), Notes = plugin("LocalNotifications"), Files = plugin("Filesystem"), Share = plugin("Share");

/* ============================ Storage: this device only ============================ */
const KEY = { settings: "pt.settings", days: "pt.days", notNow: "pt.notNow" };
function normalize(s) {
  const out = Object.assign({}, C.DEFAULT_SETTINGS, s && typeof s === "object" ? s : {});
  out.conditions = Array.isArray(out.conditions) ? out.conditions.filter(c => CONDITIONS.some(x => x[0] === c)) : [];
  out.cycle = Object.assign({}, C.DEFAULT_SETTINGS.cycle, out.cycle);
  out.reminders = Object.assign({}, C.DEFAULT_SETTINGS.reminders, out.reminders);
  if (out.onboarded && !out.plan) out.plan = C.newPlan(C.pickTemplate(out.conditions, out.pem), todayISO());
  if (out.plan) {
    const fresh = C.newPlan(out.plan.template, out.plan.start || todayISO());
    out.plan = Object.assign(fresh, out.plan, { week: Object.assign(fresh.week, out.plan.week), session: Object.assign(fresh.session, out.plan.session),
      floor: Object.assign(fresh.floor, out.plan.floor), steps: Object.assign(fresh.steps, out.plan.steps), limits: Object.assign(fresh.limits, out.plan.limits) });
  }
  return out;
}
const store = {
  settings: normalize(null), days: {}, ok: true,
  load() {
    try {
      this.settings = normalize(JSON.parse(localStorage.getItem(KEY.settings) || "null"));
      const d = JSON.parse(localStorage.getItem(KEY.days) || "{}");
      this.days = d && typeof d === "object" && !Array.isArray(d) ? d : {};
    } catch (e) { this.ok = false; }
  },
  write() {
    try { localStorage.setItem(KEY.settings, JSON.stringify(this.settings)); localStorage.setItem(KEY.days, JSON.stringify(this.days)); this.ok = true; }
    catch (e) { this.ok = false; }
    // Ask the browser to keep this data rather than clear it when space runs low.
    if (navigator.storage && navigator.storage.persist && !this.asked) { this.asked = true; navigator.storage.persist().catch(() => {}); }
  },
  saveSettings(s) { this.settings = normalize(s); this.write(); },
  saveDay(date, patch) { this.days[date] = Object.assign({}, this.days[date], patch); this.write(); },
  // Numbers from Apple Health or a WHOOP file go under `wearable`; the check-ins are never touched.
  mergeWearable(byDate, source) {
    let n = 0;
    for (const [d, w] of Object.entries(byDate || {})) {
      if (!isDate(d) || !w || typeof w !== "object") continue;
      const cur = (this.days[d] || {}).wearable || {};
      this.days[d] = Object.assign({}, this.days[d], { wearable: Object.assign({}, cur, w, { source }) });
      n++;
    }
    if (n) this.write();
    return n;
  },
  replaceAll(data) { this.settings = normalize(data.settings); this.days = data.days || {}; this.write(); },
  clear() { try { Object.values(KEY).forEach(k => localStorage.removeItem(k)); } catch (e) {} this.settings = normalize(null); this.days = {}; }
};

/* ============================ Helpers ============================ */
const ui = { view: "today", calMonth: null, selected: null, dirty: false, checkinDay: null };
const $ = id => document.getElementById(id);
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2000); }
const n0 = v => Math.round(v).toLocaleString();
function fmtLong(d) { return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }); }
function fmtShort(d) { return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }); }
function dayName(k) { return parseISO(k).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }); }
function capFirst(s) { return s ? s[0].toUpperCase() + s.slice(1) : ""; }
const S = () => store.settings;
const plan = (k, today = todayISO()) => C.planFor(k, S(), store.days, today);
const seg = (cur, v, label) => `<button data-v="${esc(v)}" class="${cur === v ? "on" : ""}">${esc(label)}</button>`;
const segVal = id => { const b = document.querySelector(`#${id} button.on`); return b ? b.dataset.v : null; };

/* ============================ Setup: a few screens, then a questionnaire ============================ */
const OB_STEPS = ["hello", "why", "conditions", "intro", "about", "tracker", "onset", "symptoms", "exercise", "energy", "week", "bed", "cycle", "other", "plan"];
const QUESTIONS = ["about", "tracker", "onset", "symptoms", "exercise", "energy", "week", "bed", "cycle", "other"];
const blankAnswers = () => ({ conditions: [], age: "", sex: "", tracker: "", onset: "", symptoms: [], symptomNote: "", exercise: [], pem: "", goodDay: "", outDays: [], bedtime: "", cycle: "", lastPeriod: "", other: "" });
const ob = { step: 0, a: blankAnswers(), health: false };
const HEART = `<svg class="ob-heart" viewBox="0 0 130 100" aria-hidden="true">
  <g class="speed"><path d="M6 40h20"/><path d="M0 54h24"/><path d="M8 68h16"/></g>
  <g class="bob"><path class="h" d="M72 90C40 67 33 52 33 38c0-11 9-19 19-19 8 0 15 5 20 12 5-7 12-12 20-12 10 0 19 8 19 19 0 14-7 29-39 52z"/>
  <circle cx="60" cy="42" r="3.6" fill="#fff"/><circle cx="84" cy="42" r="3.6" fill="#fff"/><ellipse cx="72" cy="57" rx="4.2" ry="5.4" fill="#fff"/>
  <path class="drop" d="M112 16c4 6 4 9 0 11-4-2-4-5 0-11z"/></g></svg>`;
// The first screen quotes a published source word for word, so the explanation isn't ours. Keep it a quotation.
const SOURCE = {
  text: "POTS is a complex, multi-system, chronic disorder of the autonomic nervous system characterized by orthostatic intolerance with excessive heart rate (HR) increase and symptoms on standing while blood pressure is maintained. The onset of POTS may be precipitated by a typical immunological stressor such as viral syndrome (often upper respiratory or gastrointestinal), physical trauma (such as concussion), menarche, pregnancy, or surgery.",
  name: "Vernino and others, Autonomic Neuroscience, 2021",
  url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8455420/"
};
function obChips(id, options, chosen, one) {
  return `<div class="chips big${one ? " one" : ""}" id="${id}">${options.map(([v, l]) => `<button data-v="${esc(v)}" class="${chosen.includes(v) ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`;
}
function historyLine() {
  const keys = Object.keys(store.days).filter(k => store.days[k].wearable).sort();
  return keys.length ? `<p class="small ob-found"><b>${n0(keys.length)} days</b> of history, from ${esc(fmtShort(parseISO(keys[0])))} ${parseISO(keys[0]).getFullYear()}.</p>` : "";
}
function connectBlock() {
  const t = ob.a.tracker, whoopFile = `<p class="small">WHOOP's recovery scores come from its data export: request it in the WHOOP app, unzip the file WHOOP sends, and choose physiological_cycles.csv and workouts.csv.</p><label class="btn block" for="ob-whoop">Import WHOOP files</label><input type="file" id="ob-whoop" accept=".csv,text/csv" multiple hidden>`;
  let out = "";
  if ((t === "apple" || t === "whoop") && Health) out = `<button class="btn primary block" data-act="ob-health">${ob.health ? "Read Apple Health again" : "Connect Apple Health"}</button>` + (t === "whoop" ? `<p class="small muted" style="margin-top:8px">Turn on Apple Health sync in the WHOOP app first.</p>` + whoopFile : "");
  else if (t === "apple") out = `<p class="small">Apple Watch data comes in through the POTS Tracker iPhone app. Here, type your numbers in the morning check-in.</p>`;
  else if (t === "whoop") out = whoopFile;
  else if (t) out = `<p class="small">No problem. Type what you know in the morning check-in, or skip it.</p>`;
  return out + historyLine();
}
function onsetExtras() {
  const shift = C.findShift(store.days), ba = C.beforeAfter(store.days, ob.a.onset);
  let out = "";
  if (shift && shift.date !== ob.a.onset) out += `<p class="small ob-hint">Your resting heart rate rose by about ${Math.round(shift.delta)} around ${esc(fmtLong(parseISO(shift.date)))}, ${parseISO(shift.date).getFullYear()}. <button class="btn quiet inline" data-act="ob-use-shift" data-v="${shift.date}">Use that date</button></p>`;
  if (ba) {
    const part = (f, label, unit = "") => ba[f] ? `${label} ${Math.round(ba[f].before * 10) / 10}${unit} before, ${Math.round(ba[f].after * 10) / 10}${unit} since` : "";
    const parts = [part("rhr", "resting heart rate"), part("hrv", "HRV"), part("sleep", "sleep", " h")].filter(Boolean);
    if (parts.length) out += `<p class="small ob-found">${esc(capFirst(parts.join("; ")))}.</p>`;
  }
  return out;
}
function obScreen(name) {
  const a = ob.a, t = todayISO();
  switch (name) {
    case "hello": return `<div class="ob-art">${HEART}</div><h1 class="ob-h">So you have <span class="squiggle">POTS</span>.</h1>
      <blockquote class="ob-p ob-quote" cite="${SOURCE.url}">${SOURCE.text}</blockquote>
      <p class="ob-src">From the 2019 NIH expert consensus: <a href="${SOURCE.url}" target="_blank" rel="noopener">${SOURCE.name}</a></p>`;
    case "why": return `<h1 class="ob-h2">This app helps you manage your symptoms while maximising your ability to live a <span class="squiggle">flourishing</span> life.</h1><p class="ob-p">Everything you enter stays on this phone.</p>`;
    case "conditions": return `<h1 class="ob-h2">What are you managing?</h1><p class="ob-p">Tap all that apply.</p>${obChips("ob-cond", CONDITIONS, a.conditions)}`;
    case "intro": return `<h1 class="ob-h2">When you're ready, tell us about your symptoms.</h1><p class="ob-p">The more context you share, the better the plan. You can skip any question.</p>`;
    case "about": return `<h1 class="ob-h2">A little about you</h1>
      <label class="f" for="ob-age">Age</label><input type="number" id="ob-age" inputmode="numeric" min="10" max="110" value="${esc(a.age)}">
      <label class="f">Sex at birth</label>${obChips("ob-sex", C.SEXES, [a.sex], true)}
      <p class="small muted">Age sets your heart-rate guide. Sex decides whether we ask about periods.</p>`;
    case "tracker": return `<h1 class="ob-h2">Do you wear a health tracker?</h1><p class="ob-p">Your history shows where your numbers usually sit, and how they changed.</p>
      ${obChips("ob-tracker", [["apple", "Apple Watch"], ["whoop", "WHOOP"], ["other", "Another tracker"], ["none", "None"]], [a.tracker], true)}<div id="ob-connect">${connectBlock()}</div>`;
    case "onset": return `<h1 class="ob-h2">When did it start?</h1><p class="ob-p">The illness or injury that set this off. Roughly is fine.</p>
      <input type="date" id="ob-onset" value="${esc(a.onset)}" max="${t}"><div id="ob-onset-more">${onsetExtras()}</div>`;
    case "symptoms": {
      const first = C.symptomKeys(a.conditions), all = first.concat(Object.keys(SYMPTOMS).filter(k => !first.includes(k)));
      return `<h1 class="ob-h2">What have you been feeling since?</h1><p class="ob-p">Tap all that apply. These become your evening check-in.</p>
        ${obChips("ob-sym", all.map(k => [k, SYMPTOMS[k]]), a.symptoms)}
        <label class="f" for="ob-sym-note">Anything particularly important?</label><textarea id="ob-sym-note" placeholder="Optional">${esc(a.symptomNote)}</textarea>`;
    }
    case "exercise": return `<h1 class="ob-h2">What could you do at least once a week?</h1><p class="ob-p">Pick anything you have access to. Easy, lying or seated versions count.</p>${obChips("ob-ex", C.EXERCISES, a.exercise)}`;
    case "energy": return `<h1 class="ob-h2">Your energy</h1>
      <label class="f">Do your symptoms get worse a day or two after doing too much?</label><div class="seg" id="ob-pem">${seg(a.pem, "yes", "Yes")}${seg(a.pem, "no", "No")}${seg(a.pem, "unsure", "Not sure")}</div>
      <label class="f">On a good day, how long can you stay active before symptoms build?</label>${obChips("ob-good", C.GOOD_DAY.map(g => [g[0], g[1]]), [a.goodDay], true)}`;
    case "week": return `<h1 class="ob-h2">Which days are you out for work, study or other commitments?</h1><p class="ob-p">Sessions go on the other days.</p>${obChips("ob-out", WEEK.map(d => [d, capFirst(d)]), a.outDays)}`;
    case "bed": return `<h1 class="ob-h2">What time do you want to be in bed?</h1><p class="ob-p">It goes on your plan each day.</p><input type="time" id="ob-bed" value="${esc(a.bedtime)}">`;
    case "cycle": return `<h1 class="ob-h2">Do your symptoms change with your cycle?</h1>${obChips("ob-cycle", [["no", "No"], ["yes", "Yes"], ["na", "Doesn't apply"]], [a.cycle], true)}
      <div id="ob-cycle-more"${a.cycle === "yes" ? "" : " hidden"}><label class="f" for="ob-period">When did your last period start?</label><input type="date" id="ob-period" value="${esc(a.lastPeriod)}" max="${t}">${Health ? `<p class="small muted">Periods you log in Apple Health fill in by themselves.</p>` : ""}</div>`;
    case "other": return `<h1 class="ob-h2">Anything else we should know?</h1><p class="ob-p">Treatments, triggers, what a good day looks like. It stays on this phone.</p><textarea id="ob-other" rows="5">${esc(a.other)}</textarea>`;
    case "plan": {
      const s = C.settingsFromAnswers(a, t), P = s.plan, T = TEMPLATES[P.template], base = C.baselines(store.days, t), steps = C.stepLimits(P, base), ba = C.beforeAfter(store.days, s.onset);
      const and = list => list.join(", ").replace(/, ([^,]*)$/, " and $1"), lines = [];
      const sessionDays = WEEK.filter(d => ["session", "both"].includes(P.week[d])).map(capFirst), floorDays = WEEK.filter(d => ["floor", "both"].includes(P.week[d])).map(capFirst);
      lines.push(`<b>${esc(T.label)}.</b> ${esc(T.about)}`);
      if (sessionDays.length) lines.push(`${esc(P.session.title)}, ${P.session.minutes} min, on ${esc(and(sessionDays))}.` + (num(P.session.addPerWeek) ? ` A little longer each week, up to ${P.session.maxMinutes}.` : ""));
      if (floorDays.length) lines.push(`${esc(P.floor.title)}, ${P.floor.minutes} min, on ${esc(and(floorDays))}.`);
      if (steps.open != null) lines.push(`Up to about ${n0(steps.open)} steps on days without a session, from your own usual.`);
      if (ba && ba.rhr) lines.push(`Since ${esc(fmtShort(parseISO(s.onset)))}: resting heart rate ${Math.round(ba.rhr.after)}, against ${Math.round(ba.rhr.before)} before` + (ba.hrv ? `; HRV ${Math.round(ba.hrv.after)}, against ${Math.round(ba.hrv.before)}.` : "."));
      if (s.symptoms.length) lines.push(`Your evening check-in asks about ${esc(s.symptoms.map(k => SYMPTOMS[k].toLowerCase()).join(", ").replace(/, ([^,]*)$/, " and $1"))}.`);
      if (C.fmtBed(P.bedtime)) lines.push(`In bed by ${esc(C.fmtBed(P.bedtime))}.`);
      if (s.cycle.track) lines.push(num(P.session.addPerWeek) ? "Sessions get longer only from day 4 to mid-cycle." + (T.luteal ? " In the 9 days before a period, sessions and steps run at 80 percent." : "") : (T.luteal ? "In the 9 days before a period, sessions and steps run at 80 percent." : "Your cycle shows in the calendar."));
      return `<div class="ob-art small">${HEART}</div><h1 class="ob-h2">Here's your plan.</h1><ul class="clean lines ob-plan">${lines.map(l => `<li>${l}</li>`).join("")}</ul><p class="ob-p">You can change any of it in Settings.</p>`;
    }
  }
  return "";
}
function obCollect() {
  const a = ob.a, name = OB_STEPS[ob.step], on = id => Array.from(document.querySelectorAll(`#${id} button.on`)).map(x => x.dataset.v), v = id => ($(id) || {}).value || "";
  if (name === "conditions") a.conditions = on("ob-cond");
  if (name === "about") { const g = num(v("ob-age")); a.age = g != null && g >= 10 && g <= 110 ? Math.round(g) : ""; a.sex = on("ob-sex")[0] || ""; }
  if (name === "tracker") a.tracker = on("ob-tracker")[0] || "";
  if (name === "onset") a.onset = isDate(v("ob-onset")) ? v("ob-onset") : "";
  if (name === "symptoms") { a.symptoms = on("ob-sym"); a.symptomNote = v("ob-sym-note"); }
  if (name === "exercise") a.exercise = on("ob-ex");
  if (name === "energy") { a.pem = segVal("ob-pem") || ""; a.goodDay = on("ob-good")[0] || ""; }
  if (name === "week") a.outDays = on("ob-out");
  if (name === "bed") a.bedtime = /^\d{1,2}:\d{2}$/.test(v("ob-bed")) ? v("ob-bed") : "";
  if (name === "cycle") { a.cycle = on("ob-cycle")[0] || ""; a.lastPeriod = isDate(v("ob-period")) ? v("ob-period") : ""; }
  if (name === "other") a.other = v("ob-other");
}
function viewSetup() {
  const name = OB_STEPS[ob.step], last = ob.step === OB_STEPS.length - 1, q = QUESTIONS.includes(name);
  const next = name === "intro" ? "Let's go" : (last ? "Start" : "Next");
  const back = ob.step ? `<button class="btn quiet" data-act="ob-back">‹ Back</button>` : `<span></span>`;
  return `<div class="ob ob-${name}"><div class="ob-top">${back}<div class="ob-bar"><i style="width:${Math.round(100 * (ob.step + 1) / OB_STEPS.length)}%"></i></div></div>
    <div class="ob-body">${obScreen(name)}</div>
    <div class="ob-actions"><button class="btn primary block" data-act="${last ? "ob-start" : "ob-next"}">${next}</button>${q ? `<button class="btn quiet block" data-act="ob-next">Skip</button>` : ""}</div></div>`;
}

/* ============================ Today ============================ */
function linesHTML(p, withNotes) {
  return `<ul class="clean lines">${p.lines.concat(withNotes ? p.notes : []).map(l => `<li>${esc(l)}</li>`).join("")}</ul>`;
}
function outBlock(p) {
  const why = p.why.length && (p.type === "rest" || p.type === "light") ? `<p class="why">Why: ${esc(p.why.join(", "))}.</p>` : "";
  const how = p.training.length ? `<details class="how"><summary>How to do the session</summary>${p.training.map(x => `<p><b>${esc(x.title)}</b></p><ul class="clean small">${x.how.map(l => `<li>${esc(l)}</li>`).join("")}</ul>`).join("")}</details>` : "";
  return `<div class="daytype tone-${p.tone}">${esc(p.label)}</div>${why}${linesHTML(p, true)}${how}`;
}
function flareBanner(p) {
  if (p.type !== "flare") return "";
  return `<div class="banner red"><b>Flare, day ${p.flare.length}.</b> It ends after two mornings in a row back at your normal.</div>`;
}
function resumeBanner(p) {
  if (!p.resume.steps && !p.resume.volume) return "";
  const end = parseISO(p.flare.endedOn), parts = [];
  if (p.resume.steps && p.ceiling != null) parts.push(`steps stay 1,000 lower until ${fmtShort(addDays(end, 2))}`);
  if (p.resume.volume && num(S().plan.session.addPerWeek)) parts.push(`sessions are a week back until ${fmtShort(addDays(end, 6))}`);
  return parts.length ? `<div class="banner info">The flare is over. ${esc(capFirst(parts.join(", and ")))}.</div>` : "";
}
function baselineLine(p) {
  const n = p.base.rhr.n;
  return n > 0 && p.base.rhr.value == null ? `<p class="small muted">Your heart-rate limits start after ${C.BASELINE.min} mornings of readings (${n} so far).</p>` : "";
}
function viewToday() {
  const t = todayISO(), entry = store.days[t] || {}, p = plan(t);
  const head = entry.morning ? "Today" : "Today, as planned";
  return flareBanner(p) + resumeBanner(p) + `<div class="card ${entry.morning || p.type === "flare" ? "tint-" + p.tone : ""}"><h2>${head}</h2>${outBlock(p)}${baselineLine(p)}</div>`
    + weekCard() + `<div class="actions"><button class="btn quiet" data-act="go-checkin">Edit today's check-in</button></div>`;
}

/* ============================ Calendar marks ============================ */
function planWords(p) { return p.words; }
// The main session is blue; floor sets, light sessions and other exercise violet; rest and flares grey; busy plain.
function wordTone(w) {
  if (w === "Rest" || w === "Flare") return "rest";
  if (w === "Busy") return "free";
  return w === (S().plan.session.short || "Session") ? "blue" : "plum";
}
// Today and later: the plan. Earlier: what the day held (sessions, workouts, a migraine), else the rest, flare or busy
// day its morning called. A day with no session and no plans stays blank.
function dayMark(k, p) {
  let words;
  if (k >= todayISO()) words = planWords(p);
  else {
    const e = store.days[k] || {};
    words = C.sessionsDone(e, S().plan);
    if (!words.length && (p.checkedIn || p.type === "flare") && ["Rest", "Flare", "Busy"].includes(p.short)) words = [p.short];
  }
  // A migraine day is a dot in the corner, so it doesn't crowd out what the day held.
  const mig = k <= todayISO() && !!((store.days[k] || {}).evening || {}).migraine;
  words = words.slice(0, 2);
  const tone = words.length ? wordTone(words[0]) : "";
  return { cls: tone && tone !== "free" ? "bg-" + tone : "", html: words.map(w => `<span class="w tone-${wordTone(w)}${w.length > 5 ? " long" : ""}">${esc(w)}</span>`).join("") + (mig ? `<span class="mig" title="Migraine"></span>` : "") };
}
function phaseBar(c) { return !c ? "" : (c.period ? "period" : (c.phase === "follicular" ? "" : c.phase)); }
function weekCard() {
  const t = todayISO(), mon = mondayOf(parseISO(t));
  let cells = "";
  for (let i = 0; i < 7; i++) {
    const k = iso(addDays(mon, i)), p = plan(k, t), mk = dayMark(k, p);
    cells += `<div class="wk ${k === t ? "today" : ""} ${mk.cls}"><div class="dn">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]}</div><div class="dd num">${parseISO(k).getDate()}</div>${mk.html}<span class="ph ${phaseBar(p.cycle)}"></span></div>`;
  }
  return `<div class="card"><h2>This week</h2><div class="week">${cells}</div></div>`;
}

/* ============================ Check-ins ============================ */
const NOT_NOW = KEY.notNow;
function dueCheckin(now = new Date()) {
  if (!S().onboarded) return null;
  const h = now.getHours(), day = logDayISO(now), e = store.days[day] || {};
  const due = h >= 22 || h < 4 ? (e.evening ? null : "evening") : (e.morning ? null : "morning");
  let skipped = null; try { skipped = localStorage.getItem(NOT_NOW); } catch (x) {}
  return due && skipped === day + ":" + due ? null : due;
}
function checkinDay() { return ui.checkinDay || logDayISO(); }
function openCheckin(mode) {
  if (!["morning", "evening"].includes(mode) || (ui.dirty && ui.view === mode)) return;
  ui.view = mode; ui.checkinDay = null; ui.dirty = false; render(); window.scrollTo(0, 0);
}
function viewCheckin(mode) {
  if (!ui.checkinDay) ui.checkinDay = logDayISO();
  const later = `<div class="actions"><button class="btn quiet" data-act="go-today">${mode === "checkin" ? "Done" : "Not now"}</button></div>`;
  if (mode === "morning") return `<div class="card"><h2>Good morning</h2>${morningForm()}</div>${later}`;
  if (mode === "evening") return `<div class="card"><h2>Good evening</h2>${eveningForm()}</div>${later}`;
  return `<div class="card"><h2>Morning</h2>${morningForm()}</div><div class="card"><h2>Evening</h2>${eveningForm()}</div>${later}`;
}
const VITALS = [["sleep", "m-sleep", "Sleep (hours)", "decimal", "0.1", "sleepHours"], ["rhr", "m-rhr", "Resting heart rate", "numeric", "1", "rhr"], ["hrv", "m-hrv", "HRV, if you have it", "numeric", "1", "hrv"]];
function recoveryTone(v) { return v >= 67 ? "green" : (v >= 34 ? "amber" : "red"); }
function vitalsBlock(t) {
  const e = store.days[t] || {}, m = e.morning || {}, w = e.wearable || {};
  const fromW = VITALS.filter(f => (m[f[0]] == null || m[f[0]] === "") && num(w[f[5]]) != null);
  const input = f => `<div><label class="f" for="${f[1]}">${f[2]}</label><input type="number" id="${f[1]}" inputmode="${f[3]}" step="${f[4]}" value="${esc(m[f[0]] != null ? m[f[0]] : (num(w[f[5]]) != null ? w[f[5]] : ""))}"></div>`;
  let tiles = "";
  if (fromW.length || num(w.recovery) != null) {
    const parts = [];
    if (num(w.recovery) != null) {
      const v = Math.max(0, Math.min(100, num(w.recovery))), c = 2 * Math.PI * 16;
      parts.push(`<div class="vt"><svg class="vring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16" class="track"/><circle cx="20" cy="20" r="16" class="arc" style="stroke:var(--${recoveryTone(v)})" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}"/></svg><div class="vn ring-n num">${esc(w.recovery)}%</div><div class="vl">Recovery</div></div>`);
    }
    fromW.forEach(f => parts.push(`<div class="vt"><div class="vn num">${esc(w[f[5]])}${f[0] === "sleep" ? "<small> h</small>" : ""}</div><div class="vl">${{ sleep: "Sleep", rhr: "Resting HR", hrv: "HRV" }[f[0]]}</div></div>`));
    const src = w.source === "health" ? "Apple Health" : (w.source === "whoop" ? "your WHOOP file" : "your wearable");
    tiles = `<div class="vitals">${parts.join("")}</div><p class="small muted whoop">From ${src}. <button class="btn quiet inline" data-act="edit-vitals">Change</button></p><div id="m-vitals-more" class="form-grid three" hidden>${fromW.map(input).join("")}</div>`;
  }
  const ask = VITALS.filter(f => !fromW.includes(f));
  return tiles + (ask.length ? `<div class="form-grid three">${ask.map(input).join("")}</div>` : "");
}
function riseOf(m, rhr) {
  const hr = Math.max(num(m.hr1) || 0, num(m.hr3) || 0), base = num(m.hr0) != null ? num(m.hr0) : rhr;
  return hr && base != null ? hr - base : null;
}
function morningForm() {
  const t = checkinDay(), e = store.days[t] || {}, m = e.morning || {}, plans = C.plansOf(e);
  const scale = num(m.scale) != null ? num(m.scale) : 0;
  const counters = Object.keys(PLAN_LABEL).map(k => `<button data-k="${k}" data-n="${plans[k]}" class="${plans[k] ? "on" : ""}"><span>${PLAN_LABEL[k]}</span><span class="n num">${plans[k]}</span></button>`).join("");
  const stand = C.hasCondition(S(), "pots") ? `<label class="f">Standing test: lie down for 5 minutes, then stand still for 3. Your heart rate:</label>
    <div class="form-grid three keep">
      <div><label class="f" for="m-hr0">Lying</label><input type="number" id="m-hr0" inputmode="numeric" value="${esc(m.hr0)}"></div>
      <div><label class="f" for="m-hr1">At 1 minute</label><input type="number" id="m-hr1" inputmode="numeric" value="${esc(m.hr1)}"></div>
      <div><label class="f" for="m-hr3">At 3 minutes</label><input type="number" id="m-hr3" inputmode="numeric" value="${esc(m.hr3)}"></div>
    </div><p class="small" id="m-rise">${m.rise != null ? "Rise: " + esc(m.rise) : ""}</p>` : "";
  return `<div id="m-form"><div id="m-vitals">${vitalsBlock(t)}</div>
    <label class="f" for="m-scale">${esc((TEMPLATES[S().plan.template] || {}).morning || "Symptoms right now")}: <b id="m-scale-v" class="num">${scale}</b> out of 10</label>
    <input type="range" id="m-scale" min="0" max="10" value="${scale}">
    ${stand}
    <label class="f">What's on today? Tap once for each.</label>
    <div class="counters" id="m-plans">${counters}</div>
    <button class="btn quiet inline" data-act="plans-clear">Clear</button>
    <div style="margin-top:14px"><button class="btn primary block" data-act="save-morning">Save morning</button></div></div>`;
}
function formMorning() {
  const v = id => { const el = $(id); return el ? num(el.value) : null; };
  const m = { sleep: v("m-sleep"), rhr: v("m-rhr"), hrv: v("m-hrv"), scale: v("m-scale"), hr0: v("m-hr0"), hr1: v("m-hr1"), hr3: v("m-hr3"), plans: {} };
  document.querySelectorAll("#m-plans button").forEach(b => { m.plans[b.dataset.k] = Number(b.dataset.n) || 0; });
  const w = (store.days[checkinDay()] || {}).wearable || {};
  m.rise = riseOf(m, m.rhr != null ? m.rhr : num(w.rhr));
  // Numbers left as the wearable gave them are not copied into the check-in, so the source stays clear.
  [["sleep", "sleepHours"], ["rhr", "rhr"], ["hrv", "hrv"]].forEach(([k, wk]) => { if (m[k] != null && num(w[wk]) === m[k]) m[k] = null; });
  Object.keys(m).forEach(k => { if (m[k] == null) delete m[k]; });
  return m;
}
function updateRise() { const el = $("m-rise"); if (el) { const m = formMorning(); el.textContent = m.rise != null ? "Rise: " + m.rise : ""; } }

const EVENTS = ["Long time standing", "Office", "Event", "Travel", "Heat", "Late night", "Alcohol", "Illness"];
function eveningForm() {
  const t = checkinDay(), e = (store.days[t] || {}).evening || {}, wSteps = num(((store.days[t] || {}).wearable || {}).steps);
  const sym = e.symptoms || {}, had = k => Object.prototype.hasOwnProperty.call(sym, k);
  const keys = C.symptomKeys(S().conditions, Object.keys(sym), S().symptoms);
  const chips = keys.map(k => `<button data-k="${k}" class="${had(k) ? "on" : ""}">${esc(SYMPTOMS[k] || k)}</button>`).join("");
  const boxes = keys.map(k => `<div data-k="${k}"${had(k) ? "" : " hidden"}><label class="f" for="e-s-${k}">${esc(SYMPTOMS[k] || k)}, 0 to 10</label><input type="number" min="0" max="10" inputmode="numeric" id="e-s-${k}" value="${esc(sym[k] != null ? sym[k] : "")}"></div>`).join("");
  const yn = (id, label, v) => `<label class="f">${label}</label><div class="seg" id="${id}">${seg(v === true ? "yes" : "no", "no", "No")}${seg(v === true ? "yes" : "no", "yes", "Yes")}</div>`;
  const week = Object.values(S().plan.week), hasSessions = week.some(k => ["session", "both", "floor"].includes(k)), cur = e.session || "none";
  const sessionSeg = C.usesFloor(S().plan) ? seg(cur, "none", "None") + seg(cur === "full" ? "cardio" : cur, "cardio", S().plan.session.short || "Session") + seg(cur, "floor", "Floor") + seg(cur, "both", "Both")
    : seg(cur, "none", "None") + seg(cur, "light", "Light") + seg(cur === "cardio" ? "full" : cur, "full", "Full");
  const options = EVENTS.concat((e.events || []).filter(x => !EVENTS.includes(x)));
  return `<div id="e-form">
    <label class="f">Any of these today? Tap each one you had.</label>
    <div class="chips" id="e-sym">${chips}</div>
    <div class="form-grid" id="e-sym-n">${boxes}</div>
    ${C.hasCondition(S(), "migraine") ? yn("e-migraine", "Migraine today?", e.migraine) + yn("e-rescue", "Rescue medication today?", e.rescue) : ""}
    ${C.asksCrash(S()) ? yn("e-crash", "Did you crash today?", e.crash) : ""}
    ${hasSessions ? `<label class="f">Session done</label><div class="seg" id="e-session">${sessionSeg}</div>` : ""}
    ${wSteps == null ? `<label class="f" for="e-steps">Steps today, if you know them</label><input type="number" id="e-steps" inputmode="numeric" value="${esc(e.steps)}">` : ""}
    <label class="f">Anything unplanned?</label>
    <div class="chips" id="e-events">${options.map(o => `<button data-v="${esc(o)}" class="${(e.events || []).includes(o) ? "on" : ""}">${esc(o)}</button>`).join("")}</div>
    <label class="f" for="e-notes">Notes</label><textarea id="e-notes">${esc(e.notes || "")}</textarea>
    <div style="margin-top:14px"><button class="btn primary block" data-act="save-evening">Save evening</button></div>
  </div>`;
}

/* ============================ Calendar ============================ */
function calendarBox(ds) {
  const t = todayISO(), e = store.days[ds] || {}, p = plan(ds, t);
  if (ds >= t) {
    const title = ds === t ? "Today" : "Preview: " + (ds === shiftISO(t, 1) ? "tomorrow, " : "") + fmtLong(parseISO(ds));
    return `<div class="card tint-${p.tone}"><h2>${esc(title)}</h2><div class="daytype tone-${p.tone}">${esc(p.label)}</div>${linesHTML(p, false)}</div>`;
  }
  const r = p.readings, st = C.stepsOf(e), parts = [];
  const read = [r.sleep != null ? r.sleep + " h sleep" : "", r.rhr != null ? "resting heart rate " + r.rhr : "", r.hrv != null ? "HRV " + r.hrv : "", r.recovery != null ? "recovery " + r.recovery + "%" : "", r.scale != null ? "symptoms " + r.scale + " of 10" : ""].filter(Boolean);
  if (read.length) parts.push(capFirst(read.join(", ")) + ".");
  if (st != null) parts.push(`${n0(st)} steps` + (p.ceiling != null ? (st > p.ceiling ? `, ${n0(st - p.ceiling)} over the limit.` : ` of ${n0(p.ceiling)}.`) : "."));
  const ev = e.evening || {}, sym = Object.entries(ev.symptoms || {}).map(([k, v]) => (SYMPTOMS[k] || k).toLowerCase() + (v != null ? " " + v : ""));
  if (sym.length) parts.push(capFirst(sym.join(", ")) + ".");
  const workouts = ((e.wearable || {}).workouts || []).map(w => w.name + (w.minutes ? ` (${Math.round(w.minutes)} min)` : ""));
  if (workouts.length) parts.push(capFirst(workouts.join("; ")) + ".");
  if (ev.notes) parts.push(ev.notes);
  const head = p.checkedIn || p.type === "flare" ? `<div class="daytype tone-${p.tone}">${esc(p.label)}</div>` : "";
  return `<div class="card ${p.checkedIn ? "tint-" + p.tone : ""}"><h2>${esc(fmtLong(parseISO(ds)))}</h2>${head}${parts.length ? parts.map(x => `<p class="small">${esc(x)}</p>`).join("") : `<p class="small muted">Nothing logged.</p>`}</div>`;
}
function viewCalendar() {
  const t = todayISO(), today = parseISO(t);
  if (!ui.calMonth) ui.calMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const m = ui.calMonth, first = new Date(m.getFullYear(), m.getMonth(), 1), gridStart = addDays(first, -((first.getDay() + 6) % 7)), sel = ui.selected || shiftISO(t, 1);
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i), ds = iso(d), p = plan(ds, t), mk = dayMark(ds, p);
    cells += `<div class="cal-day ${d.getMonth() !== m.getMonth() ? "other" : ""} ${ds === t ? "today" : ""} ${ds === sel ? "sel" : ""} ${mk.cls}" data-date="${ds}"><span class="d num">${d.getDate()}</span>${mk.html}<span class="ph ${phaseBar(p.cycle)}"></span></div>`;
  }
  const cyc = S().cycle.track ? `<span><i class="bar period"></i>Period</span><span><i class="bar luteal"></i>Luteal</span>` : "";
  const mig = C.hasCondition(S(), "migraine") ? `<span><i class="mig-key"></i>Migraine</span>` : "";
  const legend = `<div class="legend"><span class="lg bg-blue tone-blue">${esc(S().plan.session.short)}</span><span class="lg bg-plum tone-plum">${C.usesFloor(S().plan) ? "Floor set and other exercise" : "Light and other exercise"}</span><span class="lg bg-rest tone-rest">Rest</span>${mig}${cyc}</div>`;
  const label = m.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return `<div class="card"><div class="cal-head"><button class="btn quiet" data-act="cal-prev">‹ Prev</button><h2>${esc(label)}</h2><button class="btn quiet" data-act="cal-next">Next ›</button></div>
    <div class="cal-grid">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(x => `<div class="cal-dow">${x}</div>`).join("")}${cells}</div>${legend}</div>` + calendarBox(sel);
}

/* ============================ Review ============================ */
function lineChart(keys, values, opts = {}) {
  const W = 680, H = 160, L = 34, R = 10, T = 10, B = 22;
  const all = values.filter(x => x != null), extra = (opts.refs || []).concat((opts.limit || []).filter(x => x != null));
  if (!all.length) return `<p class="small muted">No readings yet.</p>`;
  let lo = Math.min(...all, ...extra), hi = Math.max(...all, ...extra);
  if (hi - lo < 10) { lo -= 5; hi += 5; }
  lo = Math.floor(lo / 5) * 5 - 5; hi = Math.ceil(hi / 5) * 5 + 5;
  if (opts.min != null) lo = Math.max(opts.min, lo);
  if (opts.max != null) hi = Math.min(opts.max, hi);
  const x = i => L + (i / (keys.length - 1)) * (W - L - R), y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  for (let g = lo; g <= hi; g += Math.max(5, Math.round((hi - lo) / 4 / 5) * 5)) svg += `<line class="axis" x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}"/><text x="${L - 4}" y="${y(g) + 4}" text-anchor="end">${g}</text>`;
  (opts.refs || []).forEach(v => { svg += `<line class="cap" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`; });
  if (opts.limit) { let d = ""; opts.limit.forEach((v, i) => { if (v != null) d += `${d && opts.limit[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; }); if (d) svg += `<path class="cap" d="${d}"/>`; }
  let path = ""; values.forEach((v, i) => { if (v != null) path += `${path && values[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; });
  svg += `<path class="l1" d="${path}"/>` + values.map((v, i) => v == null ? "" : `<circle class="pt" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3"/>`).join("");
  [0, Math.floor(keys.length / 2), keys.length - 1].forEach(i => { svg += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(fmtShort(parseISO(keys[i])))}</text>`; });
  return svg + `</svg>`;
}
function barChart(keys, values, caps) {
  const W = 680, H = 150, L = 34, R = 10, T = 10, B = 22, all = values.concat(caps).filter(x => x != null);
  if (!values.some(x => x != null)) return `<p class="small muted">No steps yet.</p>`;
  const hi = Math.max(1000, ...all) * 1.1, bw = (W - L - R) / keys.length, y = v => T + (1 - v / hi) * (H - T - B);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  values.forEach((v, i) => { if (v != null) svg += `<rect class="bar ${caps[i] != null && v > caps[i] ? "over" : ""}" x="${(L + i * bw + 1).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(H - B - y(v)).toFixed(1)}"/>`; });
  caps.forEach((c, i) => { if (c != null) svg += `<line class="cap" x1="${(L + i * bw).toFixed(1)}" x2="${(L + (i + 1) * bw).toFixed(1)}" y1="${y(c).toFixed(1)}" y2="${y(c).toFixed(1)}"/>`; });
  [0, Math.floor(keys.length / 2), keys.length - 1].forEach(i => { svg += `<text x="${L + (i + 0.5) * bw}" y="${H - 6}" text-anchor="middle">${esc(fmtShort(parseISO(keys[i])))}</text>`; });
  return svg + `</svg>`;
}
function viewReview() {
  const t = todayISO(), T0 = parseISO(t), s = S(), L = C.limitsOf(s), keys = [];
  for (let i = 27; i >= 0; i--) keys.push(iso(addDays(T0, -i)));
  const rows = keys.map(k => ({ k, e: store.days[k] || {}, p: plan(k, t) }));
  const r = f => rows.map(x => C.readingsOf(x.e)[f]);
  let out = `<div class="card"><h2>Last 4 weeks</h2><p class="small muted">Dashed lines are your limits.</p>`;
  out += `<h3>Resting heart rate</h3>` + lineChart(keys, r("rhr"), { limit: rows.map(x => x.p.base.rhr.value != null ? x.p.base.rhr.value + L.rhrAbove : null) });
  out += `<h3>HRV</h3>` + lineChart(keys, r("hrv"), { limit: rows.map(x => x.p.base.hrv.value != null ? Math.round(x.p.base.hrv.value * (100 - L.hrvBelowPct) / 100) : null) });
  out += `<h3>${esc((TEMPLATES[s.plan.template] || {}).morning || "Symptoms, mornings")}</h3>` + lineChart(keys, r("scale"), { refs: [L.symptomAmber, L.symptomRed], min: 0, max: 10 });
  if (C.hasCondition(s, "pots")) out += `<h3>Standing rise</h3>` + lineChart(keys, r("rise"), { refs: [L.riseAmber, L.riseRed], min: 0 });
  out += `<h3>Steps</h3>` + barChart(keys, rows.map(x => C.stepsOf(x.e)), rows.map(x => x.p.ceiling)) + `</div>`;
  // This week, in plain lines naming the days.
  const mon = mondayOf(T0), sessions = [], over = [], reds = [];
  for (let i = 0; i < 7; i++) {
    const k = iso(addDays(mon, i)); if (k > t) break;
    const e = store.days[k] || {}, done = C.sessionsDone(e, s.plan), p = plan(k, t), st = C.stepsOf(e);
    if (done.length) sessions.push(done.join(" and ").toLowerCase() + " on " + dayName(k));
    if (k < t && st != null && p.ceiling != null && st > p.ceiling) over.push(`${dayName(k)} (${n0(st)} of ${n0(p.ceiling)})`);
    if (e.morning && p.gate && p.gate.red.length) reds.push(dayName(k));
  }
  const fl = plan(t, t).flare, lines = [
    "Exercise: " + (sessions.length ? sessions.join("; ") : "none yet") + ".",
    "Steps: " + (over.length ? "over the limit on " + over.join("; ") : "no day over the limit") + ".",
    "Morning readings: " + (reds.length ? "past a limit on " + reds.join(", ") : "none past a limit") + ".",
    "Flare: " + (fl.active ? `day ${fl.length}` : "none") + "."
  ];
  if (C.hasCondition(s, "migraine") || C.asksCrash(s)) {
    const month = Object.keys(store.days).filter(k => k.slice(0, 7) === t.slice(0, 7));
    const count = f => month.filter(k => (store.days[k].evening || {})[f] === true).length;
    if (C.hasCondition(s, "migraine")) lines.push(`This month: ${count("migraine")} migraine ${count("migraine") === 1 ? "day" : "days"}, rescue medication on ${count("rescue")}.`);
    if (C.asksCrash(s)) lines.push(`Crashes this month: ${count("crash")}.`);
  }
  out += `<div class="card"><h2>This week</h2><p class="sub">Monday to today.</p><ul class="clean lines">${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul></div>`;
  const logged = rows.slice().reverse().filter(x => x.e.morning || x.e.evening || x.e.wearable);
  if (logged.length) {
    // Columns as the data allows: cycle day when a cycle is tracked; recovery and strain when WHOOP gave them.
    const any = f => logged.some(x => num(((x.e.wearable || {})[f])) != null), pots = C.hasCondition(s, "pots"), cyc = !!s.cycle.track;
    const cols = [["Date", x => esc(fmtShort(parseISO(x.k)))],
      cyc && ["Cycle day", x => x.p.cycle ? `${x.p.cycle.day}, ${x.p.cycle.phase}` : ""],
      ["Day", x => x.p.checkedIn && x.p.short ? `<span class="pill ${x.p.tone}">${esc(x.p.short)}</span>` : ""],
      ["Sleep", x => esc(x.r.sleep)], ["RHR", x => esc(x.r.rhr)], ["HRV", x => esc(x.r.hrv)],
      any("recovery") && ["Recovery", x => x.r.recovery != null ? esc(x.r.recovery) + "%" : ""],
      [capFirst(C.scaleWord(s)), x => esc(x.r.scale)],
      pots && ["Rise", x => esc(x.r.rise)],
      ["Steps", x => x.st != null ? n0(x.st) : "", x => x.st != null && x.p.ceiling != null && x.st > x.p.ceiling],
      ["Session", x => esc(C.sessionsDone(x.e, s.plan).join(", "))],
      any("strain") && ["Strain", x => esc((x.e.wearable || {}).strain)]].filter(Boolean);
    out += `<div class="card"><h2>Log</h2><div class="wrap-x"><table class="t log"><tr>${cols.map(c => `<th>${c[0]}</th>`).join("")}</tr>`;
    logged.forEach(x => {
      x.r = C.readingsOf(x.e); x.st = C.stepsOf(x.e);
      out += `<tr class="num">${cols.map(c => `<td${c[2] && c[2](x) ? ' class="over"' : ""}>${c[1](x)}</td>`).join("")}</tr>`;
    });
    out += `</table></div></div>`;
  }
  return out;
}

/* ============================ Settings ============================ */
function viewSettings() {
  const s = S(), P = s.plan, T = TEMPLATES[P.template], base = C.baselines(store.days, todayISO()), auto = C.stepLimits({ steps: {} }, base);
  const numIn = (id, label, v, ph = "", mode = "numeric") => `<div><label class="f" for="${id}">${label}</label><input type="number" id="${id}" inputmode="${mode}" value="${esc(v == null ? "" : v)}" placeholder="${esc(ph)}"></div>`;
  // Cycle, data, wearables and reminders first; then the plan, the conditions and what setup asked.
  let out = "";
  if (C.asksCycle(s)) out += `<div class="card"><h2>Your cycle</h2><div class="seg" id="s-cycle">${seg(s.cycle.track ? "yes" : "no", "no", "Don't track")}${seg(s.cycle.track ? "yes" : "no", "yes", "Track")}</div>
    <div id="s-cycle-more"${s.cycle.track ? "" : " hidden"}><label class="f" for="s-starts">Period start dates, oldest first</label><input type="text" id="s-starts" value="${esc(C.cycleStarts(s).join(", "))}" placeholder="YYYY-MM-DD">
    ${numIn("s-len", "Usual cycle length (days)", s.cycle.length)}</div>
    <div style="margin-top:12px"><button class="btn primary block" data-act="save-cycle">Save</button></div></div>`;
  out += `<div class="card"><h2>Data</h2><p>Everything stays on this phone. Save a backup now and then, and keep it somewhere safe.</p>
    <div class="actions"><button class="btn block" data-act="backup">Save a backup</button><label class="btn block" for="s-restore">Restore a backup</label><input type="file" id="s-restore" accept=".json,application/json" hidden><button class="btn block" data-act="csv">Download a spreadsheet</button><button class="btn quiet block danger" data-act="wipe">Delete everything</button></div><p class="small" style="margin-top:10px"><a href="privacy.html">Privacy policy</a></p></div>`;
  const health = Health ? `<p>Sleep, heart rate, HRV, steps, workouts and periods from Apple Health. Apple Watch and WHOOP both write there.</p><button class="btn primary block" data-act="health-connect">${s.health ? "Read Apple Health now" : "Connect Apple Health"}</button>` : "";
  out += `<div class="card"><h2>Wearables</h2>${health}
    <p${Health ? ' style="margin-top:12px"' : ""}>WHOOP recovery scores come from WHOOP's data export: request it in the WHOOP app, unzip the file it sends, and choose physiological_cycles.csv (and workouts.csv if you like).</p>
    <label class="btn block" for="s-whoop">Import WHOOP files</label><input type="file" id="s-whoop" accept=".csv,text/csv" multiple hidden></div>`;
  out += `<div class="card"><h2>Reminders</h2><div class="form-grid"><div><label class="f" for="s-rm">Morning</label><input type="time" id="s-rm" value="${esc(s.reminders.morning)}"></div><div><label class="f" for="s-re">Evening</label><input type="time" id="s-re" value="${esc(s.reminders.evening)}"></div></div>
    <div style="margin-top:12px">${Notes ? `<button class="btn primary block" data-act="reminders-on">${s.remindersOn ? "Update reminders" : "Turn on reminders"}</button>${s.remindersOn ? `<button class="btn quiet block" data-act="reminders-off">Turn off</button>` : ""}` : `<button class="btn primary block" data-act="reminders-ics">Add to my calendar</button>`}</div></div>`;
  const main = P.session.short || "Session", floorOn = C.usesFloor(P) || C.usesFloor(T);
  const kinds = floorOn ? [["session", main], ["both", main + " and floor"], ["floor", "Floor set"], ["open", "No session"], ["rest", "Rest"]] : [["session", "Session"], ["open", "No session"], ["rest", "Rest"]];
  const kindSel = d => `<div><label class="f" for="p-w-${d}">${capFirst(d)}</label><select id="p-w-${d}">${kinds.map(([v, l]) => `<option value="${v}"${P.week[d] === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
  const L = P.limits;
  out += `<div class="card"><h2>Your plan</h2>
    <label class="f" for="p-template">Starting point</label><select id="p-template">${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}"${P.template === k ? " selected" : ""}>${esc(t.label)}</option>`).join("")}</select>
    <p class="small muted" style="margin-top:6px">${esc(T.about)}</p>
    <div class="form-grid seven">${WEEK.map(kindSel).join("")}</div>
    <label class="f" for="p-title">Session</label><input type="text" id="p-title" value="${esc(P.session.title)}">
    <div class="form-grid three">${numIn("p-min", "Minutes", P.session.minutes)}${numIn("p-add", "Add each week", P.session.addPerWeek)}${numIn("p-max", "Up to", P.session.maxMinutes)}</div>
    ${floorOn ? `<label class="f" for="p-floor">Floor set</label><input type="text" id="p-floor" value="${esc(P.floor.title)}"><div class="form-grid three">${numIn("p-floor-min", "Minutes", P.floor.minutes)}</div>` : ""}
    <div class="form-grid three">${numIn("p-steps-open", "Steps, no session", P.steps.open, auto.open != null ? n0(auto.open) : "")}${numIn("p-steps-session", "Steps, session day", P.steps.session, auto.session != null ? n0(auto.session) : "")}${numIn("p-steps-rest", "Steps, rest day", P.steps.rest, auto.rest != null ? n0(auto.rest) : "")}</div>
    <p class="small muted">${auto.open != null ? "Left blank, steps follow your own: about " + n0(auto.open) + " a day." : "Left blank, steps follow your own once there are 7 days of them."}</p>
    <div class="form-grid"><div><label class="f" for="p-bed">In bed by</label><input type="time" id="p-bed" value="${esc(P.bedtime)}"></div>${numIn("p-sleep", "Shortest night before rest (hours)", L.sleepMin, "", "decimal")}</div>
    ${numIn("p-hr", "Heart rate guide in sessions", P.hrCap, (() => { const c = C.hrCap(Object.assign({}, s, { plan: Object.assign({}, P, { hrCap: null }) }), base, todayISO()); return c != null ? String(c) : ""; })())}
    <label class="f" for="p-note">A line to show every day</label><input type="text" id="p-note" value="${esc(P.note)}" placeholder="For example: 2.5 L of fluid">
    <details style="margin-top:12px"><summary>Limits</summary>
      <div class="form-grid">${numIn("p-l-rhr", "Resting heart rate above your usual by", L.rhrAbove)}${numIn("p-l-hrv", "HRV below your usual by (%)", L.hrvBelowPct)}${numIn("p-l-sa", "Morning score for a light day, from", L.symptomAmber)}${numIn("p-l-sr", "Morning score for a rest day, from", L.symptomRed)}${C.hasCondition(s, "pots") ? numIn("p-l-ra", "Standing rise for a light day, from", L.riseAmber) + numIn("p-l-rr", "Standing rise for a rest day, from", L.riseRed) : ""}</div>
    </details>
    <div style="margin-top:12px"><button class="btn primary block" data-act="save-plan">Save</button></div></div>`;
  const condChips = CONDITIONS.map(([k, l]) => `<button data-v="${k}" class="${s.conditions.includes(k) ? "on" : ""}">${l}</button>`).join("");
  out += `<div class="card"><h2>Your conditions</h2><div class="chips" id="s-cond">${condChips}</div>
    <label class="f">Do your symptoms get worse a day or two after doing too much?</label>
    <div class="seg" id="s-pem">${seg(s.pem, "yes", "Yes")}${seg(s.pem, "no", "No")}${seg(s.pem, "unsure", "Not sure")}</div>
    <div style="margin-top:12px"><button class="btn primary block" data-act="save-conditions">Save</button></div></div>`;
  const age = C.ageNow(s, todayISO()), sexLabel = (C.SEXES.find(x => x[0] === s.sex) || [])[1];
  const about = [[age != null ? `Age ${age}` : "", sexLabel && s.sex !== "unsaid" ? sexLabel.toLowerCase() : ""].filter(Boolean).join(", "), s.onset ? `Started ${fmtLong(parseISO(s.onset))}, ${parseISO(s.onset).getFullYear()}.` : "", s.context.symptoms, s.context.other].filter(Boolean).map(capFirst);
  out += `<div class="card"><h2>About you</h2>${about.map(x => `<p class="small">${esc(x)}</p>`).join("")}<button class="btn block" data-act="redo-setup">Run setup again</button></div>`;
  return out;
}

/* ============================ Files out ============================ */
async function saveFile(name, text, type) {
  if (Files && Share) {
    try {
      const r = await Files.writeFile({ path: name, data: text, directory: "CACHE", encoding: "utf8" });
      await Share.share({ title: name, url: r.uri });
      return;
    } catch (e) { if (e && /cancel/i.test(String(e.message || e))) return; }
  }
  const blob = new Blob([text], { type }), url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ============================ Apple Health (iPhone app) ============================ */
// Flow days become period starts: a flow day after at least 10 days without one.
function startsFromFlow(byDate) {
  const flow = Object.keys(byDate).filter(d => byDate[d] && byDate[d].flow).sort(), out = [];
  flow.forEach((d, i) => { if (!i || C.daysBetween(parseISO(flow[i - 1]), parseISO(d)) >= 10) out.push(d); });
  return out;
}
async function readHealth(daysBack, force) {
  if (!Health || !(S().health || force)) return 0;
  try {
    const r = await Health.readDays({ from: shiftISO(todayISO(), -daysBack), to: todayISO() });
    const byDate = (r && r.days) || {}, clean = {};
    for (const [d, v] of Object.entries(byDate)) { const w = Object.assign({}, v); delete w.flow; clean[d] = w; }
    const n = store.mergeWearable(clean, "health");
    if (S().cycle.track || force) {
      const starts = startsFromFlow(byDate);
      if (starts.length) { const s = Object.assign({}, S()); s.cycle = Object.assign({}, s.cycle, { starts: Array.from(new Set(C.cycleStarts(s).concat(starts))).sort() }); store.saveSettings(s); }
    }
    return n;
  } catch (e) { return 0; }
}

/* ============================ Reminders ============================ */
function reminderTimes() { return { morning: ($("s-rm") || {}).value || S().reminders.morning, evening: ($("s-re") || {}).value || S().reminders.evening }; }
async function scheduleReminders(times) {
  const at = t => { const [h, m] = t.split(":").map(Number); return { hour: h, minute: m }; };
  await Notes.requestPermissions();
  await Notes.cancel({ notifications: [{ id: 1 }, { id: 2 }] }).catch(() => {});
  await Notes.schedule({ notifications: [
    { id: 1, title: "Morning check-in", body: "Your morning check-in is waiting.", schedule: { on: at(times.morning), repeats: true, allowWhileIdle: true }, extra: { checkin: "morning" } },
    { id: 2, title: "Evening check-in", body: "Your evening check-in is waiting.", schedule: { on: at(times.evening), repeats: true, allowWhileIdle: true }, extra: { checkin: "evening" } }
  ] });
}

/* ============================ Render ============================ */
const TABS = [
  ["today", "Today", `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`],
  ["calendar", "Calendar", `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`],
  ["review", "Review", `<svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16"/><path d="M7 15l4-5 3 3 5-7"/></svg>`],
  ["settings", "Settings", `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>`]
];
function render() {
  const app = $("app"), s = S(), setup = !s.onboarded || ui.redo, inCheckin = ["morning", "evening", "checkin"].includes(ui.view);
  ui.dirty = false;
  let body;
  if (setup) body = viewSetup();
  else if (inCheckin) body = viewCheckin(ui.view);
  else body = { today: viewToday, calendar: viewCalendar, review: viewReview, settings: viewSettings }[ui.view]();
  const warn = store.ok ? "" : `<div class="banner rest">This browser isn't keeping data. On an iPhone, add the app to your home screen.</div>`;
  app.innerHTML = (setup ? "" : `<div class="topbar"><h1>POTS Tracker</h1></div>`) + warn + body;
  document.body.classList.toggle("ob-mode", setup);
  document.querySelector(".tabbar").hidden = setup || inCheckin;
  $("tabs").innerHTML = TABS.map(([id, label, icon]) => `<button class="${ui.view === id ? "on" : ""}" data-view="${id}">${icon}<span>${label}</span></button>`).join("");
}
function softRender() { if (!ui.dirty) render(); }

/* ============================ Events ============================ */
$("tabs").addEventListener("click", e => {
  const b = e.target.closest("button[data-view]"); if (!b) return;
  ui.view = b.dataset.view; render(); window.scrollTo(0, 0);
});
$("app").addEventListener("input", e => {
  ui.dirty = true;
  const id = e.target.id;
  if (id === "m-scale") $("m-scale-v").textContent = e.target.value;
  if (["m-hr0", "m-hr1", "m-hr3", "m-rhr"].includes(id)) updateRise();
  if (id === "ob-onset") { ob.a.onset = isDate(e.target.value) ? e.target.value : ""; $("ob-onset-more").innerHTML = onsetExtras(); }
});
$("app").addEventListener("change", async e => {
  const id = e.target.id;
  if ((id === "s-whoop" || id === "ob-whoop") && e.target.files.length) {
    let n = 0;
    for (const f of e.target.files) {
      const text = await f.text(), kind = C.whoopFileKind(text);
      if (kind === "cycles") n += store.mergeWearable(C.parseWhoopCycles(text), "whoop");
      else if (kind === "workouts") { const w = C.parseWhoopWorkouts(text), byDate = {}; for (const [d, list] of Object.entries(w)) byDate[d] = { workouts: list }; n += store.mergeWearable(byDate, "whoop"); }
    }
    toast(n ? `Read ${n} ${n === 1 ? "day" : "days"} from WHOOP` : "No WHOOP days found in that file");
    if (id === "ob-whoop") $("ob-connect").innerHTML = connectBlock(); else render();
  }
  if (id === "s-restore" && e.target.files.length) {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (!data || data.app !== "pots-tracker" || !data.settings) throw new Error("not a backup");
      if (!confirm("Replace everything on this phone with this backup?")) return;
      store.replaceAll(data); toast("Backup restored"); render();
    } catch (x) { toast("That file isn't a POTS Tracker backup"); }
  }
});
$("app").addEventListener("click", async e => {
  const chip = e.target.closest(".seg button, .chips button");
  if (chip) {
    ui.dirty = true;
    const box = chip.parentElement;
    if (box.classList.contains("seg") || (box.classList.contains("one") && !chip.classList.contains("on"))) { box.querySelectorAll("button").forEach(b => b.classList.remove("on")); chip.classList.add("on"); }
    else chip.classList.toggle("on");
    if (box.id === "ob-tracker") { ob.a.tracker = chip.classList.contains("on") ? chip.dataset.v : ""; $("ob-connect").innerHTML = connectBlock(); }
    if (box.id === "ob-cycle") $("ob-cycle-more").hidden = !(chip.classList.contains("on") && chip.dataset.v === "yes");
    if (box.id === "e-sym") { const row = document.querySelector(`#e-sym-n [data-k="${chip.dataset.k}"]`); if (row) row.hidden = !chip.classList.contains("on"); }
    if (box.id === "s-cycle") $("s-cycle-more").hidden = chip.dataset.v !== "yes";
    return;
  }
  const ctr = e.target.closest("#m-plans button");
  if (ctr) { ui.dirty = true; const n = (Number(ctr.dataset.n) || 0) + 1; ctr.dataset.n = n; ctr.querySelector(".n").textContent = n; ctr.classList.add("on"); return; }
  const cell = e.target.closest(".cal-day");
  if (cell) { ui.selected = cell.dataset.date; render(); return; }
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act, s = S(), v = id => ($(id) || {}).value;
  if (act === "cal-prev" || act === "cal-next") { ui.calMonth = new Date(ui.calMonth.getFullYear(), ui.calMonth.getMonth() + (act === "cal-next" ? 1 : -1), 1); render(); }
  else if (act === "ob-next" || act === "ob-back") {
    obCollect();
    const dir = act === "ob-next" ? 1 : -1;
    ob.step = Math.max(0, Math.min(OB_STEPS.length - 1, ob.step + dir));
    if (OB_STEPS[ob.step] === "cycle" && !C.asksCycle(ob.a)) ob.step += dir;  // no period questions after "male"
    render(); window.scrollTo(0, 0);
  }
  else if (act === "ob-use-shift") { ob.a.onset = b.dataset.v; $("ob-onset").value = b.dataset.v; $("ob-onset-more").innerHTML = onsetExtras(); }
  else if (act === "ob-health") {
    try { await Health.requestAuthorization(); } catch (x) { toast("Apple Health isn't available"); return; }
    ob.health = true;
    const n = await readHealth(540, true); toast(n ? `Read ${n} ${n === 1 ? "day" : "days"} from Apple Health` : "Nothing found in Apple Health yet");
    $("ob-connect").innerHTML = connectBlock();
  }
  else if (act === "ob-start") {
    obCollect();
    const t = todayISO(), next = C.settingsFromAnswers(ob.a, t);
    next.reminders = s.reminders; if (ob.health || s.health) next.health = true;
    store.saveSettings(next); ui.redo = false; ob.step = 0;
    ui.view = "today"; render(); window.scrollTo(0, 0);
    const due = dueCheckin(); if (due) openCheckin(due);
  }
  else if (act === "redo-setup") {
    if (!confirm("Run setup again? Your plan starts again from your answers. Your log stays.")) return;
    Object.assign(ob.a, blankAnswers(), { conditions: s.conditions.slice(), age: C.ageNow(s, todayISO()) ?? "", sex: s.sex, tracker: s.tracker, onset: s.onset, symptoms: s.symptoms.slice(), symptomNote: s.context.symptoms, exercise: s.exercise.slice(),
      pem: s.pem, goodDay: s.goodDay, outDays: s.outDays.slice(), bedtime: s.plan.bedtime || "", cycle: s.cycle.track ? "yes" : "", lastPeriod: C.cycleStarts(s).slice(-1)[0] || "", other: s.context.other });
    ob.step = 0; ui.redo = true; render(); window.scrollTo(0, 0);
  }
  else if (act === "go-checkin" || act === "go-today") {
    if (act === "go-today" && (ui.view === "morning" || ui.view === "evening")) { try { localStorage.setItem(NOT_NOW, checkinDay() + ":" + ui.view); } catch (x) {} }
    ui.checkinDay = null; ui.view = act.slice(3); render(); window.scrollTo(0, 0);
  }
  else if (act === "plans-clear") document.querySelectorAll("#m-plans button").forEach(x => { x.dataset.n = 0; x.querySelector(".n").textContent = 0; x.classList.remove("on"); });
  else if (act === "edit-vitals") { const more = $("m-vitals-more"); if (more) more.hidden = false; b.remove(); }
  else if (act === "save-morning") {
    const d = checkinDay(), m = formMorning();
    store.saveDay(d, { morning: m });
    ui.view = "today"; ui.checkinDay = null; render(); window.scrollTo(0, 0);
    const p = plan(d); toast(p.label + (p.ceiling != null ? `: up to ${n0(p.ceiling)} steps` : ""));
  }
  else if (act === "save-evening") {
    const d = checkinDay(), ev = Object.assign({}, (store.days[d] || {}).evening);
    const sym = {};
    document.querySelectorAll("#e-sym button.on").forEach(c => { const x = num(v("e-s-" + c.dataset.k)); sym[c.dataset.k] = x == null ? null : Math.max(0, Math.min(10, x)); });
    ev.symptoms = sym;
    ev.events = Array.from(document.querySelectorAll("#e-events button.on")).map(x => x.dataset.v);
    ev.notes = v("e-notes") || "";
    if ($("e-migraine")) { ev.migraine = segVal("e-migraine") === "yes"; ev.rescue = segVal("e-rescue") === "yes"; }
    if ($("e-crash")) ev.crash = segVal("e-crash") === "yes";
    if ($("e-session")) ev.session = segVal("e-session") || "none";
    if ($("e-steps")) { const st = num(v("e-steps")); if (st != null) ev.steps = st; else delete ev.steps; }
    store.saveDay(d, { evening: ev });
    ui.view = "today"; ui.checkinDay = null; render(); window.scrollTo(0, 0); toast("Evening saved");
  }
  else if (act === "save-conditions") {
    const conditions = Array.from(document.querySelectorAll("#s-cond button.on")).map(x => x.dataset.v), pem = segVal("s-pem") || s.pem;
    const next = Object.assign({}, s, { conditions, pem }), suggested = C.pickTemplate(conditions, pem);
    if (suggested !== s.plan.template && confirm(`Switch your plan to "${TEMPLATES[suggested].label}"? Your week and session start again from it.`)) next.plan = C.newPlan(suggested, todayISO());
    store.saveSettings(next); toast("Saved"); render();
  }
  else if (act === "save-plan") {
    const P = Object.assign({}, s.plan), tpl = v("p-template");
    if (tpl !== P.template) {
      if (!confirm(`Start again from "${TEMPLATES[tpl].label}"? Your week and session reset.`)) return;
      store.saveSettings(Object.assign({}, s, { plan: C.newPlan(tpl, todayISO()) })); toast("Saved"); render(); return;
    }
    WEEK.forEach(d => { P.week[d] = v("p-w-" + d); });
    P.session = Object.assign({}, P.session, { title: v("p-title") || P.session.title, minutes: num(v("p-min")) ?? P.session.minutes, addPerWeek: num(v("p-add")) ?? 0, maxMinutes: num(v("p-max")) ?? P.session.maxMinutes });
    if ($("p-floor")) P.floor = Object.assign({}, P.floor, { title: v("p-floor") || P.floor.title, minutes: num(v("p-floor-min")) ?? P.floor.minutes });
    P.steps = { open: num(v("p-steps-open")), session: num(v("p-steps-session")), rest: num(v("p-steps-rest")) };
    P.bedtime = v("p-bed") || ""; P.note = (v("p-note") || "").trim(); P.hrCap = num(v("p-hr"));
    P.limits = Object.assign({}, P.limits, { sleepMin: num(v("p-sleep")) ?? P.limits.sleepMin, rhrAbove: num(v("p-l-rhr")) ?? P.limits.rhrAbove, hrvBelowPct: num(v("p-l-hrv")) ?? P.limits.hrvBelowPct,
      symptomAmber: num(v("p-l-sa")) ?? P.limits.symptomAmber, symptomRed: num(v("p-l-sr")) ?? P.limits.symptomRed });
    if ($("p-l-ra")) Object.assign(P.limits, { riseAmber: num(v("p-l-ra")) ?? P.limits.riseAmber, riseRed: num(v("p-l-rr")) ?? P.limits.riseRed });
    store.saveSettings(Object.assign({}, s, { plan: P })); toast("Saved"); render();
  }
  else if (act === "save-cycle") {
    const track = segVal("s-cycle") === "yes", starts = Array.from(new Set((v("s-starts") || "").split(/[\s,;]+/).filter(isDate))).sort();
    store.saveSettings(Object.assign({}, s, { cycle: { track, starts, length: num(v("s-len")) || 28 } })); toast("Saved"); render();
  }
  else if (act === "health-connect") {
    try { await Health.requestAuthorization(); } catch (x) { toast("Apple Health isn't available"); return; }
    store.saveSettings(Object.assign({}, s, { health: true }));
    const n = await readHealth(120); toast(n ? `Read ${n} ${n === 1 ? "day" : "days"} from Apple Health` : "Nothing new in Apple Health"); render();
  }
  else if (act === "reminders-ics") {
    const times = reminderTimes();
    store.saveSettings(Object.assign({}, s, { reminders: times }));
    await saveFile("pots-tracker-reminders.ics", C.reminderICS(times, new Date(), location.origin + location.pathname), "text/calendar");
  }
  else if (act === "reminders-on") {
    const times = reminderTimes();
    try { await scheduleReminders(times); store.saveSettings(Object.assign({}, s, { reminders: times, remindersOn: true })); toast("Reminders on"); }
    catch (x) { toast("Reminders didn't turn on. Allow notifications in Settings."); }
    render();
  }
  else if (act === "reminders-off") {
    await Notes.cancel({ notifications: [{ id: 1 }, { id: 2 }] }).catch(() => {});
    store.saveSettings(Object.assign({}, s, { remindersOn: false })); toast("Reminders off"); render();
  }
  else if (act === "backup") await saveFile(`pots-tracker-backup-${todayISO()}.json`, JSON.stringify({ app: "pots-tracker", version: 1, exportedAt: new Date().toISOString(), settings: s, days: store.days }, null, 1), "application/json");
  else if (act === "csv") await saveFile(`pots-tracker-${todayISO()}.csv`, C.exportCSV(store.days, s, todayISO()), "text/csv");
  else if (act === "wipe") {
    if (!confirm("Delete everything on this phone? This can't be undone. Save a backup first if you want one.")) return;
    store.clear(); ui.view = "today"; render(); toast("Everything deleted");
  }
});

/* ============================ Start ============================ */
store.load();
render();
(async () => {
  const asked = new URLSearchParams(location.search).get("checkin");
  if (S().health) { const n = await readHealth(7); if (n) softRender(); }
  if (asked) { try { history.replaceState(null, "", location.pathname); } catch (x) {} openCheckin(asked); return; }
  const due = dueCheckin(); if (due) openCheckin(due);
})();
// A tapped reminder in the iPhone app opens its check-in.
if (Notes && Notes.addListener) Notes.addListener("localNotificationActionPerformed", a => { const c = a && a.notification && a.notification.extra && a.notification.extra.checkin; if (c) openCheckin(c); });
// Back to the front on a new day, or after an hour away: read Apple Health again and open a check-in that is due.
let lastSeen = { at: Date.now(), day: todayISO() };
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "hidden") { lastSeen = { at: Date.now(), day: todayISO() }; return; }
  const newDay = todayISO() !== lastSeen.day;
  if (!newDay && Date.now() - lastSeen.at < 3600000) return;
  if (newDay) { ui.selected = null; ui.calMonth = null; }
  if (S().health) await readHealth(3);
  const due = dueCheckin();
  if (due && !ui.dirty && !["morning", "evening", "checkin"].includes(ui.view)) openCheckin(due); else softRender();
});
if ("serviceWorker" in navigator && !NATIVE && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
