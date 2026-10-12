/* =========================================================
   Cas RC Trainingsweek — schema-weergave, navigatie en rusttimer
   Schema: data.js · Opslag/rekenwerk: store.js · Stats: stats.js
   ========================================================= */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const daysNav = $("daysNav");
  const daysEl = $("days");
  const main = $("main");
  const statsEl = $("stats");

  const yt = (q) => "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CHECK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10.5l4.5 4.5L17 5" fill="none" stroke="#1a1500" stroke-width="3"/></svg>';
  const { fmtKg, parseKg } = Store;

  /* ---------- Melding ---------- */
  const toast = $("toast");
  let toastT;
  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (toast.hidden = true), 4500);
  }
  window.showToast = showToast;

  let warned = false;
  function saved(ok) {
    if (!ok && !warned) { showToast("Opslaan lukt niet in deze browser (privémodus?). Je gegevens verdwijnen na herladen."); warned = true; }
  }

  /* ---------- Weergave + dag ---------- */
  const todayIdx = (new Date().getDay() + 6) % 7; // maandag = 0
  let sel = todayIdx;
  let view = "schema";

  function readHash() {
    const h = location.hash.slice(1);
    if (h === "stats") { view = "stats"; return; }
    const i = WEEK.findIndex((d) => d.key === h);
    view = "schema";
    if (i >= 0) sel = i;
  }

  function setHash(v) { try { history.replaceState(null, "", "#" + v); } catch (e) {} }

  function showView() {
    const stats = view === "stats";
    document.body.classList.toggle("is-stats", stats);
    $("tab-schema").setAttribute("aria-selected", !stats);
    $("tab-stats").setAttribute("aria-selected", stats);
    daysNav.hidden = stats;
    main.hidden = stats;
    statsEl.hidden = !stats;
    if (stats) Stats.render(statsEl);
    else { renderDays(); renderDay(); }
  }

  document.querySelector(".viewtabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (!b || b.dataset.view === view) return;
    view = b.dataset.view;
    setHash(view === "stats" ? "stats" : WEEK[sel].key);
    showView();
    window.scrollTo({ top: 0 });
  });

  window.addEventListener("hashchange", () => { readHash(); showView(); });

  function renderDays() {
    daysEl.innerHTML = WEEK.map((d, i) => {
      const cls = ["day"];
      if (d.rest && !d.active) cls.push("rest");
      if (i === todayIdx) cls.push("today");
      return `<button type="button" role="tab" class="${cls.join(" ")}" aria-selected="${i === sel}" aria-label="${d.long}: ${d.title}" data-i="${i}"><b>${d.short}</b><span>${d.tag}</span></button>`;
    }).join("");
  }

  daysEl.addEventListener("click", (e) => {
    const b = e.target.closest(".day");
    if (!b) return;
    sel = +b.dataset.i;
    setHash(WEEK[sel].key);
    renderDays();
    renderDay();
    window.scrollTo({ top: 0 });
  });

  /* ---------- Vergelijking met vorige keer ---------- */
  /** tekst + klasse voor de regel onder een kg-vakje */
  function compareHtml(id, date, si, kg) {
    const prev = Store.prevSession(id, date);
    const pkg = prev ? (prev.kg[si] != null ? prev.kg[si] : Math.max(0, ...prev.kg.filter((v) => v != null))) : null;
    if (kg == null) {
      if (pkg == null || !prev) return "";
      return `<button type="button" class="fill" data-fill="${pkg}" aria-label="Vul vorige keer in: ${fmtKg(pkg)} kg">vorig <b>${fmtKg(pkg)}</b></button>`;
    }
    const best = Store.bestBefore(id, date);
    const pr = best > 0 && kg > best;
    if (pkg == null || !prev) return `<span class="cmp-txt">eerste keer</span>`;
    const diff = Math.round((kg - pkg) * 10) / 10;
    const cls = diff > 0 ? "up" : diff < 0 ? "down" : "";
    const txt = diff === 0 ? "gelijk" : (diff > 0 ? "+" : "−") + fmtKg(Math.abs(diff));
    return `<span class="cmp-txt ${cls}">${pr ? '<i class="pr">PR</i>' : ""}${txt}<small> vs ${fmtKg(pkg)}</small></span>`;
  }

  /* ---------- Dag tekenen ---------- */
  const footer = () =>
    `<footer>Schema TeamBuildr · ${SCHEMA_WEEK}<br>Je gegevens staan alleen op dit toestel. Maak af en toe een back-up via Stats.</footer>`;

  function renderDay() {
    const d = WEEK[sel];
    const date = Store.dateOfWeekday(sel);
    const dateTxt = Store.parseYmd(date).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
    let h = `<div class="dayhead"><div class="kicker">${d.long} ${dateTxt}${sel === todayIdx ? " · vandaag" : ""}</div><h2>${esc(d.title)}</h2>`;

    if (d.rest) {
      h += `</div><div class="restcard"><p>${esc(d.text)}</p><ul>${d.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
      main.innerHTML = h + footer();
      return;
    }

    h += `<div class="progress"><div class="bar"><i id="pbar"></i></div><span id="ptext"></span></div></div>`;

    d.blocks.forEach((b) => {
      h += `<section class="section"><div class="sechead"><div class="letter" aria-hidden="true">${b.letter}</div><div class="secname"><strong>${esc(b.name)}</strong><small>${esc(b.sub)}</small></div></div>`;

      if (b.type === "list") {
        if (b.intro) h += `<p class="intro">${esc(b.intro)}</p>`;
        h += `<div class="list">` + b.items.map((it) => {
          const id = Store.idFor(b, it);
          const on = Store.isDone(id, date, 0);
          let logRow = "";
          if (it[4]) {
            const kg = Store.getKg(id, date, 0);
            logRow = `<div class="it-log" data-id="${id}" data-si="0" data-reps="">
              <input id="kg-${id}-${date}" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" placeholder="kg" value="${kg != null ? fmtKg(kg) : ""}" aria-label="Zwaarste set ${esc(it[0])} in kg">
              <span class="cmp">${compareHtml(id, date, 0, kg)}</span></div>`;
          }
          return `<div class="item${on ? " done" : ""}" data-id="${id}" data-si="0">
            <button type="button" class="tick" aria-pressed="${on}" aria-label="${esc(it[0])} afvinken">${CHECK}</button>
            <div class="it-name">${esc(it[0])}${it[1] ? `<span class="it-dose">${esc(it[1])}</span>` : ""}${logRow}</div>
            <a class="how" href="${yt(it[2])}" target="_blank" rel="noopener">Uitleg</a>
          </div>`;
        }).join("") + `</div>`;
      } else {
        b.ex.forEach((ex) => {
          const id = Store.idFor(b, ex);
          h += `<div class="ex"><div class="extop"><div class="exname"><h3>${esc(ex[0])}</h3>${ex[2] ? `<p class="note">${esc(ex[2])}</p>` : ""}</div><a class="how" href="${yt(ex[3])}" target="_blank" rel="noopener">Uitleg</a></div><div class="sets">`;
          ex[1].forEach((r, si) => {
            const on = Store.isDone(id, date, si);
            const kg = Store.getKg(id, date, si);
            h += `<div class="set${on ? " done" : ""}" data-id="${id}" data-si="${si}" data-reps="${r}">
              <button type="button" class="set-btn" aria-pressed="${on}" aria-label="Set ${si + 1} van ${esc(ex[0])}: ${r}"><span class="sl">Set ${si + 1}</span><span class="rp">${r}</span></button>
              <input id="kg-${id}-${si}-${date}" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" placeholder="kg" value="${kg != null ? fmtKg(kg) : ""}" aria-label="Gewicht set ${si + 1} ${esc(ex[0])}">
              <span class="cmp">${compareHtml(id, date, si, kg)}</span>
            </div>`;
          });
          h += `</div></div>`;
        });
      }
      h += `</section>`;
    });

    h += `<button type="button" class="reset" id="reset">Wis vinkjes van ${d.long.toLowerCase()}</button>`;
    main.innerHTML = h + footer();
    updateProgress();
  }

  function updateProgress() {
    const all = main.querySelectorAll(".set, .item").length;
    if (!all) return;
    const done = main.querySelectorAll(".set.done, .item.done").length;
    $("pbar").style.width = (done / all) * 100 + "%";
    $("ptext").textContent = done + "/" + all;
  }

  /* ---------- Interactie ---------- */
  function boxOf(el) { return el.closest(".it-log") || el.closest("[data-id]"); }

  function commitKg(input) {
    const box = boxOf(input);
    const id = box.dataset.id, si = +box.dataset.si;
    const repsRaw = box.dataset.reps;
    const reps = repsRaw === "" ? null : (isNaN(+repsRaw) ? repsRaw : +repsRaw);
    const date = Store.dateOfWeekday(sel);
    const kg = input.value.trim() === "" ? null : parseKg(input.value);
    input.classList.toggle("bad", input.value.trim() !== "" && kg == null);
    if (input.value.trim() !== "" && kg == null) return;
    saved(Store.setKg(id, date, si, kg, reps));
    box.querySelector(".cmp").innerHTML = compareHtml(id, date, si, kg);
  }

  main.addEventListener("click", (e) => {
    const fill = e.target.closest(".fill");
    if (fill) {
      const input = boxOf(fill).querySelector("input");
      input.value = fmtKg(+fill.dataset.fill);
      commitKg(input);
      return;
    }

    const btn = e.target.closest(".set-btn, .tick");
    if (btn) {
      unlockAudio();
      const box = btn.closest("[data-id]");
      const id = box.dataset.id, si = +box.dataset.si;
      const date = Store.dateOfWeekday(sel);
      const on = !Store.isDone(id, date, si);
      saved(Store.setDone(id, date, si, on));
      box.classList.toggle("done", on);
      btn.setAttribute("aria-pressed", on);
      updateProgress();
      if (on && box.classList.contains("set")) startTimer(90);
      return;
    }

    const r = e.target.closest("#reset");
    if (r) {
      const label = "Wis vinkjes van " + WEEK[sel].long.toLowerCase();
      if (!r.classList.contains("arm")) {
        r.classList.add("arm");
        r.textContent = "Tik nog een keer. Gewichten blijven bewaard";
        setTimeout(() => { if (r.isConnected) { r.classList.remove("arm"); r.textContent = label; } }, 3500);
        return;
      }
      saved(Store.clearDone(Store.dateOfWeekday(sel)));
      renderDay();
      showToast("Vinkjes van " + WEEK[sel].long.toLowerCase() + " gewist.");
    }
  });

  main.addEventListener("input", (e) => { if (e.target.matches("input")) commitKg(e.target); });
  main.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input")) e.target.blur(); });

  /* ---------- Rusttimer ---------- */
  const timerEl = $("timer");
  const clock = $("clock");
  let end = 0, tick = null, wake = null, audio = null;

  const fmt = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");

  // iOS laat geluid alleen toe na een tik: audio wordt bij de eerste tik ontgrendeld
  function unlockAudio() {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
    } catch (e) {}
  }

  function beep() {
    try {
      if (audio) {
        [0, 0.25, 0.5].forEach((t) => {
          const o = audio.createOscillator();
          const g = audio.createGain();
          o.frequency.value = 880;
          g.gain.value = 0.25;
          o.connect(g).connect(audio.destination);
          o.start(audio.currentTime + t);
          o.stop(audio.currentTime + t + 0.15);
        });
      }
    } catch (e) {}
    try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {}
  }

  async function keepAwake() {
    try { if ("wakeLock" in navigator && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => (wake = null)); } } catch (e) {}
  }

  function startTimer(s) {
    unlockAudio();
    end = Date.now() + s * 1000;
    timerEl.classList.add("running");
    timerEl.classList.remove("finished");
    clearInterval(tick);
    tick = setInterval(run, 250);
    run();
    keepAwake();
  }

  function run() {
    const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    clock.textContent = fmt(left);
    if (left === 0) stopTimer(true);
  }

  function stopTimer(finished) {
    clearInterval(tick);
    tick = null;
    timerEl.classList.remove("running");
    if (finished) { timerEl.classList.add("finished"); beep(); }
    else { timerEl.classList.remove("finished"); clock.textContent = "0:00"; }
  }

  timerEl.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "stop") stopTimer(false); else startTimer(+b.dataset.s);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && tick) { run(); keepAwake(); }
  });

  /* ---------- Start ---------- */
  readHash();
  showView();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
  }
})();
