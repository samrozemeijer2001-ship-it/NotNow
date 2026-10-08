/* =========================================================
   Thought Cards — push server (Cloudflare Worker + D1)

   One file, no dependencies: paste it into the Cloudflare
   dashboard editor. It needs:
     • a D1 database bound as  DB
     • a Cron Trigger           * * * * *   (every minute)
   Optional variables:
     • VAPID_SUBJECT   e.g. mailto:you@example.com
     • ALLOWED_ORIGIN  e.g. https://yourname.github.io

   The server creates its own tables and its own VAPID key
   pair on first use and keeps them in the database.

   Sections
    1. Config & helpers     5. Web Push (VAPID + aes128gcm)
    2. Database             6. Scheduler (reminders + recap)
    3. Validation           7. HTTP API
    4. Time zones           8. Worker entry points
   ========================================================= */

/* ===================== 1. CONFIG & HELPERS ===================== */
const DEFAULT_SUBJECT = 'mailto:hello@thoughtcards.app';
const LATE_LIMIT_MS = 6 * 60 * 60 * 1000;   // skip reminders more than 6 h late
const RECAP_WINDOW_MIN = 90;                // send a missed recap up to 90 min late
const MAX_BODY_BYTES = 256 * 1024;
const MAX_THOUGHTS = 500;
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const te = new TextEncoder();
const enc = (s) => te.encode(s);

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}
function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlString = (str) => b64url(enc(str));
function b64urlDecode(str) {
  const norm = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(norm + '='.repeat((4 - (norm.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function sha256Hex(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}
function safeJson(text, fallback) {
  try { return text ? JSON.parse(text) : fallback; } catch (_) { return fallback; }
}
function truncate(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/* ===================== 2. DATABASE ===================== */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS config (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS devices (
     id           TEXT PRIMARY KEY,
     token_hash   TEXT NOT NULL,
     subscription TEXT,
     timezone     TEXT NOT NULL DEFAULT 'UTC',
     recap        TEXT,
     thoughts     TEXT NOT NULL DEFAULT '[]',
     sent         TEXT NOT NULL DEFAULT '{}',
     last_recap   TEXT,
     created_at   INTEGER NOT NULL,
     updated_at   INTEGER NOT NULL
   )`,
];
let schemaReady = false;

async function ensureSchema(env) {
  if (schemaReady) return;
  if (!env.DB) throw new HttpError(500, 'Database not connected yet. Add a D1 binding named DB to this Worker.');
  for (const sql of SCHEMA) await env.DB.prepare(sql).run();
  schemaReady = true;
}

/** VAPID key pair: generated once, stored in the config table. */
let vapidCache = null;
async function getVapid(env) {
  if (vapidCache) return vapidCache;
  await ensureSchema(env);
  let row = await env.DB.prepare('SELECT value FROM config WHERE key = ?').bind('vapid').first();
  if (!row) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    await env.DB.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)')
      .bind('vapid', JSON.stringify({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }))
      .run();
    row = await env.DB.prepare('SELECT value FROM config WHERE key = ?').bind('vapid').first();
  }
  const jwk = JSON.parse(row.value);
  const privateKey = await crypto.subtle.importKey(
    'jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const publicKey = b64url(concat(new Uint8Array([4]), b64urlDecode(jwk.x), b64urlDecode(jwk.y)));
  vapidCache = { publicKey, privateKey };
  return vapidCache;
}

async function getDevice(env, id) {
  return env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(id).first();
}
async function deleteDevice(env, id) {
  await env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(id).run();
}

/* ===================== 3. VALIDATION ===================== */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

function checkIdentity(body) {
  if (typeof body.deviceId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(body.deviceId)) throw new HttpError(400, 'Invalid deviceId');
  if (typeof body.token !== 'string' || body.token.length < 16 || body.token.length > 200) throw new HttpError(400, 'Invalid token');
}

function cleanSubscription(sub) {
  if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string') throw new HttpError(400, 'Invalid subscription');
  let url;
  try { url = new URL(sub.endpoint); } catch (_) { throw new HttpError(400, 'Invalid subscription endpoint'); }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new HttpError(400, 'Subscription endpoint must use https');
  const keys = sub.keys || {};
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') throw new HttpError(400, 'Subscription keys missing');
  if (b64urlDecode(keys.p256dh).length !== 65 || b64urlDecode(keys.auth).length < 16) throw new HttpError(400, 'Subscription keys malformed');
  return { endpoint: sub.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

function cleanTimezone(tz) {
  if (typeof tz !== 'string' || !tz) return 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (_) { return 'UTC'; }
}

function cleanRecap(recap) {
  if (!recap || typeof recap !== 'object') return null;
  const days = {};
  for (const key of WEEKDAYS) {
    const d = recap.days && recap.days[key];
    days[key] = { on: !!(d && d.on), time: d && isTime(d.time) ? d.time : '21:00' };
  }
  return { enabled: recap.enabled === true, days };
}

function cleanThoughts(list) {
  if (!Array.isArray(list)) throw new HttpError(400, 'thoughts must be an array');
  return list.slice(0, MAX_THOUGHTS)
    .filter((t) => t && typeof t.id === 'string' && typeof t.text === 'string' && t.text.trim())
    .map((t) => ({
      id: t.id.slice(0, 80),
      text: t.text.trim().slice(0, 600),
      isImportant: t.isImportant === true,
      isCompleted: t.isCompleted === true,
      completedAt: isIso(t.completedAt) ? t.completedAt : null,
      createdAt: isIso(t.createdAt) ? t.createdAt : null,
      reminderAt: typeof t.reminderAt === 'number' && Number.isFinite(t.reminderAt) ? t.reminderAt : null,
    }));
}

async function authorize(env, body) {
  checkIdentity(body);
  const device = await getDevice(env, body.deviceId);
  if (!device) throw new HttpError(404, 'Unknown device');
  if (device.token_hash !== await sha256Hex(body.token)) throw new HttpError(403, 'Not allowed');
  return device;
}

/* ===================== 4. TIME ZONES ===================== */
/** Local date, weekday and minute-of-day for a moment in a given IANA time zone. */
function localParts(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: p.weekday.slice(0, 3).toLowerCase(),
    minutes: hour * 60 + Number(p.minute),
  };
}
const toMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/* ===================== 5. WEB PUSH ===================== */
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** RFC 8291 message encryption (Content-Encoding: aes128gcm, single record). */
async function encryptPayload(keys, plaintext) {
  const uaPublic = b64urlDecode(keys.p256dh);
  const authSecret = b64urlDecode(keys.auth);

  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const keyInfo = concat(enc('WebPush: info\u0000'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc('Content-Encoding: aes128gcm\u0000'), 16);
  const nonce = await hkdf(salt, ikm, enc('Content-Encoding: nonce\u0000'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = concat(plaintext, new Uint8Array([2])); // 0x02 = last record
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

/** VAPID (RFC 8292) JWT signed with ES256. */
async function vapidJwt(privateKey, audience, subject) {
  const head = b64urlString(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64urlString(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, enc(`${head}.${claims}`)));
  return `${head}.${claims}.${b64url(signature)}`;
}

async function sendPush(env, subscription, message) {
  const { publicKey, privateKey } = await getVapid(env);
  const audience = new URL(subscription.endpoint).origin;
  const jwt = await vapidJwt(privateKey, audience, env.VAPID_SUBJECT || DEFAULT_SUBJECT);
  const body = await encryptPayload(subscription.keys, enc(JSON.stringify(message)));
  let res;
  try {
    res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${jwt}, k=${publicKey}`,
        TTL: '86400',
        Urgency: 'high',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
      },
      body,
    });
  } catch (err) {
    return { ok: false, status: 0, gone: false, detail: String(err) };
  }
  const detail = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 300);
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410, detail };
}

/* ===================== 6. SCHEDULER ===================== */
function reminderMessage(thought) {
  return {
    kind: 'reminder',
    title: 'A gentle nudge',
    body: truncate(thought.text, 180),
    tag: `thought-${thought.id}`,
    thoughtId: thought.id,
    url: `./#thought=${encodeURIComponent(thought.id)}`,
  };
}

function recapMessage(thoughts, timeZone, today) {
  const open = thoughts.filter((t) => !t.isCompleted);
  const doneToday = thoughts.filter((t) => t.isCompleted && t.completedAt && localParts(Date.parse(t.completedAt), timeZone).date === today).length;
  const byCreated = (a, b) => (Date.parse(b.createdAt || 0) || 0) - (Date.parse(a.createdAt || 0) || 0);
  const sorted = [...open.filter((t) => t.isImportant).sort(byCreated), ...open.filter((t) => !t.isImportant).sort(byCreated)];
  const doneLine = doneToday ? `You let go of ${doneToday} today. ` : '';

  if (!sorted.length) {
    return {
      kind: 'recap', title: 'All clear', tag: `recap-${today}`, url: './#bank',
      body: doneToday ? `You let go of ${doneToday} thought${doneToday === 1 ? '' : 's'} today. Nothing is waiting.` : 'Nothing is waiting for you. Your head is clear.',
    };
  }
  const shown = sorted.slice(0, 3).map((t) => truncate(t.text, 42));
  const more = sorted.length > 3 ? ` +${sorted.length - 3} more` : '';
  return {
    kind: 'recap',
    title: `${sorted.length} thought${sorted.length === 1 ? '' : 's'} still waiting`,
    body: `${doneLine}${shown.join(' · ')}${more}`,
    tag: `recap-${today}`,
    url: './#bank',
  };
}

/** Works out what one device should receive at `now` and sends it. */
async function processDevice(env, row, now) {
  const subscription = safeJson(row.subscription, null);
  if (!subscription) return { sent: 0 };
  const thoughts = safeJson(row.thoughts, []);
  const sent = safeJson(row.sent, {});
  const recap = safeJson(row.recap, null);
  const timeZone = cleanTimezone(row.timezone);
  let lastRecap = row.last_recap || null;
  let changed = false;
  const outbox = [];

  // Forget bookkeeping for thoughts that no longer exist.
  const ids = new Set(thoughts.map((t) => t.id));
  for (const id of Object.keys(sent)) if (!ids.has(id)) { delete sent[id]; changed = true; }

  // Time reminders
  for (const t of thoughts) {
    if (t.isCompleted || typeof t.reminderAt !== 'number' || t.reminderAt > now) continue;
    if (sent[t.id] === t.reminderAt) continue;
    sent[t.id] = t.reminderAt;
    changed = true;
    if (now - t.reminderAt <= LATE_LIMIT_MS) outbox.push({ message: reminderMessage(t), undo: () => { delete sent[t.id]; } });
  }

  // Daily recap at the chosen local time for today's weekday
  if (recap && recap.enabled && recap.days) {
    const local = localParts(now, timeZone);
    const day = recap.days[local.weekday];
    if (day && day.on && isTime(day.time) && lastRecap !== local.date) {
      const late = local.minutes - toMinutes(day.time);
      if (late >= 0 && late < RECAP_WINDOW_MIN) {
        const previous = lastRecap;
        lastRecap = local.date;
        changed = true;
        outbox.push({ message: recapMessage(thoughts, timeZone, local.date), undo: () => { lastRecap = previous; } });
      }
    }
  }

  let delivered = 0;
  for (const item of outbox) {
    const result = await sendPush(env, subscription, item.message);
    if (result.gone) { await deleteDevice(env, row.id); return { sent: delivered, removed: true }; }
    if (result.ok) delivered++;
    else { item.undo(); console.warn('Push failed', row.id, result.status, result.detail); }
  }

  if (changed) {
    await env.DB.prepare('UPDATE devices SET sent = ?, last_recap = ? WHERE id = ?')
      .bind(JSON.stringify(sent), lastRecap, row.id).run();
  }
  return { sent: delivered };
}

async function runSchedule(env, now) {
  await ensureSchema(env);
  const { results } = await env.DB.prepare('SELECT * FROM devices WHERE subscription IS NOT NULL').all();
  let total = 0;
  for (const row of results || []) {
    try { total += (await processDevice(env, row, now)).sent; } catch (err) { console.error('Device failed', row.id, err); }
  }
  return total;
}

/* ===================== 7. HTTP API ===================== */
function corsHeaders(env, request) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean);
  let allow = '*';
  if (!allowed.includes('*')) allow = origin && allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}
async function readJson(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_BODY_BYTES) throw new HttpError(413, 'Request too large');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request too large');
  const body = safeJson(text, null);
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Expected a JSON body');
  return body;
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'GET' && path === '/') {
    await ensureSchema(env);
    const { publicKey } = await getVapid(env);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first();
    return { status: 200, body: { ok: true, service: 'Thought Cards push server', devices: count ? count.n : 0, publicKey } };
  }
  if (request.method === 'GET' && path === '/api/config') {
    const { publicKey } = await getVapid(env);
    return { status: 200, body: { publicKey } };
  }
  if (request.method !== 'POST') throw new HttpError(404, 'Not found');

  await ensureSchema(env);
  const body = await readJson(request);
  const now = Date.now();

  if (path === '/api/register') {
    checkIdentity(body);
    const subscription = cleanSubscription(body.subscription);
    const timezone = cleanTimezone(body.timezone);
    const tokenHash = await sha256Hex(body.token);
    const existing = await getDevice(env, body.deviceId);
    if (existing && existing.token_hash !== tokenHash) throw new HttpError(403, 'Not allowed');
    if (existing) {
      await env.DB.prepare('UPDATE devices SET subscription = ?, timezone = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(subscription), timezone, now, body.deviceId).run();
    } else {
      await env.DB.prepare('INSERT INTO devices (id, token_hash, subscription, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(body.deviceId, tokenHash, JSON.stringify(subscription), timezone, now, now).run();
    }
    return { status: 200, body: { ok: true } };
  }

  if (path === '/api/sync') {
    const device = await authorize(env, body);
    const timezone = body.timezone ? cleanTimezone(body.timezone) : device.timezone;
    const recap = body.recap !== undefined ? JSON.stringify(cleanRecap(body.recap)) : device.recap;
    const thoughts = body.thoughts !== undefined ? JSON.stringify(cleanThoughts(body.thoughts)) : device.thoughts;
    const subscription = body.subscription ? JSON.stringify(cleanSubscription(body.subscription)) : device.subscription;
    await env.DB.prepare('UPDATE devices SET timezone = ?, recap = ?, thoughts = ?, subscription = ?, updated_at = ? WHERE id = ?')
      .bind(timezone, recap, thoughts, subscription, now, body.deviceId).run();
    return { status: 200, body: { ok: true } };
  }

  if (path === '/api/test') {
    const device = await authorize(env, body);
    const subscription = safeJson(device.subscription, null);
    if (!subscription) throw new HttpError(409, 'No subscription for this device');
    const result = await sendPush(env, subscription, {
      kind: 'test', title: 'Thought Cards', body: 'This is how your reminders will look. 👋', tag: 'test', url: './',
    });
    if (result.gone) await deleteDevice(env, device.id);
    return { status: result.ok ? 200 : 502, body: { ok: result.ok, status: result.status, detail: result.detail } };
  }

  if (path === '/api/unregister') {
    await authorize(env, body);
    await deleteDevice(env, body.deviceId);
    return { status: 200, body: { ok: true } };
  }

  throw new HttpError(404, 'Not found');
}

/* ===================== 8. ENTRY POINTS ===================== */
export default {
  async fetch(request, env) {
    const headers = corsHeaders(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try {
      const { status, body } = await handle(request, env);
      return json(body, status, headers);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      return json({ ok: false, error: err instanceof HttpError ? err.message : 'Something went wrong on the server.' }, status, headers);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSchedule(env, event.scheduledTime || Date.now()));
  },
};

// Exposed for local tests only; Cloudflare ignores extra named exports.
export const __test = { runSchedule, localParts, recapMessage, encryptPayload };
