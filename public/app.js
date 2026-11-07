// POTS Tracker screens. Data lives only on this device (localStorage); nothing is sent anywhere.
// The iPhone app adds Apple Health and scheduled reminders through Capacitor plugins; the web version does without.
import * as C from "./core.js";
const { SYMPTOMS, CONDITIONS, TEMPLATES, WEEK, PLAN_LABEL, todayISO, shiftISO, parseISO, iso, addDays, logDayISO, mondayOf, num, isDate } = C;

/* ============================ The iPhone layer, when present ============================ */
const cap = window.Capacitor, NATIVE = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
const plugin = name => (NATIVE && cap.Plugins && cap.Plugins[name]) || null;
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
      steps: Object.assign(fresh.steps, out.plan.steps), limits: Object.assign(fresh.limits, out.plan.limits) });
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

/* ============================ Setup ============================ */
function viewSetup() {
  const chips = CONDITIONS.map(([k, l]) => `<button data-v="${k}">${l}</button>`).join("");
  return `<div class="card"><h2>Welcome</h2>
    <p>A daily plan and log for POTS, long COVID, post-concussion symptoms and migraine. Everything you enter stays on this phone.</p>
    <label class="f">What are you managing? Tap all that apply.</label><div class="chips" id="o-cond">${chips}</div>
    <label class="f">Do your symptoms get worse a day or two after doing too much?</label>
    <div class="seg" id="o-pem">${seg("", "yes", "Yes")}${seg("", "no", "No")}${seg("", "unsure", "Not sure")}</div>
    <label class="f">Track your cycle?</label><div class="seg" id="o-cycle">${seg("no", "no", "No")}${seg("no", "yes", "Yes")}</div>
    <div id="o-cycle-more" hidden><label class="f" for="o-start">When did your last period start?</label><input type="date" id="o-start" max="${todayISO()}"></div>
    <div style="margin-top:16px"><button class="btn primary block" data-act="setup-done">Start</button></div></div>`;
}

/* ============================ Today ============================ */
function linesHTML(p, withNotes) {
  return `<ul class="clean lines">${p.lines.concat(withNotes ? p.notes : []).map(l => `<li>${esc(l)}</li>`).join("")}</ul>`;
}
function outBlock(p) {
  const why = p.why.length && (p.type === "rest" || p.type === "light") ? `<p class="why">Why: ${esc(p.why.join("; "))}.</p>` : "";
  return `<div class="daytype tone-${p.tone}">${esc(p.label)}</div>${why}${linesHTML(p, true)}`;
}
function flareBanner(p) {
  if (p.type !== "flare") return "";
  return `<div class="banner rest"><b>Flare, day ${p.flare.length}.</b> It ends after two good mornings in a row.</div>`;
}
function baselineLine(p) {
  const n = p.base.rhr.n;
  return n > 0 && p.base.rhr.value == null ? `<p class="small muted">Your heart-rate limits start after ${C.BASELINE.min} mornings of readings (${n} so far).</p>` : "";
}
function viewToday() {
  const t = todayISO(), entry = store.days[t] || {}, p = plan(t);
  const head = entry.morning ? "Today" : "Today, as planned";
  return flareBanner(p) + `<div class="card ${entry.morning || p.type === "flare" ? "tint-" + p.tone : ""}"><h2>${head}</h2>${outBlock(p)}${baselineLine(p)}</div>`
    + weekCard() + `<div class="actions"><button class="btn quiet" data-act="go-checkin">Edit today's check-in</button></div>`;
}

/* ============================ Calendar marks ============================ */
function planWords(p) { return p.short ? [p.short] : []; }
function wordTone(w, p) {
  if (w === "Rest" || w === "Flare") return "rest";
  if (w === "Busy" || w === "Migraine") return "free";
  if (w === "Light") return "plum";
  return w === (S().plan.session.short || "") || w === "Session" ? "blue" : "plum";
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
    if (e.evening && e.evening.migraine) words.push("Migraine");
  }
  words = words.slice(0, 2);
  const tone = words.length ? wordTone(words[0], p) : "";
  return { cls: tone && tone !== "free" ? "bg-" + tone : "", html: words.map(w => `<span class="w tone-${wordTone(w, p)}">${esc(w)}</span>`).join("") };
}
function phaseBar(c) { return !c ? "" : (c.period ? "period" : (c.late ? "late" : "")); }
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
    <label class="f" for="m-scale">Symptoms right now: <b id="m-scale-v" class="num">${scale}</b> out of 10</label>
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
  const keys = C.symptomKeys(S().conditions, Object.keys(sym));
  const chips = keys.map(k => `<button data-k="${k}" class="${had(k) ? "on" : ""}">${esc(SYMPTOMS[k] || k)}</button>`).join("");
  const boxes = keys.map(k => `<div data-k="${k}"${had(k) ? "" : " hidden"}><label class="f" for="e-s-${k}">${esc(SYMPTOMS[k] || k)}, 0 to 10</label><input type="number" min="0" max="10" inputmode="numeric" id="e-s-${k}" value="${esc(sym[k] != null ? sym[k] : "")}"></div>`).join("");
  const yn = (id, label, v) => `<label class="f">${label}</label><div class="seg" id="${id}">${seg(v === true ? "yes" : "no", "no", "No")}${seg(v === true ? "yes" : "no", "yes", "Yes")}</div>`;
  const hasSessions = Object.values(S().plan.week).includes("session");
  const options = EVENTS.concat((e.events || []).filter(x => !EVENTS.includes(x)));
  return `<div id="e-form">
    <label class="f">Any of these today? Tap each one you had.</label>
    <div class="chips" id="e-sym">${chips}</div>
    <div class="form-grid" id="e-sym-n">${boxes}</div>
    ${C.hasCondition(S(), "migraine") ? yn("e-migraine", "Migraine today?", e.migraine) + yn("e-rescue", "Rescue medication today?", e.rescue) : ""}
    ${C.asksCrash(S()) ? yn("e-crash", "Did you crash today?", e.crash) : ""}
    ${hasSessions ? `<label class="f">Session done</label><div class="seg" id="e-session">${seg(e.session || "none", "none", "None")}${seg(e.session || "none", "light", "Light")}${seg(e.session || "none", "full", "Full")}</div>` : ""}
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
  const cyc = S().cycle.track ? `<span><i class="bar period"></i>Period</span><span><i class="bar late"></i>Week before</span>` : "";
  const legend = `<div class="legend"><span class="lg bg-blue tone-blue">${esc(S().plan.session.short)}</span><span class="lg bg-plum tone-plum">Light and other exercise</span><span class="lg bg-rest tone-rest">Rest</span>${cyc}</div>`;
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
  out += `<h3>Symptoms, mornings</h3>` + lineChart(keys, r("scale"), { refs: [L.symptomAmber, L.symptomRed] });
  if (C.hasCondition(s, "pots")) out += `<h3>Standing rise</h3>` + lineChart(keys, r("rise"), { refs: [L.riseAmber, L.riseRed] });
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
    out += `<div class="card"><h2>Log</h2><div class="wrap-x"><table class="t log"><tr><th>Date</th><th>Day</th><th>Sleep</th><th>RHR</th><th>HRV</th><th>Symptoms</th>${C.hasCondition(s, "pots") ? "<th>Rise</th>" : ""}<th>Steps</th><th>Exercise</th></tr>`;
    logged.forEach(x => {
      const rd = C.readingsOf(x.e), st = C.stepsOf(x.e), overDay = st != null && x.p.ceiling != null && st > x.p.ceiling;
      out += `<tr class="num"><td>${esc(fmtShort(parseISO(x.k)))}</td><td>${x.p.checkedIn && x.p.short ? `<span class="pill ${x.p.tone}">${esc(x.p.short)}</span>` : ""}</td><td>${esc(rd.sleep)}</td><td>${esc(rd.rhr)}</td><td>${esc(rd.hrv)}</td><td>${esc(rd.scale)}</td>${C.hasCondition(s, "pots") ? `<td>${esc(rd.rise)}</td>` : ""}<td${overDay ? ' class="over"' : ""}>${st != null ? n0(st) : ""}</td><td>${esc(C.sessionsDone(x.e, s.plan).join(", "))}</td></tr>`;
    });
    out += `</table></div></div>`;
  }
  return out;
}

/* ============================ Settings ============================ */
function viewSettings() {
  const s = S(), P = s.plan, T = TEMPLATES[P.template], base = C.baselines(store.days, todayISO()), auto = C.stepLimits({ steps: {} }, base);
  const condChips = CONDITIONS.map(([k, l]) => `<button data-v="${k}" class="${s.conditions.includes(k) ? "on" : ""}">${l}</button>`).join("");
  const kindSel = d => `<div><label class="f" for="p-w-${d}">${capFirst(d)}</label><select id="p-w-${d}">${[["session", "Session"], ["open", "No session"], ["rest", "Rest"]].map(([v, l]) => `<option value="${v}"${P.week[d] === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>`;
  const numIn = (id, label, v, ph = "", mode = "numeric") => `<div><label class="f" for="${id}">${label}</label><input type="number" id="${id}" inputmode="${mode}" value="${esc(v == null ? "" : v)}" placeholder="${esc(ph)}"></div>`;
  const L = P.limits;
  let out = `<div class="card"><h2>Your conditions</h2><div class="chips" id="s-cond">${condChips}</div>
    <label class="f">Do your symptoms get worse a day or two after doing too much?</label>
    <div class="seg" id="s-pem">${seg(s.pem, "yes", "Yes")}${seg(s.pem, "no", "No")}${seg(s.pem, "unsure", "Not sure")}</div>
    <div style="margin-top:12px"><button class="btn primary block" data-act="save-conditions">Save</button></div></div>`;
  out += `<div class="card"><h2>Your plan</h2>
    <label class="f" for="p-template">Starting point</label><select id="p-template">${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}"${P.template === k ? " selected" : ""}>${esc(t.label)}</option>`).join("")}</select>
    <p class="small muted" style="margin-top:6px">${esc(T.about)}</p>
    <div class="form-grid seven">${WEEK.map(kindSel).join("")}</div>
    <label class="f" for="p-title">Session</label><input type="text" id="p-title" value="${esc(P.session.title)}">
    <div class="form-grid three">${numIn("p-min", "Minutes", P.session.minutes)}${numIn("p-add", "Add each week", P.session.addPerWeek)}${numIn("p-max", "Up to", P.session.maxMinutes)}</div>
    <div class="form-grid three">${numIn("p-steps-open", "Steps, no session", P.steps.open, auto.open != null ? n0(auto.open) : "")}${numIn("p-steps-session", "Steps, session day", P.steps.session, auto.session != null ? n0(auto.session) : "")}${numIn("p-steps-rest", "Steps, rest day", P.steps.rest, auto.rest != null ? n0(auto.rest) : "")}</div>
    <p class="small muted">${auto.open != null ? "Left blank, steps follow your own: about " + n0(auto.open) + " a day." : "Left blank, steps follow your own once there are 7 days of them."}</p>
    <div class="form-grid"><div><label class="f" for="p-bed">In bed by</label><input type="time" id="p-bed" value="${esc(P.bedtime)}"></div>${numIn("p-sleep", "Shortest night before rest (hours)", L.sleepMin, "", "decimal")}</div>
    <label class="f" for="p-note">A line to show every day</label><input type="text" id="p-note" value="${esc(P.note)}" placeholder="For example: 2.5 L of fluid">
    <details style="margin-top:12px"><summary>Limits</summary>
      <div class="form-grid">${numIn("p-l-rhr", "Resting heart rate above your usual by", L.rhrAbove)}${numIn("p-l-hrv", "HRV below your usual by (%)", L.hrvBelowPct)}${numIn("p-l-sa", "Symptoms for a light day, from", L.symptomAmber)}${numIn("p-l-sr", "Symptoms for a rest day, from", L.symptomRed)}${C.hasCondition(s, "pots") ? numIn("p-l-ra", "Standing rise for a light day, from", L.riseAmber) + numIn("p-l-rr", "Standing rise for a rest day, from", L.riseRed) : ""}</div>
    </details>
    <div style="margin-top:12px"><button class="btn primary block" data-act="save-plan">Save</button></div></div>`;
  out += `<div class="card"><h2>Your cycle</h2><div class="seg" id="s-cycle">${seg(s.cycle.track ? "yes" : "no", "no", "Don't track")}${seg(s.cycle.track ? "yes" : "no", "yes", "Track")}</div>
    <div id="s-cycle-more"${s.cycle.track ? "" : " hidden"}><label class="f" for="s-starts">Period start dates, oldest first</label><input type="text" id="s-starts" value="${esc(C.cycleStarts(s).join(", "))}" placeholder="YYYY-MM-DD">
    ${numIn("s-len", "Usual cycle length (days)", s.cycle.length)}</div>
    <div style="margin-top:12px"><button class="btn primary block" data-act="save-cycle">Save</button></div></div>`;
  const health = Health ? `<p>Sleep, heart rate, HRV, steps, workouts and periods from Apple Health. Apple Watch and WHOOP both write there.</p><button class="btn primary block" data-act="health-connect">${s.health ? "Read Apple Health now" : "Connect Apple Health"}</button>` : "";
  out += `<div class="card"><h2>Wearables</h2>${health}
    <p${Health ? ' style="margin-top:12px"' : ""}>WHOOP recovery scores come from WHOOP's data export: request it in the WHOOP app, unzip the file it sends, and choose physiological_cycles.csv (and workouts.csv if you like).</p>
    <label class="btn block" for="s-whoop">Import WHOOP files</label><input type="file" id="s-whoop" accept=".csv,text/csv" multiple hidden></div>`;
  out += `<div class="card"><h2>Reminders</h2><div class="form-grid"><div><label class="f" for="s-rm">Morning</label><input type="time" id="s-rm" value="${esc(s.reminders.morning)}"></div><div><label class="f" for="s-re">Evening</label><input type="time" id="s-re" value="${esc(s.reminders.evening)}"></div></div>
    <div style="margin-top:12px">${Notes ? `<button class="btn primary block" data-act="reminders-on">${s.remindersOn ? "Update reminders" : "Turn on reminders"}</button>${s.remindersOn ? `<button class="btn quiet block" data-act="reminders-off">Turn off</button>` : ""}` : `<button class="btn primary block" data-act="reminders-ics">Add to my calendar</button>`}</div></div>`;
  out += `<div class="card"><h2>Your data</h2><p>Everything stays on this phone. Save a backup now and then, and keep it somewhere safe.</p>
    <div class="actions"><button class="btn block" data-act="backup">Save a backup</button><label class="btn block" for="s-restore">Restore a backup</label><input type="file" id="s-restore" accept=".json,application/json" hidden><button class="btn block" data-act="csv">Download a spreadsheet</button><button class="btn quiet block danger" data-act="wipe">Delete everything</button></div></div>`;
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
async function readHealth(daysBack) {
  if (!Health || !S().health) return 0;
  try {
    const r = await Health.readDays({ from: shiftISO(todayISO(), -daysBack), to: todayISO() });
    const byDate = (r && r.days) || {}, clean = {};
    for (const [d, v] of Object.entries(byDate)) { const w = Object.assign({}, v); delete w.flow; clean[d] = w; }
    const n = store.mergeWearable(clean, "health");
    if (S().cycle.track) {
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
  const app = $("app"), s = S(), setup = !s.onboarded, inCheckin = ["morning", "evening", "checkin"].includes(ui.view);
  ui.dirty = false;
  let body;
  if (setup) body = viewSetup();
  else if (inCheckin) body = viewCheckin(ui.view);
  else body = { today: viewToday, calendar: viewCalendar, review: viewReview, settings: viewSettings }[ui.view]();
  const warn = store.ok ? "" : `<div class="banner rest">This browser isn't keeping data. On an iPhone, add the app to your home screen.</div>`;
  app.innerHTML = `<div class="topbar"><h1>POTS Tracker</h1></div>` + warn + body;
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
});
$("app").addEventListener("change", async e => {
  const id = e.target.id;
  if (id === "s-whoop" && e.target.files.length) {
    let n = 0;
    for (const f of e.target.files) {
      const text = await f.text(), kind = C.whoopFileKind(text);
      if (kind === "cycles") n += store.mergeWearable(C.parseWhoopCycles(text), "whoop");
      else if (kind === "workouts") { const w = C.parseWhoopWorkouts(text), byDate = {}; for (const [d, list] of Object.entries(w)) byDate[d] = { workouts: list }; n += store.mergeWearable(byDate, "whoop"); }
    }
    toast(n ? `Read ${n} ${n === 1 ? "day" : "days"} from WHOOP` : "No WHOOP days found in that file");
    render();
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
    if (box.classList.contains("seg")) { box.querySelectorAll("button").forEach(b => b.classList.remove("on")); chip.classList.add("on"); }
    else chip.classList.toggle("on");
    if (box.id === "e-sym") { const row = document.querySelector(`#e-sym-n [data-k="${chip.dataset.k}"]`); if (row) row.hidden = !chip.classList.contains("on"); }
    if (box.id === "o-cycle") $("o-cycle-more").hidden = chip.dataset.v !== "yes";
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
  else if (act === "setup-done") {
    const conditions = Array.from(document.querySelectorAll("#o-cond button.on")).map(x => x.dataset.v);
    const pem = segVal("o-pem") || "unsure", track = segVal("o-cycle") === "yes", start = v("o-start");
    const t = todayISO(), template = C.pickTemplate(conditions, pem);
    store.saveSettings(Object.assign({}, s, { onboarded: true, conditions, pem, cycle: { track, starts: isDate(start) ? [start] : [], length: 28 }, plan: C.newPlan(template, t) }));
    toast(`Your plan: ${TEMPLATES[template].label}`);
    ui.view = "today"; render();
    const due = dueCheckin(); if (due) openCheckin(due);
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
    P.steps = { open: num(v("p-steps-open")), session: num(v("p-steps-session")), rest: num(v("p-steps-rest")) };
    P.bedtime = v("p-bed") || ""; P.note = (v("p-note") || "").trim();
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
