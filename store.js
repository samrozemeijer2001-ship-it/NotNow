/* =========================================================
   Opslag + rekenwerk (gedeeld door schema en stats)
   Alles staat in localStorage op dit toestel.
   log[oefeningId][datum] = { kg:[per set], reps:[per set], done:[per set] }
   ========================================================= */
const Store = (function () {
  "use strict";

  const LOG_KEY = "casrc-log-v1";

  /* ---------- Datums (lokale tijd) ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay() + 6) % 7)); };
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const n = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - n);
    const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y) / 864e5 + 1) / 7);
  }
  /** datum van dag i (0 = maandag) in de huidige week */
  const dateOfWeekday = (i) => ymd(addDays(mondayOf(new Date()), i));

  /* ---------- Getallen ---------- */
  function parseKg(v) {
    const n = parseFloat(String(v).replace(",", ".").replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n >= 0 && n < 1000 ? Math.round(n * 100) / 100 : null;
  }
  const fmtKg = (n) => (Math.round(n * 10) / 10).toString().replace(".", ",");
  const numReps = (r) => (typeof r === "number" ? r : null);
  /** Geschatte 1RM (Epley). Bij tijd-oefeningen of onbekende reps: het gewicht zelf. */
  const strength = (kg, reps) => (kg > 0 ? (numReps(reps) ? kg * (1 + numReps(reps) / 30) : kg) : 0);

  /* ---------- Catalogus van oefeningen uit data.js ---------- */
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const catalog = {}; // id -> {id, name, groups, reps, logged, days:[]}

  /** Geeft elke regel in het schema een vaste id. Oefeningen met dezelfde naam delen hun geschiedenis. */
  function idFor(block, row) {
    if (block.type === "sets") return slug(row[0]);
    return row[4] ? slug(row[0]) : "li-" + slug(block.name) + "-" + slug(row[0]);
  }

  WEEK.forEach((d, di) => {
    (d.blocks || []).forEach((b) => {
      const rows = b.type === "sets" ? b.ex : b.items;
      rows.forEach((row) => {
        const id = idFor(b, row);
        const logged = b.type === "sets" || !!row[4];
        if (!catalog[id]) {
          catalog[id] = {
            id, name: row[0], logged,
            groups: (b.type === "sets" ? row[4] : row[3]) || [],
            reps: b.type === "sets" ? row[1] : [null],
            days: []
          };
        }
        if (!catalog[id].days.includes(di)) catalog[id].days.push(di);
      });
    });
  });

  /** aantal geplande vakjes per weekdag (voor aanwezigheid) */
  const plannedPerDay = WEEK.map((d) => (d.blocks || []).reduce((n, b) => n + (b.type === "sets" ? b.ex.reduce((m, e) => m + e[1].length, 0) : b.items.length), 0));

  /* ---------- Laden / opslaan ---------- */
  let log = {};
  try { log = JSON.parse(localStorage.getItem(LOG_KEY)) || {}; } catch (e) { log = {}; }

  function persist() {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); return true; }
    catch (e) { return false; }
  }

  function entry(id, date, create) {
    if (!log[id]) { if (!create) return null; log[id] = {}; }
    if (!log[id][date]) { if (!create) return null; log[id][date] = { kg: [], reps: [], done: [] }; }
    return log[id][date];
  }

  function cleanup(id, date) {
    const e = log[id] && log[id][date];
    if (!e) return;
    const any = e.kg.some((v) => v != null) || e.done.some(Boolean);
    if (!any) { delete log[id][date]; if (!Object.keys(log[id]).length) delete log[id]; }
  }

  /* ---------- Migratie van de vorige versie (week-vinkjes) ---------- */
  (function migrate() {
    try {
      Object.keys(localStorage).forEach((k) => {
        if (!/^casrc-\d{4}-w\d+$/.test(k)) return;
        const old = JSON.parse(localStorage.getItem(k)) || {};
        Object.keys(old).forEach((key) => {
          const m = key.match(/^([a-z]{2})-(\d+)-(\d+)(?:-(\d+))?(-kg)?$/);
          if (!m) return;
          const di = WEEK.findIndex((d) => d.key === m[1]);
          const b = di >= 0 && WEEK[di].blocks && WEEK[di].blocks[+m[2]];
          if (!b) return;
          const row = b.type === "sets" ? b.ex[+m[3]] : b.items[+m[3]];
          if (!row) return;
          const si = m[4] != null ? +m[4] : 0;
          const e = entry(idFor(b, row), dateOfWeekday(di), true);
          if (m[5]) { const kg = parseKg(old[key]); if (kg != null) { e.kg[si] = kg; e.reps[si] = b.type === "sets" ? row[1][si] : null; } }
          else if (old[key]) e.done[si] = 1;
        });
        localStorage.removeItem(k);
      });
      persist();
    } catch (e) {}
  })();

  /* ---------- Publieke functies ---------- */
  return {
    LOG_KEY, catalog, plannedPerDay, idFor,
    ymd, parseYmd, addDays, mondayOf, isoWeek, dateOfWeekday,
    parseKg, fmtKg, strength, numReps,

    get log() { return log; },

    isDone(id, date, si) { const e = entry(id, date); return !!(e && e.done[si]); },
    getKg(id, date, si) { const e = entry(id, date); return e && e.kg[si] != null ? e.kg[si] : null; },

    setDone(id, date, si, on) {
      const e = entry(id, date, true);
      if (on) e.done[si] = 1; else e.done[si] = 0;
      cleanup(id, date);
      return persist();
    },

    setKg(id, date, si, kg, reps) {
      const e = entry(id, date, true);
      e.kg[si] = kg; e.reps[si] = kg == null ? null : reps;
      cleanup(id, date);
      return persist();
    },

    /** vinkjes van één datum wissen (gewichten blijven) */
    clearDone(date) {
      Object.keys(log).forEach((id) => { const e = log[id][date]; if (e) { e.done = []; cleanup(id, date); } });
      return persist();
    },

    /** laatste eerdere sessie met gewicht */
    prevSession(id, date) {
      const days = log[id] ? Object.keys(log[id]).filter((d) => d < date && log[id][d].kg.some((v) => v > 0)).sort() : [];
      if (!days.length) return null;
      const d = days[days.length - 1];
      return { date: d, kg: log[id][d].kg };
    },

    /** zwaarste gewicht ooit vóór deze datum */
    bestBefore(id, date) {
      let best = 0;
      if (log[id]) Object.keys(log[id]).forEach((d) => { if (d < date) log[id][d].kg.forEach((v) => { if (v > best) best = v; }); });
      return best;
    },

    exportJson() { return JSON.stringify({ app: "casrc-training", version: 1, exported: new Date().toISOString(), log }, null, 1); },

    importJson(text) {
      const data = JSON.parse(text);
      if (!data || data.app !== "casrc-training" || typeof data.log !== "object") throw new Error("Dit is geen Cas RC back-up.");
      let n = 0;
      Object.keys(data.log).forEach((id) => {
        Object.keys(data.log[id] || {}).forEach((d) => {
          const e = data.log[id][d];
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !e || !Array.isArray(e.kg)) return;
          if (!log[id]) log[id] = {};
          log[id][d] = { kg: e.kg.map((v) => (typeof v === "number" ? v : null)), reps: Array.isArray(e.reps) ? e.reps : [], done: Array.isArray(e.done) ? e.done.map((v) => (v ? 1 : 0)) : [] };
          n++;
        });
      });
      if (!persist()) throw new Error("Opslaan is mislukt.");
      return n;
    }
  };
})();
