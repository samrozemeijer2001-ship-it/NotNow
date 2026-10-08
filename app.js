/* =========================================================
   Thought Cards — prototype app logic (vanilla JS, no build)

   Sections
    1. Config           7. Rendering: Thought Bank
    2. Utilities        8. Capture
    3. Storage          9. Gestures (swipe)
    4. State & model   10. Sheets
    5. Cleanup         11. Reminders
    6. Navigation      12. Locations
                       13. Speech
                       14. Settings
                       15. Feedback (toast, nudge)
                       16. Events & init
   ========================================================= */

/* Turn this off after testing: demo thoughts are only added
   when this browser has never stored any thoughts before. */
const USE_DEMO_DATA = true;

/* Address of your reminder server (the Cloudflare Worker), without a trailing slash.
   Example: 'https://thought-cards-push.yourname.workers.dev'
   Leave empty to use in-app reminders only. */
const PUSH_SERVER_URL = 'https://thought-cards-push.samrozemeijer2001.workers.dev';

(() => {
  'use strict';

  /* ===================== 1. CONFIG ===================== */
  const APP_VERSION = '1.0.0';
  const KEYS = {
    thoughts: 'thoughtCards.thoughts',
    settings: 'thoughtCards.settings',
    places: 'thoughtCards.places',
    draft: 'thoughtCards.draft',
    intro: 'thoughtCards.introPlayed', // sessionStorage
    device: 'thoughtCards.device',
    vapidKey: 'thoughtCards.serverKey',
    pushServer: 'thoughtCards.pushServer', // optional override for testing
  };
  const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const WEEKDAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  const defaultRecap = () => ({
    enabled: true,
    days: Object.fromEntries(WEEKDAYS.map((d) => [d, { on: true, time: '21:00' }])),
  });
  const DEFAULT_SETTINGS = { notifications: true, speechLang: 'en-US', darkMode: false, recap: defaultRecap() };
  const SPEECH_LANGS = { 'en-US': 'English', 'nl-NL': 'Nederlands' };
  const SWIPE_MIN_PX = 100;
  const SWIPE_RATIO = 0.3;
  const VOICE_UNSUPPORTED = 'Voice capture isn’t supported in this browser yet. You can still type your thought.';

  // Example places for this prototype (no real geocoding).
  const PRESET_PLACES = [
    { id: 'home', icon: 'home', title: 'When I get home', sub: '221B Baker St', name: 'Home', label: 'At home', address: '221B Baker St', latitude: 51.5238, longitude: -0.1586 },
    { id: 'office', icon: 'briefcase', title: 'At the office', sub: 'Studio HQ', name: 'Office', label: 'At the office', address: 'Studio HQ', latitude: 51.5246, longitude: -0.0877 },
    { id: 'laundromat', icon: 'navigation', title: 'Near a laundromat', sub: '3 places nearby', name: 'Laundromat', label: 'Near a laundromat', address: 'Any laundromat nearby', latitude: null, longitude: null },
  ];
  const SAMPLE_PLACES = [
    { id: 'p-sudsy', name: 'Sudsy Corner Laundry', meta: '0.3 km · Open now', latitude: 51.5226, longitude: -0.1571 },
    { id: 'p-mom', name: 'Mom’s House', meta: '2.1 km · Camden', latitude: 51.5390, longitude: -0.1426 },
    { id: 'p-regent', name: 'Regent St Cleaners', meta: '0.8 km · Closes 8 PM', latitude: 51.5136, longitude: -0.1400 },
    { id: 'p-studio', name: 'The Studio', meta: '1.4 km · Workspace', latitude: 51.5246, longitude: -0.0877 },
  ];

  const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const reducedMotion = () => motionQuery.matches;

  /* ===================== 2. UTILITIES ===================== */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const pad = (n) => String(n).padStart(2, '0');
  const nowIso = () => new Date().toISOString();

  function uid() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 't-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  /** Local calendar day as YYYY-MM-DD (never UTC). */
  function localDateKey(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  function dateFromKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(date, n) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + n);
    return copy;
  }
  const isValidIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
  const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  const toNumberOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const toStringOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  /** "08:00" → "8:00 AM" */
  function formatTime(time24) {
    const [h, m] = time24.split(':').map(Number);
    return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
  }
  function dayLabel(key) {
    const today = new Date();
    if (key === localDateKey(today)) return 'Today';
    if (key === localDateKey(addDays(today, 1))) return 'Tomorrow';
    if (key === localDateKey(addDays(today, -1))) return 'Yesterday';
    return dateFromKey(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  /** Relative reminder text used in the Thought Bank, e.g. "Tomorrow · 9:00 AM" */
  function reminderLabel(reminder) {
    if (!reminder || !reminder.enabled) return '';
    return `${dayLabel(reminder.date)} · ${formatTime(reminder.time)}`;
  }
  /** Text for the dark chip on the capture card, e.g. "At 8:00 AM" */
  function reminderChipText(reminder) {
    if (!reminder) return '';
    const day = dayLabel(reminder.date);
    return day === 'Today' ? `At ${formatTime(reminder.time)}` : `${day} at ${formatTime(reminder.time)}`;
  }
  function capturedLabel(iso) {
    const d = new Date(iso);
    const t = formatTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    return `Captured ${dayLabel(localDateKey(d))} · ${t}`;
  }
  function reminderDate(reminder) {
    if (!reminder || !reminder.enabled || !isDateKey(reminder.date) || !isTime(reminder.time)) return null;
    const [h, m] = reminder.time.split(':').map(Number);
    const d = dateFromKey(reminder.date);
    d.setHours(h, m, 0, 0);
    return d;
  }

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (_) { /* not supported */ }
  }

  /** Small safe DOM builder: user text is always set via textContent. */
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key.startsWith('aria-') || key === 'role') { node.setAttribute(key, String(value)); continue; }
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'type') node.setAttribute('type', value);
      else node[key] = value;
    }
    for (const child of [].concat(children)) {
      if (child == null || child === false) continue;
      node.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function icon(name, extraClass = '') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', `icon ${extraClass}`.trim());
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }
  function restartAnimation(node, className) {
    if (!node) return;
    node.classList.remove(className);
    void node.offsetWidth; // reflow so the animation can play again
    node.classList.add(className);
    node.addEventListener('animationend', () => node.classList.remove(className), { once: true });
  }
  function hexToRgb(hex) {
    const clean = hex.trim().replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    const num = parseInt(full, 16);
    if (Number.isNaN(num)) return [245, 154, 0];
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  /* ===================== 3. STORAGE ===================== */
  let storageWarned = false;
  const storage = {
    has(key) {
      try { return localStorage.getItem(key) !== null; } catch (_) { return false; }
    },
    read(key, fallback) {
      let raw = null;
      try { raw = localStorage.getItem(key); } catch (_) { return fallback; }
      if (raw === null) return fallback;
      try { return JSON.parse(raw); } catch (err) {
        console.warn('[Thought Cards] Stored data was unreadable, keeping a backup:', key, err);
        try { localStorage.setItem(`${key}.backup-${Date.now()}`, raw); } catch (_) { /* ignore */ }
        return fallback;
      }
    },
    write(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (err) {
        console.warn('[Thought Cards] Could not save', key, err);
        if (!storageWarned) {
          storageWarned = true;
          toast('This browser won’t let me save right now, so thoughts may not stay after closing.', { duration: 4600, icon: 'info', tone: 'info' });
        }
        return false;
      }
    },
    remove(key) { try { localStorage.removeItem(key); } catch (_) { /* ignore */ } },
  };
  const session = {
    get(key) { try { return sessionStorage.getItem(key); } catch (_) { return null; } },
    set(key, val) { try { sessionStorage.setItem(key, val); } catch (_) { /* ignore */ } },
  };

  /* ===================== 4. STATE & MODEL ===================== */
  const state = {
    thoughts: [],
    settings: { ...DEFAULT_SETTINGS },
    places: [],
    screen: null,
    query: '',
    expandedId: null,
    draft: emptyDraft(),
    pendingDeleteId: null,
    reminderDraft: { time: '08:00', day: 'today' },
    reminderTarget: null, // null = capture draft, otherwise a thought id
    placeDraft: { query: '', selectedId: null, current: null },
    sheet: null,
    capturing: false, // true while a card is flying away
  };

  function emptyDraft() {
    return { text: '', isImportant: false, reminder: null, location: null, source: 'text' };
  }
  function emptyReminder() {
    return { enabled: false, date: null, time: null, displayText: null, notifiedAt: null };
  }
  function emptyLocation() {
    return { enabled: false, name: null, label: null, address: null, latitude: null, longitude: null };
  }

  /** Migration / normalisation: any stored shape becomes a complete thought (or null). */
  function normalizeThought(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (!text) return null;
    const createdAt = isValidIso(raw.createdAt) ? raw.createdAt : nowIso();
    const isCompleted = raw.isCompleted === true;

    const r = raw.reminder && typeof raw.reminder === 'object' ? raw.reminder : {};
    const reminderOk = r.enabled !== false && isDateKey(r.date) && isTime(r.time);
    const reminder = reminderOk
      ? {
          enabled: true,
          date: r.date,
          time: r.time,
          displayText: toStringOrNull(r.displayText) || reminderChipText({ date: r.date, time: r.time }),
          notifiedAt: isValidIso(r.notifiedAt) ? r.notifiedAt : null,
        }
      : emptyReminder();

    const l = raw.location && typeof raw.location === 'object' ? raw.location : {};
    const locName = toStringOrNull(l.name);
    const location = l.enabled !== false && locName
      ? {
          enabled: true,
          name: locName,
          label: toStringOrNull(l.label) || `At ${locName}`,
          address: toStringOrNull(l.address),
          latitude: toNumberOrNull(l.latitude),
          longitude: toNumberOrNull(l.longitude),
        }
      : emptyLocation();

    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
      text,
      createdAt,
      updatedAt: isValidIso(raw.updatedAt) ? raw.updatedAt : createdAt,
      isImportant: raw.isImportant === true,
      isCompleted,
      // A completed thought without a date stays visible today, then follows the cleanup rule.
      completedAt: isCompleted ? (isValidIso(raw.completedAt) ? raw.completedAt : nowIso()) : null,
      source: raw.source === 'voice' ? 'voice' : 'text',
      reminder,
      location,
    };
  }

  function normalizeThoughtList(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const t = normalizeThought(item);
      if (!t) continue;
      if (seen.has(t.id)) t.id = uid();
      seen.add(t.id);
      out.push(t);
    }
    return out;
  }

  function normalizeSettings(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
      notifications: typeof s.notifications === 'boolean' ? s.notifications : DEFAULT_SETTINGS.notifications,
      speechLang: SPEECH_LANGS[s.speechLang] ? s.speechLang : DEFAULT_SETTINGS.speechLang,
      darkMode: s.darkMode === true,
      recap: normalizeRecap(s.recap),
    };
  }

  function normalizeRecap(raw) {
    const base = defaultRecap();
    if (!raw || typeof raw !== 'object') return base;
    const days = {};
    for (const key of WEEKDAYS) {
      const d = raw.days && raw.days[key];
      days[key] = {
        on: d && typeof d.on === 'boolean' ? d.on : base.days[key].on,
        time: d && isTime(d.time) ? d.time : base.days[key].time,
      };
    }
    return { enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled, days };
  }

  function normalizePlaces(raw) {
    if (!Array.isArray(raw)) return SAMPLE_PLACES.map((p) => ({ ...p }));
    return raw
      .filter((p) => p && typeof p === 'object' && toStringOrNull(p.name))
      .map((p) => ({
        id: typeof p.id === 'string' && p.id ? p.id : uid(),
        name: p.name.trim(),
        meta: toStringOrNull(p.meta) || 'Saved place',
        latitude: toNumberOrNull(p.latitude),
        longitude: toNumberOrNull(p.longitude),
      }));
  }

  function createDemoThoughts() {
    const now = new Date();
    const minutesAgo = (m) => new Date(now.getTime() - m * 60000).toISOString();
    const tomorrow = localDateKey(addDays(now, 1));
    const tenThirty = new Date(now);
    tenThirty.setHours(10, 30, 0, 0);
    if (tenThirty > now) tenThirty.setTime(now.getTime() - 25 * 60000);
    return normalizeThoughtList([
      { text: 'Call the studio about the new project', isImportant: true, createdAt: minutesAgo(140), reminder: { enabled: true, date: tomorrow, time: '09:00' } },
      { text: 'Cancel the free trial before Friday', isImportant: true, source: 'voice', createdAt: tenThirty.toISOString(), reminder: { enabled: true, date: tomorrow, time: '18:00' } },
      { text: 'That book title a friend mentioned', createdAt: minutesAgo(60 * 20) },
      { text: 'Pick up oat milk & coffee filters', createdAt: minutesAgo(60 * 26), location: { enabled: true, name: 'Grocery', label: 'At the grocery', address: 'Corner market' } },
      { text: 'Water the plants when I’m back', createdAt: minutesAgo(60 * 50), location: { enabled: true, name: 'Home', label: 'At home', address: '221B Baker St' } },
    ]);
  }

  function loadThoughts() {
    const exists = storage.has(KEYS.thoughts);
    if (!exists) {
      state.thoughts = USE_DEMO_DATA ? createDemoThoughts() : [];
      if (USE_DEMO_DATA) saveThoughts();
      return;
    }
    state.thoughts = normalizeThoughtList(storage.read(KEYS.thoughts, []));
  }
  // Every save also queues a quiet sync to the reminder server (when lock screen alerts are on).
  const saveThoughts = () => { const ok = storage.write(KEYS.thoughts, state.thoughts); scheduleSync(); return ok; };
  const savePlaces = () => storage.write(KEYS.places, state.places);
  const saveSettings = () => { const ok = storage.write(KEYS.settings, state.settings); scheduleSync(); return ok; };
  const findThought = (id) => state.thoughts.find((t) => t.id === id);

  /* ===================== 5. CLEANUP ===================== */
  /**
   * Done thoughts stay visible for the rest of the day they were completed.
   * From the next local calendar day on, they are removed for good.
   * Compares local calendar dates (YYYY-MM-DD), not 24-hour windows.
   * Returns the number of removed thoughts.
   */
  function cleanupCompletedThoughtsFromPreviousDays() {
    const today = localDateKey(new Date());
    const before = state.thoughts.length;
    state.thoughts = state.thoughts.filter((t) => {
      if (!t.isCompleted || !t.completedAt || !isValidIso(t.completedAt)) return true;
      return localDateKey(new Date(t.completedAt)) >= today;
    });
    const removed = before - state.thoughts.length;
    if (removed > 0) {
      if (state.expandedId && !findThought(state.expandedId)) state.expandedId = null;
      saveThoughts();
    }
    return removed;
  }

  /** Runs on focus / visibilitychange / bfcache restore: re-read storage, clean up, refresh. */
  function onReturnToApp() {
    const before = JSON.stringify(state.thoughts);
    if (storage.has(KEYS.thoughts)) state.thoughts = normalizeThoughtList(storage.read(KEYS.thoughts, []));
    cleanupCompletedThoughtsFromPreviousDays();
    if (state.screen === 'bank' && JSON.stringify(state.thoughts) !== before) renderBank({ flip: true });
    updateGreeting();
    checkDueReminders();
    if (document.visibilityState === 'visible') verifyPush();
  }

  /* ===================== 6. NAVIGATION ===================== */
  const screens = { bank: $('#screen-bank'), capture: $('#screen-capture'), settings: $('#screen-settings') };

  function navigate(name, { initial = false } = {}) {
    if (!screens[name]) return;
    if (name === state.screen && !initial) return;
    if (state.sheet) closeSheet({ immediate: true });
    if (document.activeElement && document.activeElement.blur && name !== 'capture') document.activeElement.blur();

    state.screen = name;
    document.body.dataset.screen = name;
    for (const [key, node] of Object.entries(screens)) {
      const active = key === name;
      node.classList.toggle('is-active', active);
      node.inert = !active;
      node.setAttribute('aria-hidden', String(!active));
    }
    $$('.tab[data-nav]').forEach((tab) => {
      const active = tab.dataset.nav === name;
      tab.classList.toggle('is-active', active);
      if (active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });

    if (name === 'bank') {
      state.expandedId = null;
      updateGreeting();
      renderBank({ stagger: !initial });
      screens.bank.scrollTop = 0;
    }
    if (name === 'settings') renderSettings();
    if (name === 'capture') updateCaptureUI();
    updateThemeColor();
  }

  function updateThemeColor() {
    const meta = $('meta[name="theme-color"]');
    if (!meta) return;
    const color = cssVar(state.screen === 'bank' ? '--bg-bank' : '--bg-capture');
    if (color) meta.setAttribute('content', color);
  }

  /* ===================== 7. RENDERING: THOUGHT BANK ===================== */
  const bankList = $('#bank-list');

  function updateGreeting() {
    const h = new Date().getHours();
    const text = h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 18 ? 'Good afternoon' : 'Good evening';
    $('#greeting-text').textContent = text;
  }

  /** Important first, then newest; done thoughts sink below the open ones. */
  function getSortedThoughts() {
    const byNewest = (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
    const open = state.thoughts.filter((t) => !t.isCompleted);
    const done = state.thoughts.filter((t) => t.isCompleted)
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
    return [
      ...open.filter((t) => t.isImportant).sort(byNewest),
      ...open.filter((t) => !t.isImportant).sort(byNewest),
      ...done,
    ];
  }

  function matchesQuery(t, q) {
    if (!q) return true;
    const haystack = [
      t.text,
      t.reminder.enabled ? t.reminder.displayText : '',
      t.reminder.enabled ? reminderLabel(t.reminder) : '',
      t.location.enabled ? t.location.name : '',
      t.location.enabled ? t.location.label : '',
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  }

  /** Stable visual variant: side + tone by position (gives the zig-zag), width by id. */
  function variantFor(thought, index) {
    const widths = [80, 84, 88];
    return {
      side: index % 2 === 0 ? 'left' : 'right',
      tone: index % 2 === 0 ? 'paper' : 'sky',
      width: widths[hashString(thought.id) % widths.length],
    };
  }

  function buildBadge() {
    return el('span', { class: 'tcard__badge', 'aria-hidden': 'true' }, [icon('star', 'icon--fill')]);
  }

  function buildCard(t, index, { entering = false } = {}) {
    const v = variantFor(t, index);
    const expanded = state.expandedId === t.id;
    const card = el('article', {
      class: `tcard tcard--${v.side} tcard--${v.tone}`,
      role: 'listitem',
      dataset: { id: t.id },
    });
    card.style.setProperty('--w', `${v.width}%`);
    card.classList.toggle('is-important', t.isImportant);
    card.classList.toggle('is-completed', t.isCompleted);
    card.classList.toggle('is-expanded', expanded);
    if (entering) {
      card.classList.add('is-entering');
      card.style.setProperty('--i', String(Math.min(index, 10)));
      card.addEventListener('animationend', (e) => {
        if (e.animationName === 'tc-rise' || e.animationName === 'tc-fade') card.classList.remove('is-entering');
      });
    }

    card.append(el('span', { class: 'tcard__shine', 'aria-hidden': 'true' }));
    if (t.isImportant) card.append(buildBadge());

    // Summary (tap target)
    const textEl = el('span', { class: 'tcard__text' }, [
      el('span', { class: 'tcard__star', 'aria-hidden': 'true' }, [icon('star', 'icon--fill')]),
      t.text,
    ]);
    const meta = el('span', { class: 'tcard__meta' });
    if (t.reminder.enabled) meta.append(el('span', { class: 'tcard__meta-item' }, [icon('clock'), reminderLabel(t.reminder)]));
    if (t.location.enabled) meta.append(el('span', { class: 'tcard__meta-item' }, [icon('pin'), t.location.name]));
    const status = [t.isImportant ? 'Important.' : '', t.isCompleted ? 'Done today.' : ''].join(' ').trim();
    const summary = el('button', {
      class: 'tcard__summary',
      type: 'button',
      'aria-expanded': String(expanded),
      dataset: { action: 'toggle-card', id: t.id },
    }, [
      textEl,
      el('span', { class: 'tcard__meta-wrap' }, [meta]),
      status ? el('span', { class: 'sr-only', text: ` ${status}` }) : null,
    ]);
    card.append(summary);
    card.append(el('span', { class: 'tcard__keep', 'aria-hidden': 'true' }, [icon('thumb', 'icon--fill')]));

    // Details (revealed when expanded)
    const chips = el('div', { class: 'tcard__chips' });
    if (t.reminder.enabled) chips.append(el('span', { class: 'mini-chip' }, [icon('clock'), el('span', { text: reminderLabel(t.reminder) })]));
    if (t.location.enabled) chips.append(el('span', { class: 'mini-chip' }, [icon('pin'), el('span', { text: t.location.label })]));

    const actions = el('div', { class: 'tcard__actions' }, [
      t.isCompleted
        ? el('button', { class: 'card-action', type: 'button', dataset: { action: 'undo', id: t.id } }, [icon('undo'), 'Undo'])
        : el('button', { class: 'card-action', type: 'button', dataset: { action: 'done', id: t.id } }, [icon('check'), 'Done']),
      el('button', { class: 'card-action', type: 'button', 'aria-pressed': String(t.isImportant), dataset: { action: 'pin', id: t.id } },
        [icon('star', t.isImportant ? 'icon--fill' : ''), t.isImportant ? 'Unpin' : 'Pin']),
      el('button', {
        class: `card-action card-action--icon${t.reminder.enabled ? ' is-set' : ''}`,
        type: 'button',
        'aria-label': t.reminder.enabled ? 'Change reminder' : 'Set a reminder',
        dataset: { action: 'remind-card', id: t.id },
      }, [icon('clock')]),
      el('button', { class: 'card-action card-action--icon', type: 'button', 'aria-label': 'Let this thought go', dataset: { action: 'delete', id: t.id } }, [icon('trash')]),
    ]);

    const details = el('div', { class: 'tcard__details' }, [
      el('div', { class: 'tcard__details-inner' }, [
        el('div', { class: 'tcard__details-pad' }, [
          el('p', { class: 'tcard__captured' }, [icon(t.source === 'voice' ? 'mic' : 'pencil'), capturedLabel(t.createdAt)]),
          chips,
          actions,
        ]),
      ]),
    ]);
    details.inert = !expanded;
    card.append(details);
    return card;
  }

  function snapshotPositions() {
    const map = new Map();
    $$('.tcard', bankList).forEach((c) => map.set(c.dataset.id, c.getBoundingClientRect()));
    return map;
  }

  /** FLIP: cards glide from their old position to the new one instead of jumping. */
  function playFlip(before) {
    if (reducedMotion() || !before) return;
    $$('.tcard', bankList).forEach((card) => {
      const prev = before.get(card.dataset.id);
      const next = card.getBoundingClientRect();
      if (!prev) {
        card.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
        return;
      }
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      card.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: 480, easing: 'cubic-bezier(.22,1,.36,1)' }
      );
    });
  }

  function renderBank({ stagger = false, flip = false } = {}) {
    cleanupCompletedThoughtsFromPreviousDays();
    const before = flip ? snapshotPositions() : null;
    const all = getSortedThoughts();
    const q = state.query.trim().toLowerCase();
    const shown = all.filter((t) => matchesQuery(t, q));
    if (state.expandedId && !shown.some((t) => t.id === state.expandedId)) state.expandedId = null;

    const frag = document.createDocumentFragment();
    shown.forEach((t, i) => frag.append(buildCard(t, i, { entering: stagger })));
    bankList.replaceChildren(frag);

    $('#bank-empty').hidden = all.length !== 0;
    $('#bank-noresults').hidden = !(all.length > 0 && shown.length === 0);
    if (before) playFlip(before);
  }

  const cardEl = (id) => bankList.querySelector(`.tcard[data-id="${CSS.escape(id)}"]`);

  function setExpanded(id) {
    state.expandedId = id;
    $$('.tcard', bankList).forEach((card) => {
      const open = card.dataset.id === id;
      card.classList.toggle('is-expanded', open);
      const summary = $('.tcard__summary', card);
      if (summary) summary.setAttribute('aria-expanded', String(open));
      const details = $('.tcard__details', card);
      if (details) details.inert = !open;
    });
  }

  function toggleCard(id) {
    const next = state.expandedId === id ? null : id;
    setExpanded(next);
    if (next) {
      const card = cardEl(next);
      setTimeout(() => {
        if (card && card.isConnected) card.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      }, 340);
    }
  }

  function completeThought(id) {
    const t = findThought(id);
    if (!t || t.isCompleted) return;
    t.isCompleted = true;
    t.completedAt = nowIso();
    t.updatedAt = t.completedAt;
    saveThoughts();
    vibrate(15);

    const card = cardEl(id);
    state.expandedId = null;
    if (card) {
      setExpanded(null);
      card.classList.add('is-completed', 'is-celebrating');
    }
    // Let the green glow play, then let the card settle below the open thoughts.
    setTimeout(() => renderBank({ flip: true }), reducedMotion() ? 250 : 900);
  }

  function undoComplete(id) {
    const t = findThought(id);
    if (!t) return;
    t.isCompleted = false;
    t.completedAt = null;
    t.updatedAt = nowIso();
    saveThoughts();
    renderBank({ flip: true });
  }

  function togglePin(id) {
    const t = findThought(id);
    if (!t) return;
    t.isImportant = !t.isImportant;
    t.updatedAt = nowIso();
    saveThoughts();

    const card = cardEl(id);
    if (card) {
      card.classList.toggle('is-important', t.isImportant);
      const pinBtn = card.querySelector('[data-action="pin"]');
      if (pinBtn) {
        pinBtn.replaceChildren(icon('star', t.isImportant ? 'icon--fill' : ''), t.isImportant ? 'Unpin' : 'Pin');
        pinBtn.setAttribute('aria-pressed', String(t.isImportant));
      }
      let badge = card.querySelector('.tcard__badge');
      if (t.isImportant) {
        if (!badge) { badge = buildBadge(); card.prepend(badge); }
        restartAnimation(badge, 'pop');
        restartAnimation(card.querySelector('.tcard__star'), 'pop');
        vibrate(12);
      } else if (badge) {
        badge.classList.add('is-out');
      }
    }
    // Pop first, then glide to the new spot.
    setTimeout(() => renderBank({ flip: true }), reducedMotion() ? 0 : 440);
  }

  function askDelete(id) {
    const t = findThought(id);
    if (!t) return;
    state.pendingDeleteId = id;
    $('#delete-preview').textContent = `“${t.text}”`;
    openSheet('delete');
  }

  async function confirmDelete() {
    const id = state.pendingDeleteId;
    state.pendingDeleteId = null;
    closeSheet();
    if (!id) return;
    const card = cardEl(id);
    if (card) {
      card.classList.add('is-leaving');
      await wait(reducedMotion() ? 180 : 290);
    }
    state.thoughts = state.thoughts.filter((t) => t.id !== id);
    if (state.expandedId === id) state.expandedId = null;
    saveThoughts();
    renderBank({ flip: true });
  }

  /* ===================== 8. CAPTURE ===================== */
  const cap = {
    screen: screens.capture,
    stage: $('#capture-stage'),
    card: $('#thought-card'),
    body: $('#thought-card-body'),
    input: $('#thought-input'),
    chips: $('#capture-chips'),
    keepBtn: $('#keep-btn'),
    hintLeft: $('.swipe-hint--left'),
    hintRight: $('.swipe-hint--right'),
  };

  const draftHasText = () => state.draft.text.trim().length > 0;
  const draftHasMeta = () => state.draft.isImportant || !!state.draft.reminder || !!state.draft.location;

  function updateCaptureUI() {
    const focused = document.activeElement === cap.input;
    const hasText = draftHasText();
    const hasAnything = hasText || draftHasMeta();
    cap.screen.classList.toggle('is-composing', focused || hasAnything);
    cap.screen.classList.toggle('has-anything', hasAnything);
    cap.keepBtn.disabled = !hasText;

    const imp = $('[data-action="toggle-important"]', cap.screen);
    imp.classList.toggle('is-on', state.draft.isImportant);
    imp.setAttribute('aria-pressed', String(state.draft.isImportant));
    $('#remind-btn').classList.toggle('is-set', !!state.draft.reminder);
    $('#place-btn').classList.toggle('is-set', !!state.draft.location);

    renderCaptureChips();
    autoGrow();
  }

  function renderCaptureChips() {
    const chips = [];
    if (state.draft.reminder) {
      const text = reminderChipText(state.draft.reminder);
      chips.push(el('button', { class: 'chip', type: 'button', 'aria-label': `Reminder: ${text}. Change`, dataset: { action: 'open-reminder' } },
        [el('span', { class: 'chip__dot' }, [icon('clock')]), el('span', { class: 'chip__label', text })]));
    }
    if (state.draft.location) {
      const text = state.draft.location.label;
      chips.push(el('button', { class: 'chip', type: 'button', 'aria-label': `Place: ${text}. Change`, dataset: { action: 'open-place' } },
        [el('span', { class: 'chip__dot' }, [icon('pin')]), el('span', { class: 'chip__label', text })]));
    }
    // Only rebuild when something changed, so the chip pop doesn't replay on every keystroke.
    const signature = JSON.stringify([state.draft.reminder, state.draft.location]);
    if (cap.chips.dataset.sig === signature) return;
    cap.chips.dataset.sig = signature;
    cap.chips.replaceChildren(...chips);
  }

  /** Auto-growing textarea; the card body scrolls once it reaches the card's height. */
  function autoGrow() {
    cap.input.style.height = 'auto';
    cap.input.style.height = `${Math.min(cap.input.scrollHeight, 1200)}px`;
  }

  function persistDraft() {
    if (draftHasText() || draftHasMeta()) storage.write(KEYS.draft, state.draft);
    else storage.remove(KEYS.draft);
  }

  function restoreDraft() {
    const raw = storage.read(KEYS.draft, null);
    if (!raw || typeof raw !== 'object') return;
    const d = emptyDraft();
    d.text = typeof raw.text === 'string' ? raw.text : '';
    d.isImportant = raw.isImportant === true;
    d.source = raw.source === 'voice' ? 'voice' : 'text';
    if (raw.reminder && isDateKey(raw.reminder.date) && isTime(raw.reminder.time)) {
      d.reminder = { enabled: true, date: raw.reminder.date, time: raw.reminder.time, displayText: reminderChipText(raw.reminder), notifiedAt: null };
    }
    if (raw.location && toStringOrNull(raw.location.name)) {
      const n = normalizeThought({ text: 'x', location: raw.location });
      d.location = n ? { ...n.location, presetId: toStringOrNull(raw.location.presetId) } : null;
    }
    state.draft = d;
    cap.input.value = d.text;
  }

  function toggleImportantDraft() {
    state.draft.isImportant = !state.draft.isImportant;
    if (state.draft.isImportant) {
      restartAnimation($('[data-action="toggle-important"] .action__ring', cap.screen), 'pop');
      vibrate(10);
    }
    persistDraft();
    updateCaptureUI();
  }

  function saveDraftAsThought() {
    const d = state.draft;
    const created = nowIso();
    const thought = normalizeThought({
      id: uid(),
      text: d.text,
      createdAt: created,
      updatedAt: created,
      isImportant: d.isImportant,
      isCompleted: false,
      completedAt: null,
      source: d.source,
      reminder: d.reminder ? { ...d.reminder, enabled: true, notifiedAt: null } : null,
      location: d.location ? { ...d.location, enabled: true } : null,
    });
    if (!thought) return false;
    state.thoughts.unshift(thought);
    return saveThoughts();
  }

  function resetCapture() {
    state.draft = emptyDraft();
    cap.input.value = '';
    storage.remove(KEYS.draft);
    if (document.activeElement === cap.input) cap.input.blur();
    updateCaptureUI();
  }

  /* Swipe tint: orange → green (keep) or → red (discard) */
  function setCaptureTint(kind, progress) {
    if (!kind || progress <= 0) { cap.screen.style.backgroundColor = ''; return; }
    const from = hexToRgb(cssVar('--bg-capture'));
    const to = hexToRgb(cssVar(kind === 'keep' ? '--swipe-keep' : '--swipe-drop'));
    const p = clamp(progress, 0, 1);
    const mix = from.map((c, i) => Math.round(c + (to[i] - c) * p));
    cap.screen.style.backgroundColor = `rgb(${mix.join(',')})`;
  }

  /**
   * Finish a capture: 'right' = tuck the card into the Thought Bank,
   * 'left' = let it go (nothing is saved).
   */
  async function commitCard(direction) {
    if (state.capturing) return;
    const keep = direction === 'right';
    if (keep && !draftHasText()) { springBack(); cap.input.focus(); return; }
    if (!keep && !draftHasText() && !draftHasMeta()) { springBack(); return; }

    state.capturing = true;
    const card = cap.card;
    const width = card.offsetWidth;
    vibrate(keep ? 16 : 8);
    setCaptureTint(keep ? 'keep' : 'drop', 1);
    cap.hintRight.style.opacity = keep ? '1' : '0';
    cap.hintLeft.style.opacity = keep ? '0' : '1';

    const saved = keep ? saveDraftAsThought() : false;

    if (reducedMotion()) {
      card.style.transition = 'opacity 180ms ease, transform 180ms ease';
      card.style.opacity = '0';
      card.style.transform = `translateX(${keep ? 16 : -16}px)`;
      await wait(200);
    } else {
      card.style.transition = 'transform 400ms cubic-bezier(.5,0,.75,.15), opacity 400ms ease-in';
      card.style.transform = `translate3d(${(keep ? 1 : -1) * (width * 1.5 + 80)}px, ${keep ? -24 : 24}px, 0) rotate(${keep ? 24 : -24}deg)`;
      if (keep) cap.stage.classList.add('is-stacking');
      await wait(400);
    }

    resetCapture();

    // A fresh card rises from the stack.
    card.style.transition = 'none';
    card.style.opacity = '0';
    card.style.transform = reducedMotion() ? 'none' : 'translateY(14px) scale(.96)';
    cap.hintLeft.style.opacity = '';
    cap.hintRight.style.opacity = '';
    void card.offsetWidth;
    card.style.transition = 'transform 360ms cubic-bezier(.22,1,.36,1), opacity 260ms ease, height 420ms cubic-bezier(.22,1,.36,1)';
    card.style.transform = '';
    card.style.opacity = '';
    setCaptureTint(null, 0);

    if (keep) {
      if (saved) toast('Safely tucked away', { icon: 'check' });
    }
    await wait(380);
    card.style.transition = '';
    cap.stage.classList.remove('is-stacking');
    state.capturing = false;
  }

  /* ===================== 9. GESTURES (SWIPE) ===================== */
  const drag = { tracking: false, active: false, pointerId: null, x0: 0, y0: 0, dx: 0, lastX: 0, lastT: 0, velocity: 0, justDragged: false };

  const swipeThreshold = () => Math.max(SWIPE_MIN_PX, cap.card.offsetWidth * SWIPE_RATIO);

  function onCardPointerDown(e) {
    if (state.capturing || state.sheet) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('button')) return;
    Object.assign(drag, {
      tracking: true, active: false, pointerId: e.pointerId,
      x0: e.clientX, y0: e.clientY, dx: 0,
      lastX: e.clientX, lastT: performance.now(), velocity: 0,
    });
  }

  function onPointerMove(e) {
    if (!drag.tracking || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.active) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      const horizontal = Math.abs(dx) > Math.abs(dy) * 1.15;
      if (!horizontal || (!draftHasText() && !draftHasMeta())) { drag.tracking = false; return; }
      drag.active = true;
      try { cap.card.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      cap.screen.classList.add('is-dragging');
      cap.card.style.transition = 'none';
    }
    if (e.cancelable) e.preventDefault();
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount && e.pointerType === 'mouse') sel.removeAllRanges();

    const t = performance.now();
    drag.velocity = (e.clientX - drag.lastX) / Math.max(1, t - drag.lastT);
    drag.lastX = e.clientX;
    drag.lastT = t;
    drag.dx = dx;
    applyDrag(dx);
  }

  function applyDrag(dx) {
    // Keeping needs text; with metadata only, a right drag just resists.
    const effective = dx > 0 && !draftHasText() ? dx * 0.25 : dx;
    const width = cap.card.offsetWidth || 300;
    const progress = clamp(Math.abs(effective) / swipeThreshold(), 0, 1);
    const rotate = clamp((effective / width) * 14, -16, 16);
    cap.card.style.transform = `translate3d(${effective}px, ${-progress * 6}px, 0) rotate(${rotate}deg)`;
    setCaptureTint(effective > 0 ? 'keep' : 'drop', progress);
    cap.hintRight.style.opacity = effective > 0 ? String(progress) : '0';
    cap.hintLeft.style.opacity = effective < 0 ? String(progress) : '0';
  }

  function onPointerUp(e) {
    if (!drag.tracking || e.pointerId !== drag.pointerId) return;
    drag.tracking = false;
    if (!drag.active) return;
    drag.active = false;
    drag.justDragged = true;
    setTimeout(() => { drag.justDragged = false; }, 60);
    cap.screen.classList.remove('is-dragging');

    const dx = drag.dx;
    const fling = Math.abs(drag.velocity) > 0.65 && Math.abs(dx) > 48 && Math.sign(drag.velocity) === Math.sign(dx);
    const passed = Math.abs(dx) >= swipeThreshold() || fling;
    if (passed && dx > 0 && draftHasText()) commitCard('right');
    else if (passed && dx < 0) commitCard('left');
    else springBack();
  }

  function onPointerCancel(e) {
    if (!drag.tracking || e.pointerId !== drag.pointerId) return;
    const wasActive = drag.active;
    drag.tracking = false;
    drag.active = false;
    cap.screen.classList.remove('is-dragging');
    if (wasActive) springBack();
  }

  /** Not far enough: the card springs back to the middle (gentle, no wobble). */
  function springBack() {
    cap.card.style.transition = reducedMotion()
      ? 'transform 160ms ease'
      : 'transform 520ms cubic-bezier(.3,1.32,.55,1), height 420ms cubic-bezier(.22,1,.36,1)';
    cap.card.style.transform = '';
    cap.hintLeft.style.opacity = '';
    cap.hintRight.style.opacity = '';
    setCaptureTint(null, 0);
    setTimeout(() => { if (!drag.active && !state.capturing) cap.card.style.transition = ''; }, 540);
  }

  /* Keyboard: keep the card above the on-screen keyboard (visualViewport). */
  function updateKeyboardState() {
    const vv = window.visualViewport;
    const focused = document.activeElement === cap.input;
    const open = !!vv && focused && window.innerHeight - vv.height > 140;
    document.body.classList.toggle('keyboard-open', open);
    if (!open) return;
    const stageTop = cap.stage.getBoundingClientRect().top;
    const visibleBottom = vv.offsetTop + vv.height;
    const h = Math.max(150, Math.round(visibleBottom - stageTop - 22));
    document.documentElement.style.setProperty('--kb-card-h', `${h}px`);
    requestAnimationFrame(() => { if (window.scrollY) window.scrollTo(0, 0); });
  }

  /* ===================== 10. SHEETS ===================== */
  const scrim = $('#scrim');
  const SHEETS = {
    reminder: '#sheet-reminder',
    place: '#sheet-place',
    delete: '#sheet-delete',
    language: '#sheet-language',
    privacy: '#sheet-privacy',
    about: '#sheet-about',
    recap: '#sheet-recap',
    install: '#sheet-install',
  };
  const sheetTimers = new Map();
  let focusBeforeSheet = null;

  function setBackgroundInert(inert) {
    Object.values(screens).forEach((s) => { if (s.classList.contains('is-active')) s.inert = inert; });
    $('#tabbar').inert = inert;
  }

  function openSheet(name) {
    const sheet = $(SHEETS[name]);
    if (!sheet) return;
    if (state.sheet && state.sheet !== name) closeSheet({ immediate: true, restoreFocus: false });
    clearTimeout(sheetTimers.get(sheet));
    clearTimeout(sheetTimers.get(scrim));
    if (!state.sheet) focusBeforeSheet = document.activeElement;
    if (document.activeElement === cap.input) cap.input.blur();

    state.sheet = name;
    scrim.hidden = false;
    sheet.hidden = false;
    sheet.style.transform = '';
    void sheet.offsetHeight;
    scrim.classList.add('is-open');
    sheet.classList.add('is-open');
    setBackgroundInert(true);
    setTimeout(() => {
      const target = sheet.querySelector('[data-autofocus]') || sheet.querySelector('.sheet-title');
      if (target && !target.closest('[hidden]')) target.focus({ preventScroll: true });
    }, 80);
  }

  function closeSheet({ immediate = false, restoreFocus = true } = {}) {
    if (!state.sheet) return;
    const sheet = $(SHEETS[state.sheet]);
    const closing = state.sheet;
    state.sheet = null;
    sheet.classList.remove('is-open', 'is-dragging');
    sheet.style.transform = '';
    scrim.classList.remove('is-open');
    setBackgroundInert(false);

    const finish = () => {
      if (!sheet.classList.contains('is-open')) sheet.hidden = true;
      if (!state.sheet) scrim.hidden = true;
      if (closing === 'place') showPlaceView('main');
    };
    if (immediate) finish();
    else {
      sheetTimers.set(sheet, setTimeout(finish, 380));
      sheetTimers.set(scrim, setTimeout(() => { if (!state.sheet) scrim.hidden = true; }, 380));
    }

    // Return focus, but never pop the keyboard open by itself.
    const back = focusBeforeSheet;
    focusBeforeSheet = null;
    if (restoreFocus && back && back !== cap.input && document.contains(back) && typeof back.focus === 'function') {
      back.focus({ preventScroll: true });
    }
    if (state.screen === 'capture') updateCaptureUI();
  }

  /* Swipe a sheet down by its handle to close it */
  function initSheetDrag(sheet) {
    const grab = sheet.querySelector('[data-sheet-grab]');
    if (!grab) return;
    let startY = 0; let dy = 0; let id = null; let lastY = 0; let lastT = 0; let v = 0;
    grab.addEventListener('pointerdown', (e) => {
      id = e.pointerId; startY = lastY = e.clientY; lastT = performance.now(); dy = 0; v = 0;
      try { grab.setPointerCapture(id); } catch (_) { /* ignore */ }
      sheet.classList.add('is-dragging');
    });
    grab.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      dy = Math.max(0, e.clientY - startY);
      const t = performance.now();
      v = (e.clientY - lastY) / Math.max(1, t - lastT);
      lastY = e.clientY; lastT = t;
      sheet.style.transform = `translateY(${dy}px)`;
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      sheet.classList.remove('is-dragging');
      if (dy > 110 || (v > 0.6 && dy > 30)) closeSheet();
      else sheet.style.transform = '';
    };
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', end);
    grab.addEventListener('click', () => { if (dy < 4) closeSheet(); });
  }

  /* ===================== 11. REMINDERS ===================== */
  const clock = {
    svg: $('#clock'),
    hand: $('#clock-hand'),
    time: $('#clock-time'),
    nums: $('#clock-nums'),
    dragging: false,
  };

  function buildClockNumbers() {
    for (let n = 1; n <= 12; n++) {
      const angle = (n * 30 - 90) * (Math.PI / 180);
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('class', 'clock__num');
      text.setAttribute('x', String(130 + Math.cos(angle) * 100));
      text.setAttribute('y', String(130 + Math.sin(angle) * 100));
      text.dataset.hour = String(n);
      text.textContent = String(n);
      clock.nums.append(text);
    }
  }

  /** Opens the reminder sheet for the capture draft, or for a saved thought when an id is given. */
  function openReminderSheet(thoughtId = null) {
    const thought = thoughtId ? findThought(thoughtId) : null;
    state.reminderTarget = thought ? thought.id : null;
    const r = thought ? (thought.reminder.enabled ? thought.reminder : null) : state.draft.reminder;
    const now = new Date();
    if (r) {
      state.reminderDraft = { time: r.time, day: r.date === localDateKey(now) ? 'today' : 'tomorrow' };
    } else {
      state.reminderDraft = { time: '08:00', day: now.getHours() >= 8 ? 'tomorrow' : 'today' };
    }
    $('#reminder-clear').hidden = !r;
    renderReminderSheet();
    openSheet('reminder');
  }

  function renderReminderSheet() {
    const { time, day } = state.reminderDraft;
    const [h, m] = time.split(':').map(Number);
    const h12 = h % 12 || 12;
    const isPM = h >= 12;
    const angle = ((h % 12) + m / 60) * 30;
    clock.hand.style.transform = `rotate(${angle}deg)`;
    clock.time.textContent = `${h12}:${pad(m)}`;
    clock.svg.setAttribute('aria-valuenow', String(h12));
    clock.svg.setAttribute('aria-valuetext', formatTime(time));
    $$('.clock__num', clock.nums).forEach((n) => n.classList.toggle('is-current', Number(n.dataset.hour) === h12));
    $$('[data-action="set-ampm"]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.value === 'PM') === isPM)));
    $$('[data-action="set-day"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === day)));
    $$('[data-action="set-quick"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === time)));
    const input = $('#reminder-time');
    if (input.value !== time) input.value = time;

    const hint = $('#reminder-hint');
    const due = reminderDate({ enabled: true, date: localDateKey(), time });
    if (day === 'today' && due && due <= new Date()) {
      hint.textContent = 'That time has already passed today. Tomorrow might suit it better.';
      hint.hidden = false;
    } else {
      hint.hidden = true;
    }
  }

  function setReminderTime(time) {
    if (!isTime(time)) return;
    state.reminderDraft.time = time;
    renderReminderSheet();
  }

  function setHourFromPointer(e) {
    const rect = clock.svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let deg = Math.atan2(e.clientX - cx, -(e.clientY - cy)) * (180 / Math.PI);
    if (deg < 0) deg += 360;
    const hour12 = Math.round(deg / 30) % 12; // 0 means 12
    const [h, m] = state.reminderDraft.time.split(':').map(Number);
    const isPM = h >= 12;
    const nextH = hour12 + (isPM ? 12 : 0);
    if (nextH !== h) {
      vibrate(5);
      setReminderTime(`${pad(nextH)}:${pad(m)}`);
    }
  }

  function initClock() {
    buildClockNumbers();
    clock.svg.addEventListener('pointerdown', (e) => {
      clock.dragging = true;
      clock.svg.classList.add('is-dragging');
      try { clock.svg.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      setHourFromPointer(e);
    });
    clock.svg.addEventListener('pointermove', (e) => { if (clock.dragging) setHourFromPointer(e); });
    const stop = () => { clock.dragging = false; clock.svg.classList.remove('is-dragging'); };
    clock.svg.addEventListener('pointerup', stop);
    clock.svg.addEventListener('pointercancel', stop);
    clock.svg.addEventListener('keydown', (e) => {
      const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const [h, m] = state.reminderDraft.time.split(':').map(Number);
      setReminderTime(`${pad((h + step + 24) % 24)}:${pad(m)}`);
    });
    $('#reminder-time').addEventListener('change', (e) => setReminderTime(e.target.value));
  }

  function setAmPm(value) {
    const [h, m] = state.reminderDraft.time.split(':').map(Number);
    const base = h % 12;
    setReminderTime(`${pad(value === 'PM' ? base + 12 : base)}:${pad(m)}`);
  }

  function saveReminder() {
    const { time, day } = state.reminderDraft;
    const date = day === 'today' ? localDateKey() : localDateKey(addDays(new Date(), 1));
    const reminder = { enabled: true, date, time, displayText: reminderChipText({ date, time }), notifiedAt: null };
    vibrate(10);
    const thought = state.reminderTarget ? findThought(state.reminderTarget) : null;
    if (thought) {
      thought.reminder = reminder;
      thought.updatedAt = nowIso();
      saveThoughts();
      closeSheet();
      renderBank();
      toast(`Reminder set: ${reminderLabel(reminder)}`, { icon: 'check' });
      return;
    }
    state.draft.reminder = reminder;
    persistDraft();
    closeSheet();
    updateCaptureUI();
  }

  function clearReminder() {
    const thought = state.reminderTarget ? findThought(state.reminderTarget) : null;
    if (thought) {
      thought.reminder = emptyReminder();
      thought.updatedAt = nowIso();
      saveThoughts();
      closeSheet();
      renderBank();
      return;
    }
    state.draft.reminder = null;
    persistDraft();
    closeSheet();
    updateCaptureUI();
  }

  /**
   * In-app reminders while the app is open. The data (date + time + notifiedAt)
   * maps directly onto scheduled local notifications in a native version later.
   */
  function checkDueReminders() {
    const now = new Date();
    let changed = false;
    for (const t of state.thoughts) {
      if (t.isCompleted || !t.reminder.enabled || t.reminder.notifiedAt) continue;
      const due = reminderDate(t.reminder);
      if (!due || due > now) continue;
      t.reminder.notifiedAt = now.toISOString();
      changed = true;
      // Only nudge for reminders that came due recently and while notifications are on.
      // With lock screen alerts active, the server already sends it, so no double nudge.
      if (state.settings.notifications && !pushActive() && now - due < 12 * 60 * 60 * 1000) showNudge(t);
    }
    if (changed) saveThoughts();
  }

  /* ===================== 12. LOCATIONS ===================== */
  function openPlaceSheet() {
    state.placeDraft = { query: '', selectedId: null, current: null };
    $('#place-search').value = '';
    renderPresetPlaces();
    $('#place-clear').hidden = !state.draft.location;
    showPlaceView('main');
    openSheet('place');
  }

  function renderPresetPlaces() {
    const current = state.draft.location;
    const items = PRESET_PLACES.map((p) => el('button', {
      class: `place-opt${current && current.presetId === p.id ? ' is-selected' : ''}`,
      type: 'button',
      dataset: { action: 'place-preset', value: p.id },
    }, [
      el('span', { class: 'place-opt__icon' }, [icon(p.icon)]),
      el('span', {}, [el('span', { class: 'place-opt__title', text: p.title }), el('span', { class: 'place-opt__sub', text: p.sub })]),
    ]));
    items.push(el('button', { class: 'place-opt place-opt--custom', type: 'button', dataset: { action: 'place-custom' } }, [
      el('span', { class: 'place-opt__icon' }, [icon('plus')]),
      el('span', { class: 'place-opt__title', text: 'Custom location / add new place' }),
    ]));
    $('#preset-list').replaceChildren(...items);
  }

  function showPlaceView(view) {
    const main = $('#place-view-main');
    const find = $('#place-view-find');
    main.hidden = view !== 'main';
    find.hidden = view !== 'find';
    const sheet = $('#sheet-place');
    sheet.setAttribute('aria-labelledby', view === 'find' ? 'find-title' : 'place-title');
    $('.sheet-content', sheet).scrollTop = 0;
    if (view === 'find') {
      renderFindList();
      $('#find-title').focus({ preventScroll: true });
    }
  }

  function choosePreset(id) {
    const p = PRESET_PLACES.find((x) => x.id === id);
    if (!p) return;
    state.draft.location = {
      enabled: true, presetId: p.id, name: p.name, label: p.label,
      address: p.address, latitude: p.latitude, longitude: p.longitude,
    };
    persistDraft();
    vibrate(10);
    closeSheet();
    updateCaptureUI();
  }

  /** Every place the "Find a location" list can show, including temporary ones. */
  function findCandidates() {
    const q = state.placeDraft.query.trim();
    const ql = q.toLowerCase();
    const list = [];
    if (state.placeDraft.current) list.push(state.placeDraft.current);
    if (q && !state.places.some((p) => p.name.toLowerCase() === ql)) {
      list.push({ id: 'custom', name: q, meta: 'New place · tap to use', temporary: true });
    }
    state.places
      .filter((p) => !ql || p.name.toLowerCase().includes(ql) || p.meta.toLowerCase().includes(ql))
      .forEach((p) => list.push(p));
    return list;
  }

  function selectedCandidate() {
    return findCandidates().find((p) => p.id === state.placeDraft.selectedId) || null;
  }

  function renderFindList() {
    const list = findCandidates();
    const selectedId = state.placeDraft.selectedId;
    const rows = list.map((p) => {
      const selected = p.id === selectedId;
      const saved = state.places.some((s) => s.id === p.id);
      let end;
      if (selected) end = el('span', { class: 'find-check', 'aria-hidden': 'true' }, [icon('check')]);
      else if (saved) end = el('button', { class: 'icon-btn find-trash', type: 'button', 'aria-label': `Remove ${p.name} from my places`, dataset: { action: 'place-remove', value: p.id } }, [icon('trash')]);
      return el('div', { class: `find-row${selected ? ' is-selected' : ''}` }, [
        el('button', { class: 'find-row__select', type: 'button', 'aria-pressed': String(selected), dataset: { action: 'place-select', value: p.id } }, [
          icon(p.temporary ? 'plus' : 'pin'),
          el('span', { class: 'find-row__texts' }, [el('span', { class: 'find-row__name', text: p.name }), el('span', { class: 'find-row__meta', text: p.meta })]),
        ]),
        el('span', { class: 'find-row__end' }, [end]),
      ]);
    });
    if (!rows.length) rows.push(el('p', { class: 'find-empty', text: 'No saved places yet. Type a name above to add one.' }));
    $('#find-list').replaceChildren(...rows);

    const sel = selectedCandidate();
    if (!sel) state.placeDraft.selectedId = null;
    $('#place-use').disabled = !sel;
    $('#place-save').disabled = !sel || state.places.some((p) => p.id === sel.id);
  }

  function useSelectedPlace() {
    const p = selectedCandidate();
    if (!p) return;
    state.draft.location = {
      enabled: true, name: p.name, label: `At ${p.name}`,
      address: p.address || (p.temporary ? null : p.meta),
      latitude: toNumberOrNull(p.latitude), longitude: toNumberOrNull(p.longitude),
    };
    persistDraft();
    vibrate(10);
    closeSheet();
    updateCaptureUI();
  }

  function saveSelectedPlace() {
    const p = selectedCandidate();
    if (!p || state.places.some((s) => s.id === p.id)) return;
    const place = {
      id: uid(),
      name: p.name,
      meta: p.id === 'custom' ? 'Saved place' : p.meta,
      latitude: toNumberOrNull(p.latitude),
      longitude: toNumberOrNull(p.longitude),
    };
    state.places.unshift(place);
    savePlaces();
    if (p.id === 'custom') { state.placeDraft.query = ''; $('#place-search').value = ''; }
    if (state.placeDraft.current && p.id === state.placeDraft.current.id) state.placeDraft.current = null;
    state.placeDraft.selectedId = place.id;
    renderFindList();
    toast('Saved to your places', { icon: 'check' });
  }

  function removePlace(id) {
    state.places = state.places.filter((p) => p.id !== id);
    savePlaces();
    renderFindList();
  }

  /** Location permission is only requested here, when the person asks for it. */
  function useCurrentLocation() {
    const btn = $('#place-current-btn');
    const fallback = (message) => {
      btn.classList.remove('is-busy');
      $('span', btn).textContent = 'Use my current location';
      toast(message, { icon: 'info', tone: 'info', duration: 3800 });
      $('#place-search').focus();
    };
    if (!('geolocation' in navigator)) {
      fallback('Location isn’t available here. You can type a place name instead.');
      return;
    }
    btn.classList.add('is-busy');
    $('span', btn).textContent = 'Finding you…';
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          btn.classList.remove('is-busy');
          $('span', btn).textContent = 'Use my current location';
          const { latitude, longitude } = pos.coords;
          state.placeDraft.current = {
            id: `current-${Date.now()}`,
            name: 'Current location',
            meta: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
            address: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
            latitude, longitude,
          };
          state.placeDraft.selectedId = state.placeDraft.current.id;
          renderFindList();
          vibrate(10);
        },
        (err) => {
          fallback(err && err.code === 1
            ? 'No problem, location stays off. You can type a place name instead.'
            : 'Couldn’t find your spot just now. You can type a place name instead.');
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
      );
    } catch (_) {
      fallback('Location isn’t available here. You can type a place name instead.');
    }
  }

  function clearPlace() {
    state.draft.location = null;
    persistDraft();
    closeSheet();
    updateCaptureUI();
  }

  /* ===================== 13. SPEECH ===================== */
  const recorder = { el: $('#recorder'), transcript: $('#recorder-transcript'), recognition: null, timer: null, hideTimer: null };

  function getSpeechRecognition() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function startSpeech() {
    const SR = getSpeechRecognition();
    if (!SR) { toast(VOICE_UNSUPPORTED, { icon: 'info', tone: 'info', duration: 4200 }); return; }
    let recognition;
    try { recognition = new SR(); } catch (_) { toast(VOICE_UNSUPPORTED, { icon: 'info', tone: 'info', duration: 4200 }); return; }

    recognition.lang = state.settings.speechLang;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    let finalText = '';
    let interimText = '';
    let errorCode = null;

    recognition.onresult = (event) => {
      interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += chunk;
        else interimText += chunk;
      }
      recorder.transcript.textContent = (finalText + interimText).trim();
    };
    recognition.onerror = (event) => { errorCode = event.error || 'unknown'; };
    recognition.onend = () => {
      clearTimeout(recorder.timer);
      recorder.recognition = null;
      closeRecorder();
      const spoken = (finalText || interimText).trim();
      if (spoken) {
        insertSpokenText(spoken);
      } else if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') {
        toast('The microphone is turned off for this site. You can still type your thought.', { icon: 'info', tone: 'info', duration: 4200 });
      } else if (errorCode && errorCode !== 'aborted') {
        toast('Didn’t catch that. Try again whenever you like.', { icon: 'info', tone: 'info' });
      }
    };

    recorder.recognition = recognition;
    openRecorder();
    try {
      recognition.start();
    } catch (_) {
      recorder.recognition = null;
      closeRecorder();
      toast(VOICE_UNSUPPORTED, { icon: 'info', tone: 'info', duration: 4200 });
      return;
    }
    // Safety net: never leave the overlay up forever.
    recorder.timer = setTimeout(stopSpeech, 30000);
  }

  function stopSpeech() {
    if (recorder.recognition) {
      try { recorder.recognition.stop(); } catch (_) { closeRecorder(); }
    } else {
      closeRecorder();
    }
  }

  function openRecorder() {
    clearTimeout(recorder.hideTimer);
    if (document.activeElement === cap.input) cap.input.blur();
    recorder.transcript.textContent = '';
    recorder.el.hidden = false;
    void recorder.el.offsetWidth;
    recorder.el.classList.add('is-open');
    vibrate(10);
    $('#recorder-stop').focus({ preventScroll: true });
  }

  function closeRecorder() {
    recorder.el.classList.remove('is-open');
    recorder.hideTimer = setTimeout(() => { recorder.el.hidden = true; }, 280);
  }

  function insertSpokenText(spoken) {
    const text = spoken.charAt(0).toUpperCase() + spoken.slice(1);
    const existing = state.draft.text.trim();
    state.draft.text = existing ? `${existing} ${text}` : text;
    state.draft.source = 'voice';
    cap.input.value = state.draft.text;
    persistDraft();
    updateCaptureUI();
  }

  /* ===================== 14. SETTINGS ===================== */
  function loadSettings() {
    state.settings = normalizeSettings(storage.read(KEYS.settings, null));
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.settings.darkMode ? 'dark' : 'light';
    updateThemeColor();
  }

  function renderSettings() {
    const s = state.settings;
    const notif = $('[data-value="notifications"][data-action="toggle-setting"]');
    notif.setAttribute('aria-checked', String(s.notifications));
    $('#notif-sub').textContent = !s.notifications
      ? 'Reminders are off'
      : pushActive() ? 'On, also on your lock screen' : 'Reminders are on, in the app';
    renderPushCallout();
    $('#recap-sub').textContent = recapSummary(s.recap);
    const dark = $('[data-value="darkMode"][data-action="toggle-setting"]');
    dark.setAttribute('aria-checked', String(s.darkMode));
    $('#dark-sub').textContent = s.darkMode ? 'On' : 'Off';
    $('#lang-sub').textContent = SPEECH_LANGS[s.speechLang];
    $$('[data-action="set-lang"]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === s.speechLang)));
  }

  function toggleSetting(key) {
    if (key === 'notifications') {
      state.settings.notifications = !state.settings.notifications;
      if (state.settings.notifications) {
        // Turning reminders on also offers lock screen alerts (permission is asked inside this tap).
        const env = pushEnvironment();
        if (env === 'ready') enablePush();
        else if (env === 'needs-install') setTimeout(() => openSheet('install'), 250);
      } else if (pushState.device && pushState.device.subscribed) {
        disablePush();
      }
    }
    if (key === 'darkMode') {
      state.settings.darkMode = !state.settings.darkMode;
      applyTheme();
    }
    vibrate(8);
    saveSettings();
    renderSettings();
  }

  function setSpeechLang(code) {
    if (!SPEECH_LANGS[code]) return;
    state.settings.speechLang = code;
    saveSettings();
    renderSettings();
    setTimeout(closeSheet, 220);
  }

  /* ===================== 14b. LOCK SCREEN PUSH & DAILY RECAP =====================
     The app keeps working on its own. When lock screen alerts are on, it sends a
     copy of the thoughts (+ recap schedule + time zone) to your reminder server,
     which sends Web Push notifications at the right minute. */
  const pushState = { device: null, busy: false, syncTimer: null };

  function randomId(bytes) {
    const arr = new Uint8Array(bytes);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(arr);
    else for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  function loadDevice() {
    const d = storage.read(KEYS.device, null);
    if (d && typeof d.id === 'string' && typeof d.token === 'string') {
      pushState.device = { id: d.id, token: d.token, subscribed: d.subscribed === true };
    } else {
      pushState.device = { id: `dev_${randomId(12)}`, token: randomId(24), subscribed: false };
      saveDevice();
    }
  }
  const saveDevice = () => storage.write(KEYS.device, pushState.device);

  function serverUrl() {
    let override = null;
    try { override = localStorage.getItem(KEYS.pushServer); } catch (_) { /* ignore */ }
    return String(override || PUSH_SERVER_URL || '').trim().replace(/\/+$/, '');
  }
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const timeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; } };

  /** 'ready' | 'no-server' | 'needs-install' | 'blocked' | 'unsupported' */
  function pushEnvironment() {
    if (!serverUrl()) return 'no-server';
    const capable = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (isIOS() && !isStandalone()) return 'needs-install';
    if (!capable) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    return 'ready';
  }
  function pushActive() {
    return !!(state.settings.notifications && pushState.device && pushState.device.subscribed && serverUrl());
  }

  async function api(path, body) {
    const res = await fetch(serverUrl() + path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { method: 'GET' });
    let data = {};
    try { data = await res.json(); } catch (_) { /* empty */ }
    if (!res.ok) {
      const err = new Error(data.error || `Server answered ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  const credentials = () => ({ deviceId: pushState.device.id, token: pushState.device.token });

  function base64UrlToBytes(value) {
    const norm = value.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(norm + '='.repeat((4 - (norm.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  function sameBytes(a, b) {
    const x = new Uint8Array(a); const y = new Uint8Array(b);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  async function getServerKey() {
    try {
      const { publicKey } = await api('/api/config');
      storage.write(KEYS.vapidKey, publicKey);
      return publicKey;
    } catch (err) {
      const cached = storage.read(KEYS.vapidKey, null);
      if (cached) return cached;
      throw err;
    }
  }

  /** Turns on lock screen alerts. Must start inside a tap: the permission prompt comes first. */
  async function enablePush() {
    const env = pushEnvironment();
    if (env === 'needs-install') { openSheet('install'); return false; }
    if (env === 'no-server') { toast('Lock screen reminders need your reminder server. The setup guide explains how.', { icon: 'info', tone: 'info', duration: 4200 }); return false; }
    if (env === 'unsupported') { toast('This browser can’t show lock screen reminders. In-app nudges still work.', { icon: 'info', tone: 'info', duration: 4000 }); return false; }
    if (env === 'blocked') { toast('Notifications are blocked for this app. You can allow them in your phone’s Settings.', { icon: 'info', tone: 'info', duration: 4600 }); return false; }
    if (pushState.busy) return false;

    pushState.busy = true;
    renderSettings();
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast(permission === 'denied'
          ? 'Notifications are blocked for this app. You can allow them in your phone’s Settings.'
          : 'No problem. You can turn this on any time.', { icon: 'info', tone: 'info', duration: 4000 });
        return false;
      }
      const [key, registration] = await Promise.all([getServerKey(), navigator.serviceWorker.ready]);
      const appKey = base64UrlToBytes(key);
      let sub = await registration.pushManager.getSubscription();
      if (sub && sub.options && sub.options.applicationServerKey && !sameBytes(sub.options.applicationServerKey, appKey)) {
        await sub.unsubscribe();
        sub = null;
      }
      if (!sub) sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });

      await api('/api/register', { ...credentials(), subscription: sub.toJSON(), timezone: timeZone() });
      pushState.device.subscribed = true;
      saveDevice();
      await syncNow();
      vibrate(12);
      toast('Reminders will reach your lock screen', { icon: 'check' });
      return true;
    } catch (err) {
      console.warn('[Thought Cards] Push setup failed:', err);
      if (err && err.status === 403) {
        // This device id is taken on the server with another token: start with a fresh identity.
        pushState.device = { id: `dev_${randomId(12)}`, token: randomId(24), subscribed: false };
        saveDevice();
      }
      toast('Couldn’t reach the reminder server just now. In-app nudges still work.', { icon: 'info', tone: 'info', duration: 4000 });
      return false;
    } finally {
      pushState.busy = false;
      renderSettings();
    }
  }

  async function disablePush() {
    pushState.device.subscribed = false;
    saveDevice();
    renderSettings();
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch (_) { /* nothing to undo */ }
    if (serverUrl()) api('/api/unregister', credentials()).catch(() => {});
  }

  /** What the server needs: text, status and the exact moment of each reminder. */
  function thoughtsForServer() {
    return state.thoughts.map((t) => {
      const due = reminderDate(t.reminder);
      return {
        id: t.id, text: t.text, isImportant: t.isImportant, isCompleted: t.isCompleted,
        completedAt: t.completedAt, createdAt: t.createdAt,
        reminderAt: due ? due.getTime() : null,
      };
    });
  }

  async function syncNow() {
    clearTimeout(pushState.syncTimer);
    if (!pushActive()) return false;
    try {
      await api('/api/sync', { ...credentials(), timezone: timeZone(), recap: state.settings.recap, thoughts: thoughtsForServer() });
      return true;
    } catch (err) {
      if (err && (err.status === 404 || err.status === 403)) {
        // The server no longer knows this phone (for example after the subscription expired).
        pushState.device.subscribed = false;
        saveDevice();
        renderSettings();
      }
      return false;
    }
  }
  function scheduleSync() {
    if (!pushActive()) return;
    clearTimeout(pushState.syncTimer);
    pushState.syncTimer = setTimeout(syncNow, 600);
  }

  /** On start and when coming back: make sure the phone still has its subscription, then sync. */
  async function verifyPush() {
    if (!pushActive()) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (!sub) {
        pushState.device.subscribed = false;
        saveDevice();
        renderSettings();
        return;
      }
    } catch (_) { /* keep going */ }
    syncNow();
  }

  async function sendTestPush() {
    if (!pushActive()) return;
    const btn = $('#push-test-btn');
    btn.disabled = true;
    try {
      await syncNow();
      await api('/api/test', credentials());
      toast('Test sent. It should arrive in a few seconds.', { icon: 'check' });
    } catch (err) {
      toast('The test didn’t go through. Try turning Notifications off and on again.', { icon: 'info', tone: 'info', duration: 4200 });
    } finally {
      btn.disabled = false;
    }
  }

  function renderPushCallout() {
    const box = $('#push-callout');
    const env = pushEnvironment();
    const show = state.settings.notifications && !pushActive() && env !== 'unsupported';
    box.hidden = !show;
    if (!show) return;
    const btn = $('#push-callout-btn');
    const copy = {
      ready: ['Want reminders on your lock screen too?', 'Turn on'],
      'needs-install': ['For lock screen reminders, add Thought Cards to your Home Screen first.', 'Show me how'],
      blocked: ['Notifications are blocked. Allow them in your phone’s Settings, then try again.', 'Try again'],
      'no-server': ['Lock screen reminders need your reminder server. See the setup guide.', ''],
    }[env];
    $('#push-callout-text').textContent = copy[0];
    btn.textContent = pushState.busy ? 'Connecting…' : copy[1];
    btn.hidden = !copy[1];
    btn.disabled = pushState.busy;
  }

  /* --- Daily recap settings --- */
  function recapSummary(recap) {
    if (!recap.enabled) return 'Off';
    const on = WEEKDAYS.filter((d) => recap.days[d].on);
    if (!on.length) return 'No days picked';
    const times = new Set(on.map((d) => recap.days[d].time));
    if (times.size > 1) return 'Your own time for each day';
    const t = formatTime([...times][0]);
    const key = on.join(',');
    if (on.length === 7) return `Every day at ${t}`;
    if (key === 'mon,tue,wed,thu,fri') return `Weekdays at ${t}`;
    if (key === 'sat,sun') return `Weekends at ${t}`;
    return `${on.map((d) => WEEKDAY_NAMES[d].slice(0, 3)).join(', ')} at ${t}`;
  }

  function buildRecapDays() {
    const rows = WEEKDAYS.map((d) => el('div', { class: 'recap-day', dataset: { day: d } }, [
      el('span', { class: 'recap-day__name', text: WEEKDAY_NAMES[d] }),
      el('input', { class: 'recap-day__time', type: 'time', dataset: { recapTime: d }, 'aria-label': `${WEEKDAY_NAMES[d]} recap time` }),
      el('button', { class: 'recap-day__switch', type: 'button', role: 'switch', 'aria-checked': 'true', 'aria-label': `Recap on ${WEEKDAY_NAMES[d]}`, dataset: { action: 'toggle-recap-day', value: d } },
        [el('span', { class: 'switch', 'aria-hidden': 'true' })]),
    ]));
    $('#recap-days').replaceChildren(...rows);
  }

  function renderRecapSheet() {
    const recap = state.settings.recap;
    $('[data-action="toggle-recap"]').setAttribute('aria-checked', String(recap.enabled));
    $('#recap-master-sub').textContent = recapSummary(recap);
    $('#recap-body').classList.toggle('is-off', !recap.enabled);
    $('#recap-body').inert = !recap.enabled;
    for (const d of WEEKDAYS) {
      const row = $(`.recap-day[data-day="${d}"]`);
      const input = $('input', row);
      if (input.value !== recap.days[d].time) input.value = recap.days[d].time;
      input.disabled = !recap.days[d].on;
      $('button', row).setAttribute('aria-checked', String(recap.days[d].on));
      row.classList.toggle('is-off', !recap.days[d].on);
    }
    const note = $('#recap-note');
    const active = pushActive();
    $('#push-test-btn').hidden = !active;
    if (active) { note.hidden = true; return; }
    note.hidden = false;
    const env = pushEnvironment();
    note.textContent = env === 'needs-install'
      ? 'Your recap arrives as a lock screen notification. Add Thought Cards to your Home Screen, then turn on Notifications.'
      : env === 'no-server'
        ? 'Your recap arrives as a lock screen notification once your reminder server is set up.'
        : 'Your recap arrives as a lock screen notification. Turn on lock screen alerts under Notifications first.';
  }

  function updateRecap(mutator) {
    mutator(state.settings.recap);
    saveSettings();
    renderRecapSheet();
    renderSettings();
  }

  /* --- Opening the right thought from a notification --- */
  function openThought(id) {
    hideNudge();
    state.query = '';
    $('#bank-search').value = '';
    navigate('bank');
    if (!id || !findThought(id)) return;
    setTimeout(() => {
      if (!cardEl(id)) renderBank();
      setExpanded(id);
      const card = cardEl(id);
      if (card) setTimeout(() => card.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }), 340);
    }, 140);
  }
  function handleDeepLink() {
    const hash = location.hash || '';
    const match = hash.match(/^#thought=(.+)$/);
    if (match) openThought(decodeURIComponent(match[1]));
    else if (hash === '#bank') navigate('bank');
    else return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* ignore */ }
  }

  /* ===================== 15. FEEDBACK ===================== */
  let toastTimer = null;
  function toast(message, { duration = 2200, icon: iconName = null, tone = '' } = {}) {
    const node = $('#toast');
    node.replaceChildren();
    if (iconName) node.append(el('span', { class: 'toast__icon' }, [icon(iconName)]));
    node.append(el('span', { text: message }));
    node.className = `toast${iconName ? ' has-icon' : ''}${tone ? ` toast--${tone}` : ''}`;
    node.hidden = false;
    void node.offsetWidth;
    node.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.classList.remove('is-visible');
      toastTimer = setTimeout(() => { node.hidden = true; }, 320);
    }, duration);
  }

  let nudgeTimer = null;
  let nudgeId = null;
  function showNudge(thought) {
    nudgeId = thought.id;
    const node = $('#nudge');
    $('#nudge-text').textContent = thought.text;
    node.hidden = false;
    void node.offsetWidth;
    node.classList.add('is-visible');
    vibrate([12, 60, 12]);
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(hideNudge, 9000);
    // When the app is in the background and the browser allows it, also show a system notification.
    if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const opts = { body: thought.text, icon: 'assets/icon-192.png', tag: thought.id };
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.ready.then((reg) => reg.showNotification('A gentle nudge', opts)).catch(() => {});
        } else {
          new Notification('A gentle nudge', opts);
        }
      } catch (_) { /* not available */ }
    }
  }
  function hideNudge() {
    const node = $('#nudge');
    node.classList.remove('is-visible');
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => { node.hidden = true; }, 420);
  }
  function openNudgedThought() {
    hideNudge();
    if (!nudgeId || !findThought(nudgeId)) return;
    openThought(nudgeId);
  }

  /* ===================== 16. EVENTS & INIT ===================== */
  function onDocumentClick(e) {
    // Tap outside an open Thought Card folds it back.
    if (state.screen === 'bank' && state.expandedId && !state.sheet && !e.target.closest('.tcard')) {
      setExpanded(null);
    }

    const navBtn = e.target.closest('[data-nav]');
    if (navBtn) {
      navigate(navBtn.dataset.nav);
      if (navBtn.dataset.nav === 'capture' && navBtn.closest('.bank-empty')) setTimeout(() => cap.input.focus(), 320);
      return;
    }

    const target = e.target.closest('[data-action]');
    if (!target) return;
    const { action, id, value } = target.dataset;

    switch (action) {
      // capture
      case 'toggle-important': toggleImportantDraft(); break;
      case 'open-reminder': openReminderSheet(); break;
      case 'open-place': openPlaceSheet(); break;
      case 'mic': startSpeech(); break;
      case 'keep': commitCard('right'); break;
      case 'discard': commitCard('left'); break;
      // bank
      case 'toggle-card': toggleCard(id); break;
      case 'done': completeThought(id); break;
      case 'undo': undoComplete(id); break;
      case 'pin': togglePin(id); break;
      case 'delete': askDelete(id); break;
      case 'remind-card': openReminderSheet(id); break;
      case 'confirm-delete': confirmDelete(); break;
      // sheets
      case 'close-sheet': closeSheet(); break;
      case 'open-sheet': openSheet(value); break;
      // reminder sheet
      case 'set-ampm': setAmPm(value); break;
      case 'set-day': state.reminderDraft.day = value; renderReminderSheet(); break;
      case 'set-quick': setReminderTime(value); vibrate(8); break;
      case 'reminder-save': saveReminder(); break;
      case 'reminder-clear': clearReminder(); break;
      // place sheet
      case 'place-preset': choosePreset(value); break;
      case 'place-custom': showPlaceView('find'); break;
      case 'place-back': showPlaceView('main'); break;
      case 'place-current': useCurrentLocation(); break;
      case 'place-select':
        state.placeDraft.selectedId = state.placeDraft.selectedId === value ? null : value;
        renderFindList();
        break;
      case 'place-remove': removePlace(value); break;
      case 'place-use': useSelectedPlace(); break;
      case 'place-save': saveSelectedPlace(); break;
      case 'place-clear': clearPlace(); break;
      // settings
      case 'toggle-setting': toggleSetting(value); break;
      case 'set-lang': setSpeechLang(value); break;
      // lock screen alerts & daily recap
      case 'push-callout': enablePush(); break;
      case 'push-test': sendTestPush(); break;
      case 'open-recap': renderRecapSheet(); openSheet('recap'); break;
      case 'toggle-recap': updateRecap((r) => { r.enabled = !r.enabled; }); vibrate(8); break;
      case 'toggle-recap-day': updateRecap((r) => { r.days[value].on = !r.days[value].on; }); vibrate(8); break;
      case 'recap-apply-all': {
        const time = $('#recap-all-time').value;
        if (isTime(time)) {
          updateRecap((r) => { WEEKDAYS.forEach((d) => { r.days[d].time = time; }); });
          toast(`Every recap day now at ${formatTime(time)}`, { icon: 'check' });
        }
        break;
      }
      // misc
      case 'review-soon': toast('Daily Review is on its way. Your thoughts are safe in the Thought Bank.', { icon: 'sun', tone: 'info', duration: 3200 }); break;
      case 'nudge-open': openNudgedThought(); break;
      case 'nudge-close': hideNudge(); break;
      default: break;
    }
  }

  function bindEvents() {
    document.addEventListener('click', onDocumentClick);

    // Capture input
    cap.input.addEventListener('input', () => {
      state.draft.text = cap.input.value;
      persistDraft();
      updateCaptureUI();
    });
    cap.input.addEventListener('focus', () => { updateCaptureUI(); setTimeout(updateKeyboardState, 250); });
    cap.input.addEventListener('blur', () => { setTimeout(() => { updateKeyboardState(); updateCaptureUI(); }, 0); });
    cap.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) commitCard('right');
      else cap.input.blur();
    });
    // Tapping anywhere on the card starts typing.
    cap.card.addEventListener('click', (e) => {
      if (drag.justDragged || state.capturing || e.target.closest('button')) return;
      if (e.target !== cap.input) cap.input.focus();
    });

    // Swipe gestures (Pointer Events: touch + mouse + pen)
    cap.card.addEventListener('pointerdown', onCardPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateKeyboardState);
      window.visualViewport.addEventListener('scroll', updateKeyboardState);
    }

    // Bank search: live, no entrance animation
    $('#bank-search').addEventListener('input', (e) => {
      state.query = e.target.value;
      renderBank();
    });

    // Place search
    $('#place-search').addEventListener('input', (e) => {
      state.placeDraft.query = e.target.value;
      if (state.placeDraft.selectedId === 'custom') state.placeDraft.selectedId = null;
      renderFindList();
    });
    $('#place-search').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (state.placeDraft.query.trim()) {
        const first = findCandidates()[0];
        if (first) { state.placeDraft.selectedId = first.id; renderFindList(); }
      }
      e.target.blur();
    });

    // Sheets: drag handles, Escape
    $$('.sheet').forEach(initSheetDrag);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!recorder.el.hidden) stopSpeech();
      else if (state.sheet) closeSheet();
      else if (state.expandedId) setExpanded(null);
    });

    // Recorder: tap anywhere to stop
    recorder.el.addEventListener('click', stopSpeech);

    // Daily recap: a time per weekday
    $('#recap-days').addEventListener('change', (e) => {
      const day = e.target.dataset.recapTime;
      if (day && isTime(e.target.value)) updateRecap((r) => { r.days[day].time = e.target.value; });
    });

    // A tapped notification asks the open app to show the right thought
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (e) => {
        const data = e.data || {};
        if (data.type !== 'open-from-notification') return;
        if (data.thoughtId) openThought(data.thoughtId);
        else if (data.kind === 'recap') navigate('bank');
      });
    }
    window.addEventListener('hashchange', handleDeepLink);
    window.addEventListener('online', () => syncNow());

    // Returning to the app: clean up, refresh, check reminders
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onReturnToApp(); });
    window.addEventListener('focus', onReturnToApp);
    window.addEventListener('pageshow', (e) => { if (e.persisted) onReturnToApp(); });

    // Other tabs changing data
    window.addEventListener('storage', (e) => {
      if (e.key === KEYS.thoughts) onReturnToApp();
      if (e.key === KEYS.settings) { loadSettings(); applyTheme(); renderSettings(); }
    });

    // Midnight passes while open + reminders come due
    setInterval(() => {
      const removed = cleanupCompletedThoughtsFromPreviousDays();
      if (removed && state.screen === 'bank') renderBank({ flip: true });
      updateGreeting();
      checkDueReminders();
    }, 20000);

    if (motionQuery.addEventListener) motionQuery.addEventListener('change', () => {});
  }

  function detectSafeArea() {
    const probe = el('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none';
    document.body.append(probe);
    const top = parseFloat(getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    // Real notch or installed app: hide the decorative status-bar shape.
    document.body.classList.toggle('has-safe-area', top > 20 || standalone);
  }

  /** iPhone Home Screen app: size the app to the full screen (iOS leaves out the status bar). */
  function fitToScreen() {
    const on = isIOS() && isStandalone();
    document.body.classList.toggle('ios-standalone', on);
    if (!on) return;
    const portrait = window.innerHeight >= window.innerWidth;
    const full = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    document.documentElement.style.setProperty('--app-h', `${Math.max(full, window.innerHeight)}px`);
  }

  function playIntroOnce() {
    if (session.get(KEYS.intro)) return;
    session.set(KEYS.intro, '1');
    document.body.classList.add('intro');
    setTimeout(() => document.body.classList.remove('intro'), 1300);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
    if (!secure) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch((err) => console.info('[Thought Cards] Offline support unavailable:', err));
    });
  }

  /* Small helpers for testing in the browser console. */
  window.thoughtCardsDebug = {
    version: APP_VERSION,
    /** Moves every Done thought to yesterday 23:50. Reload afterwards to see the cleanup. */
    backdateCompleted() {
      const y = addDays(new Date(), -1);
      y.setHours(23, 50, 0, 0);
      let n = 0;
      state.thoughts.forEach((t) => { if (t.isCompleted) { t.completedAt = y.toISOString(); n++; } });
      saveThoughts();
      return `${n} done thought(s) now completed yesterday 23:50. Reload the page to see the cleanup.`;
    },
    cleanup: () => cleanupCompletedThoughtsFromPreviousDays(),
    /** Makes the newest open reminder come due right now (shows the in-app nudge). */
    triggerReminder() {
      const t = state.thoughts.find((x) => !x.isCompleted && x.reminder.enabled);
      if (!t) return 'No open thought with a reminder.';
      const past = new Date(Date.now() - 60000);
      t.reminder.date = localDateKey(past);
      t.reminder.time = `${pad(past.getHours())}:${pad(past.getMinutes())}`;
      t.reminder.notifiedAt = null;
      saveThoughts();
      checkDueReminders();
      return `Nudged: ${t.text}`;
    },
    thoughts: () => JSON.parse(JSON.stringify(state.thoughts)),
    resetAll() {
      Object.values(KEYS).forEach((k) => storage.remove(k));
      location.reload();
    },
  };

  function init() {
    loadDevice();
    loadSettings();
    applyTheme();
    loadThoughts();
    cleanupCompletedThoughtsFromPreviousDays();
    state.places = normalizePlaces(storage.read(KEYS.places, null));
    if (!storage.has(KEYS.places)) savePlaces();

    restoreDraft();
    initClock();
    buildRecapDays();
    bindEvents();
    detectSafeArea();
    fitToScreen();
    window.addEventListener('orientationchange', () => setTimeout(fitToScreen, 300));
    window.addEventListener('resize', fitToScreen);
    renderSettings();
    navigate('capture', { initial: true });
    updateGreeting();
    playIntroOnce();
    checkDueReminders();
    registerServiceWorker();
    handleDeepLink();
    verifyPush();
  }

  init();
})();
