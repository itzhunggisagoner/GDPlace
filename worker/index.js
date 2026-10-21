// GD Place – Cloudflare Worker + D1
// Replaces all of Firebase (Auth, Realtime DB, Cloud Functions) from the original.
import OBJECTS from "../src/objects.json";
import DEFAULT_COLORS from "../src/defaultColors.json";

const GD_SECRET = "Wmfv3899gc9"; // public secret of the GD client
const GJP2_SALT = "mI29fmAnxgTs";
const SESSION_TTL = 30 * 24 * 3600 * 1000;

// ---- level constants (same as src/editor/nodes.ts) ----
const CHUNK = 20 * 30;
// default size of the build area, in grid cells (admins can change it in the Admin panel)
const DEFAULT_LEVEL_W = Math.round(250 * 10.3761348898);
const DEFAULT_LEVEL_H = 80;

const OBJ_BY_ID = new Map(OBJECTS.map((o) => [o.id, o]));


// ---------- security ----------
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' https://static.cloudflareinsights.com", // PixiJS 6 uses new Function()
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "connect-src 'self' https://cloudflareinsights.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function withSecurityHeaders(res, req) {
  const r = new Response(res.body, res); // assets responses are immutable, so copy
  r.headers.set("Content-Security-Policy", CSP);
  r.headers.set("X-Content-Type-Options", "nosniff");
  r.headers.set("X-Frame-Options", "DENY");
  r.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  r.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (new URL(req.url).protocol === "https:")
    r.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return r;
}

// Blocks cross-site POSTs (CSRF) on top of SameSite=Lax: the Origin header must match this site.
function sameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetches from some browsers omit it
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

// Optional Cloudflare Rate Limiting binding (see wrangler.jsonc "ratelimits").
async function rateLimited(env, binding, key) {
  if (!env[binding]) return false;
  try {
    const { success } = await env[binding].limit({ key });
    return !success;
  } catch {
    return false;
  }
}
const clientIp = (req) => req.headers.get("cf-connecting-ip") || "unknown";

// ---------- utilities ----------
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
const err = (status, error) => json({ error }, status);

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const digest = async (algo, s) => hex(await crypto.subtle.digest(algo, new TextEncoder().encode(s)));
const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

// ---------- configuration ----------
// GD_SERVER can hold several addresses separated by commas: they are tried in order until one is not blocked.
// If RobTop's server blocks Cloudflare IPs, point GD_SERVER at a proxy (e.g. dankmeme01/GDProxy,
// https://github.com/dankmeme01/gdproxy) and set the GD_PROXY_TOKEN secret if the proxy needs an Authorization header.
const gdServers = (env) =>
  String(env.GD_SERVER || "https://www.boomlings.com/database")
    .split(",")
    .map((x) => x.trim().replace(/\/$/, ""))
    // never send the GD password over plain http
    .filter((x) => x.startsWith("https://"));
const gdHeaders = (env) => {
  const h = { "content-type": "application/x-www-form-urlencoded", "user-agent": "" };
  if (env.GD_PROXY_TOKEN) h.authorization = String(env.GD_PROXY_TOKEN);
  return h;
};
const looksBlocked = (res, text) => res.status === 403 || res.status === 429 || res.status >= 500 || /error code|1020|1015|1008|cloudflare|banned|<html/i.test(text);
const adminNames = (env) =>
  String(env.ADMIN_USERS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

async function getSettings(env) {
  const { results } = await env.DB.prepare("SELECT k, v FROM settings").all();
  const m = Object.fromEntries(results.map((r) => [r.k, r.v]));
  const num = (k, d) => (m[k] !== undefined && m[k] !== "" && !Number.isNaN(+m[k]) ? +m[k] : d);
  return {
    placeTimer: num("placeTimer", +env.PLACE_TIMER || 300),
    deleteTimer: num("deleteTimer", +env.DELETE_TIMER || 300),
    canEdit: m.canEdit !== "0",
    chunkObjectLimit: num("chunkObjectLimit", +env.CHUNK_OBJECT_LIMIT || 1500),
    chunkObjectLimitCustom: m.chunkObjectLimit !== undefined && m.chunkObjectLimit !== "" ? +m.chunkObjectLimit : null,
    streamLink: m.streamLink || null,
    reloadId: m.reloadId || null,
    levelWidth: num("levelWidth", DEFAULT_LEVEL_W),
    levelHeight: num("levelHeight", DEFAULT_LEVEL_H),
    globalMessage: m.globalMessage ? { id: m.globalMessageId || "0", text: m.globalMessage } : null,
    BG_CHANGES: m.BG_CHANGES ? JSON.parse(m.BG_CHANGES) : DEFAULT_COLORS.BG_CHANGES,
    GROUND_CHANGES: m.GROUND_CHANGES ? JSON.parse(m.GROUND_CHANGES) : DEFAULT_COLORS.GROUND_CHANGES,
  };
}

// ---------- GD API ----------
async function gdLogin(env, username, password) {
  const gjp2 = await digest("SHA-1", password + GJP2_SALT);
  const body = () =>
    new URLSearchParams({
      udid: "S" + Math.floor(Math.random() * 1e9),
      userName: username,
      password, // old server
      gjp2, // server 2.2
      secret: GD_SECRET,
    });
  let lastRaw = "";
  let blocked = false;
  for (const server of gdServers(env)) {
    try {
      const res = await fetch(`${server}/accounts/loginGJAccount.php`, {
        method: "POST",
        headers: gdHeaders(env),
        body: body(),
      });
      const text = (await res.text()).trim();
      if (/^\d+,\d+$/.test(text)) {
        const [accountID, userID] = text.split(",").map(Number);
        return { ok: true, accountID, userID, server };
      }
      lastRaw = text;
      if (looksBlocked(res, text)) {
        blocked = true;
        continue; // try the next server
      }
      return { ok: false, raw: text, blocked: false }; // GD replied clearly (wrong name/password...)
    } catch (e) {
      blocked = true;
      lastRaw = String(e);
    }
  }
  return { ok: false, raw: lastRaw, blocked };
}

// Canonical (correctly capitalised) account name – on failure, use the username that was typed.
async function gdUserName(env, accountID, fallback, server) {
  try {
    const res = await fetch(`${server || gdServers(env)[0]}/getGJUserInfo20.php`, {
      method: "POST",
      headers: gdHeaders(env),
      body: new URLSearchParams({ targetAccountID: String(accountID), secret: GD_SECRET }),
    });
    const parts = (await res.text()).split(":");
    for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i] === "1" && parts[i + 1]) return parts[i + 1];
  } catch {}
  return fallback;
}

// ---------- session ----------
function getCookie(req, name) {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? m[1] : null;
}
const cookie = (token, maxAge, secure) =>
  `gdp_session=${token}; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Max-Age=${maxAge}`;
const isHttps = (req) => new URL(req.url).protocol === "https:";

async function auth(req, env) {
  const token = getCookie(req, "gdp_session");
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.account_id, u.username,
            COALESCE(p.last_placed,0) last_placed, COALESCE(p.last_deleted,0) last_deleted,
            COALESCE(p.banned,0) banned, COALESCE(p.is_admin,0) is_admin,
            p.place_timer, p.delete_timer, p.display_color
       FROM sessions s
       JOIN users u ON u.account_id = s.account_id
       LEFT JOIN profiles p ON p.account_id = u.account_id
      WHERE s.token_hash = ? AND s.expires_at > ?`
  )
    .bind(await digest("SHA-256", token), Date.now())
    .first();
  if (!row) return null;
  // "owner" = listed in ADMIN_USERS (wrangler.jsonc). Owners are always admins and can't be demoted/banned from the panel.
  row.owner = adminNames(env).includes(String(row.username).toLowerCase());
  row.admin = !!row.is_admin || row.owner;
  return row;
}

// shape sent to the client (matches UserProperties in src/backend/auth.ts)
const publicUser = (u) => ({
  uid: String(u.account_id),
  username: u.username,
  lastPlaced: u.last_placed,
  lastDeleted: u.last_deleted,
  placeTimer: u.place_timer || null,
  deleteTimer: u.delete_timer || null,
  admin: !!u.admin,
  banned: !!u.banned,
  displayColor: u.display_color || null,
});

// ---------- handlers ----------
async function login(req, env) {
  if (await rateLimited(env, "LOGIN_LIMITER", clientIp(req)))
    return err(429, "Too many login attempts, try again in a minute");
  const { username, password } = await req.json().catch(() => ({}));
  if (typeof username !== "string" || typeof password !== "string" || !username || !password || username.length > 20 || password.length > 40)
    return err(400, "Missing or malformed username / password");
  let r;
  try {
    r = await gdLogin(env, username.trim(), password);
  } catch {
    return err(502, "Could not reach the Geometry Dash servers");
  }
  if (!r.ok) {
    return err(
      r.blocked ? 502 : 401,
      r.blocked
        ? "Geometry Dash servers are unreachable or blocking this server (set GD_SERVER to a proxy)"
        : "Wrong Geometry Dash username or password"
    );
  }
  const name = await gdUserName(env, r.accountID, username.trim(), r.server);
  const now = Date.now();
  const token = randHex(32);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users(account_id,user_id,username,last_action,created_at) VALUES(?,?,?,0,?)
       ON CONFLICT(account_id) DO UPDATE SET username=excluded.username, user_id=excluded.user_id`
    ).bind(r.accountID, r.userID, name, now),
    env.DB.prepare("INSERT OR IGNORE INTO profiles(account_id) VALUES(?)").bind(r.accountID),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)").bind(
      await digest("SHA-256", token),
      r.accountID,
      now + SESSION_TTL
    ),
  ]);
  const u = await auth(new Request(req.url, { headers: { cookie: `gdp_session=${token}` } }), env);
  return json({ serverTime: Date.now(), me: publicUser(u) }, 200, {
    "set-cookie": cookie(token, SESSION_TTL / 1000, isHttps(req)),
  });
}

async function logout(req, env) {
  const t = getCookie(req, "gdp_session");
  if (t) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest("SHA-256", t)).run();
  return json({ ok: true }, 200, { "set-cookie": cookie("", 0, isHttps(req)) });
}

async function state(req, env) {
  const [st, user, uc, tp, td, sq] = await Promise.all([
    getSettings(env),
    auth(req, env),
    env.DB.prepare("SELECT COUNT(*) n FROM profiles").first(),
    env.DB.prepare("SELECT COUNT(*) n FROM obj_history WHERE kind='place'").first(),
    env.DB.prepare("SELECT COUNT(*) n FROM obj_history WHERE kind='delete'").first(),
    env.DB.prepare("SELECT seq FROM sqlite_sequence WHERE name='changes'").first(),
  ]);
  const now = Date.now();
  return json({
    serverTime: now,
    seq: sq ? sq.seq : 0,
    editorState: {
      placeTimer: st.placeTimer,
      deleteTimer: st.deleteTimer,
      canEdit: st.canEdit,
    },
    userCount: uc.n,
    totalPlaced: tp.n,
    totalDeleted: td.n,
    streamLink: st.streamLink,
    message: st.globalMessage,
    // only admins get the raw values they can edit, so the panel can show them after a refresh
    adminSettings: user && user.admin ? { chunkObjectLimit: st.chunkObjectLimitCustom } : null,
    level: { width: st.levelWidth, height: st.levelHeight },
    reloadId: st.reloadId,
    colors: { BG_CHANGES: st.BG_CHANGES, GROUND_CHANGES: st.GROUND_CHANGES },
    me: user ? publicUser(user) : null,
  });
}

const CHUNK_RE = /^\d{1,3},\d{1,2}$/;

async function chunk(url, env) {
  const c = url.searchParams.get("c") || "";
  if (!CHUNK_RE.test(c)) return err(400, "Invalid chunk");
  const [{ results }, sq] = await Promise.all([
    env.DB.prepare("SELECT id, data FROM objects WHERE chunk = ?").bind(c).all(),
    env.DB.prepare("SELECT seq FROM sqlite_sequence WHERE name='changes'").first(),
  ]);
  const objects = {};
  for (const r of results) objects[r.id] = r.data;
  return json({ seq: sq ? sq.seq : 0, objects });
}

async function changes(url, env) {
  const since = Math.max(0, parseInt(url.searchParams.get("since")) || 0);
  const LIMIT = 500;
  const [{ results }, sq] = await Promise.all([
    env.DB.prepare("SELECT seq, chunk, key, kind, data, by FROM changes WHERE seq > ? ORDER BY seq LIMIT ?")
      .bind(since, LIMIT)
      .all(),
    env.DB.prepare("SELECT seq FROM sqlite_sequence WHERE name='changes'").first(),
  ]);
  const head = sq ? sq.seq : 0;
  // client is too far behind (log was pruned) -> tell it to reset and reload the chunks it is viewing
  const reset = since < head && (results.length === 0 || results[0].seq > since + 1);
  const last = results.length ? results[results.length - 1].seq : since;
  return json({ seq: reset ? head : last, head, more: results.length === LIMIT, reset, changes: reset ? [] : results });
}

async function placedBy(url, env) {
  const key = parseInt(url.searchParams.get("key"));
  if (!Number.isInteger(key)) return json({ username: null });
  const r = await env.DB.prepare("SELECT username FROM objects WHERE id = ?").bind(key).first();
  return json({ username: r ? r.username : null });
}

async function userColor(url, env) {
  const name = (url.searchParams.get("u") || "").slice(0, 32);
  if (!name) return json({ color: null });
  const r = await env.DB.prepare(
    `SELECT p.display_color c FROM users u JOIN profiles p ON p.account_id = u.account_id
      WHERE lower(u.username) = lower(?)`
  )
    .bind(name)
    .first();
  return json({ color: r ? r.c : null });
}

// ---------- object validation (ported from cloudfunctions/functions/src/index.ts) ----------
function validateObject(props, st) {
  if (props.length < 13) return "Invalid object";
  const [id, x, y, rotation, flip, scale, zOrder, mainColor, mainBlending, mainOpacity, detailColor, detailBlending, detailOpacity] =
    props;
  const found = OBJ_BY_ID.get(parseInt(id));
  if (!found) return "Invalid object id";
  const fx = parseFloat(x),
    fy = parseFloat(y);
  if (!(fx >= 0 && fx <= st.levelWidth * 30 && fy >= 0 && fy <= st.levelHeight * 30)) return "Invalid object position";
  const rot = parseFloat(rotation);
  if (!Number.isFinite(rot) || rot !== Math.round(rot)) return "Invalid object rotation";
  if (found.solid && rot % 90 !== 0) return "Invalid object rotation";
  if (flip !== "0" && flip !== "1") return "Invalid object flip";
  const sc = parseFloat(scale);
  if (!(sc >= 0.5 && sc <= 2)) return "Invalid object scale";
  const z = parseInt(zOrder);
  if (!(z >= -1 && z <= 121)) return "Invalid object zOrder";
  for (const [color, blending, opacity] of [
    [mainColor, mainBlending, mainOpacity],
    [detailColor, detailBlending, detailOpacity],
  ]) {
    if (!found.tintable && (color !== "ffffff" || blending !== "0" || opacity !== "1")) return "Invalid object mainColor";
    if (!/^[0-9a-f]{6}$/i.test(color)) return "Invalid object mainColor";
    if (blending !== "0" && blending !== "1") return "Invalid object mainBlending";
    if (blending === "1" && color === "000000") return "Invalid object mainColor (invisible)";
    const op = parseFloat(opacity);
    if (!(op >= 0.2 && op <= 1)) return "Invalid object mainOpacity";
  }
  return null;
}

// shared checks before placing / deleting; returns an error Response or null
function gate(u, st, now) {
  if (!st.canEdit) return err(403, "Editing is disabled");
  if (u.banned) return err(403, "User banned"); // admins too: a banned admin can't keep building
  return null;
}

async function place(req, env, ctx) {
  const u = await auth(req, env);
  if (!u) return err(401, "User is not authenticated");
  const { text } = await req.json().catch(() => ({}));
  if (typeof text !== "string" || text.length > 200) return err(400, "Invalid object");
  const props = text.split(";");
  const st = await getSettings(env);
  const bad = validateObject(props, st);
  if (bad) return err(400, bad);

  const now = Date.now();
  const g = gate(u, st, now);
  if (g) return g;

  const cx = Math.floor(parseFloat(props[1]) / CHUNK);
  const cy = Math.floor(parseFloat(props[2]) / CHUNK);
  const chunkName = `${cx},${cy}`;

  const cnt = await env.DB.prepare("SELECT COUNT(*) n FROM objects WHERE chunk = ?").bind(chunkName).first();
  if (cnt.n >= st.chunkObjectLimit && !u.admin)
    return err(429, "There are too many objects in this area! Maybe delete one instead?");

  // claim the turn (atomic) – admins have no cooldown
  if (!u.admin) {
    const timer = u.place_timer || st.placeTimer;
    const claim = await env.DB.prepare("UPDATE profiles SET last_placed = ? WHERE account_id = ? AND last_placed <= ?")
      .bind(now, u.account_id, now - (timer - 5) * 1000)
      .run();
    if (!claim.meta.changes) return err(429, "Object placed before cooldown");
  }

  let key;
  try {
    const ins = await env.DB.prepare(
      "INSERT INTO objects(chunk,data,account_id,username,placed_at) VALUES(?,?,?,?,?) RETURNING id"
    )
      .bind(chunkName, text, u.account_id, u.username, now)
      .first();
    key = String(ins.id);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO changes(chunk,key,kind,data,by,at) VALUES(?,?,'add',?,?,?)").bind(chunkName, key, text, u.username, now),
      env.DB.prepare("INSERT INTO obj_history(kind,key,chunk,data,account_id,username,at) VALUES('place',?,?,?,?,?,?)").bind(
        key, chunkName, text, u.account_id, u.username, now
      ),
    ]);
  } catch (e) {
    if (!u.admin) await env.DB.prepare("UPDATE profiles SET last_placed = ? WHERE account_id = ?").bind(u.last_placed, u.account_id).run();
    return err(500, "Database error");
  }
  if (Math.random() < 0.02) ctx.waitUntil(pruneChanges(env));
  return json({ ok: true, key, serverTime: now, lastPlaced: u.admin ? u.last_placed : now });
}

async function remove(req, env, ctx) {
  const u = await auth(req, env);
  if (!u) return err(401, "User is not authenticated");
  const { objId, chunkId } = await req.json().catch(() => ({}));
  const id = parseInt(objId);
  if (!Number.isInteger(id) || id < 1) return err(400, "Object id not provided");
  if (typeof chunkId !== "string" || !CHUNK_RE.test(chunkId)) return err(400, "Invalid chunk");

  const st = await getSettings(env);
  const now = Date.now();
  const g = gate(u, st, now);
  if (g) return g;

  const obj = await env.DB.prepare("SELECT data FROM objects WHERE id = ? AND chunk = ?").bind(id, chunkId).first();
  if (!obj) return err(404, "Object not found (maybe someone already deleted it)");

  if (!u.admin) {
    const timer = u.delete_timer || st.deleteTimer;
    const claim = await env.DB.prepare("UPDATE profiles SET last_deleted = ? WHERE account_id = ? AND last_deleted <= ?")
      .bind(now, u.account_id, now - (timer - 5) * 1000)
      .run();
    if (!claim.meta.changes) return err(429, "Object deleted before cooldown");
  }

  const del = await env.DB.prepare("DELETE FROM objects WHERE id = ? AND chunk = ?").bind(id, chunkId).run();
  if (!del.meta.changes) return err(404, "Object not found (maybe someone already deleted it)");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO changes(chunk,key,kind,data,by,at) VALUES(?,?,'del',?,?,?)").bind(chunkId, String(id), obj.data, u.username, now),
    env.DB.prepare("INSERT INTO obj_history(kind,key,chunk,data,account_id,username,at) VALUES('delete',?,?,?,?,?,?)").bind(
      String(id), chunkId, obj.data, u.account_id, u.username, now
    ),
  ]);
  if (Math.random() < 0.02) ctx.waitUntil(pruneChanges(env));
  return json({ ok: true, serverTime: now, lastDeleted: u.admin ? u.last_deleted : now });
}

const pruneChanges = (env) => env.DB.prepare("DELETE FROM changes WHERE at < ?").bind(Date.now() - 6 * 3600 * 1000).run();

// ---------- admin ----------
const SETTING_KEYS = new Set(["placeTimer", "deleteTimer", "canEdit", "chunkObjectLimit", "streamLink", "levelWidth", "levelHeight"]);

// Validates the value of a global setting. Returns an error string, or null when it is fine ("" = reset to default).
function validateSetting(key, value) {
  const v = value === null || value === undefined ? "" : String(value).trim();
  if (v === "") return null;
  const int = (min, max) => (/^\d{1,9}$/.test(v) && +v >= min && +v <= max ? null : `Must be a whole number from ${min} to ${max}`);
  switch (key) {
    case "placeTimer":
    case "deleteTimer":
      return int(0, 604800); // up to 7 days
    case "chunkObjectLimit":
      return int(1, 100000);
    case "levelWidth": // build area size in grid cells
      return int(10, 20000);
    case "levelHeight":
      return int(10, 2000);
    case "canEdit":
      return v === "0" || v === "1" ? null : "Must be 0 or 1";
    case "streamLink": {
      if (v.length > 300) return "Link is too long";
      try {
        const p = new URL(v);
        if (p.protocol !== "https:" && p.protocol !== "http:") return "Link must start with https:// or http://";
        if (!p.hostname || p.username || p.password) return "Not a valid public link";
        return null;
      } catch {
        return "Not a valid link. Include https:// or http://";
      }
    }
  }
  return "Unknown setting";
}

// Target of an admin action with the flags needed for the permission rules.
async function findTarget(env, username) {
  const r = await env.DB.prepare(
    `SELECT u.account_id, u.username, COALESCE(p.is_admin,0) is_admin, COALESCE(p.banned,0) banned
       FROM users u LEFT JOIN profiles p ON p.account_id = u.account_id
      WHERE lower(u.username) = lower(?)`
  )
    .bind(String(username || "").trim())
    .first();
  if (!r) return null;
  r.owner = adminNames(env).includes(String(r.username).toLowerCase());
  r.admin = !!r.is_admin || r.owner;
  return r;
}

async function findAccount(env, username) {
  const r = await env.DB.prepare("SELECT account_id FROM users WHERE lower(username) = lower(?)")
    .bind(String(username || "").trim())
    .first();
  return r ? r.account_id : null;
}

async function admin(req, env) {
  const u = await auth(req, env);
  if (!u) return err(401, "User is not authenticated");
  if (!u.admin) return err(403, "Admins only");
  if (u.banned) return err(403, "You are banned");
  const b = await req.json().catch(() => ({}));

  switch (b.action) {
    case "set": {
      if (!SETTING_KEYS.has(b.key)) return err(400, "Unknown setting");
      const bad = validateSetting(b.key, b.value);
      if (bad) return err(400, bad);
      const v = typeof b.value === "string" ? b.value.trim() : b.value;
      if (v === null || v === undefined || v === "") await env.DB.prepare("DELETE FROM settings WHERE k = ?").bind(b.key).run();
      else await env.DB.prepare("INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(b.key, String(v)).run();
      return json({ ok: true });
    }
    case "exportLevel": {
      // every object of the level (for the .gmd export)
      const { results } = await env.DB.prepare("SELECT data FROM objects ORDER BY id").all();
      return json({ objects: results.map((r) => r.data) });
    }
    case "reloadAll": {
      // every open page notices the new id on its next state refresh and reloads (keeping its progress)
      await env.DB.prepare("INSERT INTO settings(k,v) VALUES('reloadId',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(String(Date.now())).run();
      return json({ ok: true });
    }
    case "broadcast": {
      const text = String(b.text ?? "").trim().slice(0, 300);
      if (!text) return err(400, "Message is empty");
      const stmt = "INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v";
      await env.DB.batch([
        env.DB.prepare(stmt).bind("globalMessage", text),
        env.DB.prepare(stmt).bind("globalMessageId", String(Date.now())),
      ]);
      return json({ ok: true });
    }
    case "clearBroadcast": {
      await env.DB.prepare("DELETE FROM settings WHERE k IN ('globalMessage','globalMessageId')").run();
      return json({ ok: true });
    }
    case "ban":
    case "unban": {
      const t = await findTarget(env, b.username);
      if (!t) return err(404, "User not found (they must have logged in once)");
      if (b.action === "ban") {
        if (t.account_id === u.account_id) return err(400, "You can't ban yourself");
        if (t.owner) return err(403, `${t.username} is an owner and can't be banned`);
      }
      if (t.admin && !u.owner) return err(403, "Only owners can ban or unban admins");
      await env.DB.prepare("UPDATE profiles SET banned = ? WHERE account_id = ?").bind(b.action === "ban" ? 1 : 0, t.account_id).run();
      return json({ ok: true });
    }
    case "color": {
      const id = await findAccount(env, b.username);
      if (!id) return err(404, "User not found");
      const c = String(b.color || "").trim().toLowerCase();
      if (c && !/^[0-9a-f]{6}( [0-9a-f]{6}){0,5}$/.test(c)) return err(400, "Colour must be hex like ff00ff or 'ff00ff 00ffff'");
      await env.DB.prepare("UPDATE profiles SET display_color = ? WHERE account_id = ?").bind(c || null, id).run();
      return json({ ok: true });
    }
    case "userTimer": {
      const id = await findAccount(env, b.username);
      if (!id) return err(404, "User not found");
      const n = (x) => (x === "" || x == null ? null : Math.max(0, Math.floor(+x)) || null);
      await env.DB.prepare("UPDATE profiles SET place_timer = ?, delete_timer = ? WHERE account_id = ?")
        .bind(n(b.placeTimer), n(b.deleteTimer), id)
        .run();
      return json({ ok: true });
    }
    case "makeAdmin":
    case "removeAdmin": {
      if (!u.owner) return err(403, "Only owners can add or remove admins");
      const t = await findTarget(env, b.username);
      if (!t) return err(404, "User not found");
      if (t.owner) return err(400, `${t.username} is an owner (ADMIN_USERS in wrangler.jsonc) and always stays admin`);
      if (b.action === "removeAdmin" && t.account_id === u.account_id) return err(400, "You can't remove your own admin rights");
      await env.DB.prepare("UPDATE profiles SET is_admin = ? WHERE account_id = ?").bind(b.action === "makeAdmin" ? 1 : 0, t.account_id).run();
      return json({ ok: true });
    }
    default:
      return err(400, "Unknown action");
  }
}

// ---------- router ----------
export default {
  async fetch(req, env, ctx) {
    return withSecurityHeaders(await handle(req, env, ctx), req);
  },
};

async function handle(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      const p = url.pathname;
      const post = req.method === "POST";
      if (post && !sameOrigin(req)) return err(403, "Cross-site request blocked");
      if (p === "/api/state") return await state(req, env);
      if (p === "/api/chunk") return await chunk(url, env);
      if (p === "/api/changes") return await changes(url, env);
      if (p === "/api/placed") return await placedBy(url, env);
      if (p === "/api/color") return await userColor(url, env);
      if (p === "/api/login" && post) return await login(req, env);
      if (p === "/api/logout" && post) return await logout(req, env);
      if (p === "/api/place" && post) return await place(req, env, ctx);
      if (p === "/api/delete" && post) return await remove(req, env, ctx);
      if (p === "/api/admin" && post) return await admin(req, env);
      return err(404, "Not found");
    } catch (e) {
      console.error(e);
      return err(500, "Server error");
    }
}
