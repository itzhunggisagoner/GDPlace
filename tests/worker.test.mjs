// Worker security + gameplay tests. Run from the project root:
//   node --no-warnings tests/worker.test.mjs        (needs Node 22.5+, no npm packages)
// It runs worker/index.js against an in-memory SQLite database that mimics D1, and a fake
// Geometry Dash server, so nothing real is contacted.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// plain Node needs import attributes for JSON (wrangler's bundler adds them itself), so test a patched copy
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gdplace-test-"));
fs.mkdirSync(path.join(TMP, "worker")); fs.mkdirSync(path.join(TMP, "src"));
for (const f of fs.readdirSync(path.join(ROOT, "src"))) if (f.endsWith(".json")) fs.copyFileSync(path.join(ROOT, "src", f), path.join(TMP, "src", f));
fs.writeFileSync(
  path.join(TMP, "worker/index.js"),
  fs.readFileSync(path.join(ROOT, "worker/index.js"), "utf8").replace(/^(import .* from "\.\.\/src\/[^"]+\.json");?/gm, '$1 with { type: "json" };')
);
const worker = (await import(pathToFileURL(path.join(TMP, "worker/index.js")).href)).default;
async function makeEnv(extra = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(path.join(ROOT, "schema.sql"), "utf8"));
  class Stmt {
    constructor(sql) { this.sql = sql; this.args = []; }
    bind(...a) { this.args = a; return this; }
    async first() { return db.prepare(this.sql).get(...this.args) ?? null; }
    async all() { return { results: db.prepare(this.sql).all(...this.args) }; }
    async run() { const r = db.prepare(this.sql).run(...this.args); return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; }
  }
  const DB = {
    prepare: (sql) => new Stmt(sql),
    batch: async (list) => { db.exec("BEGIN"); try { const out = []; for (const s of list) out.push(await s.run()); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } },
    exec: async (sql) => db.exec(sql),
  };
  return { DB, db, ASSETS: { fetch: async () => new Response("<html>asset</html>", { headers: { "content-type": "text/html" } }) }, ADMIN_USERS: "Owner", PLACE_TIMER: "300", DELETE_TIMER: "300", CHUNK_OBJECT_LIMIT: "1500", GD_SERVER: "https://gd.test/database", ...extra };
}
// fake Geometry Dash server: accounts  name -> [accountID, userID, password]
const ACCOUNTS = { Owner: [1, 11, "pw1"], Alice: [2, 22, "pw2"], Bob: [3, 33, "pw3"], Eve: [4, 44, "pw4"] };
globalThis.fetch = async (url, init) => {
  const u = String(url); const p = new URLSearchParams(init?.body || "");
  if (u.endsWith("loginGJAccount.php")) {
    const a = ACCOUNTS[p.get("userName")];
    return new Response(a && a[2] === p.get("password") ? `${a[0]},${a[1]}` : "-11");
  }
  if (u.endsWith("getGJUserInfo20.php")) {
    const e = Object.entries(ACCOUNTS).find(([, v]) => String(v[0]) === p.get("targetAccountID"));
    return new Response(e ? `1:${e[0]}:2:${e[1][1]}` : "-1");
  }
  return new Response("", { status: 404 });
};
async function client(worker, env, origin = "https://site.test") {
  let cookie = "";
  const call = async (path, body, opts = {}) => {
    const headers = { "content-type": "application/json", ...(opts.noOrigin ? {} : { origin: opts.origin ?? origin }), ...(cookie && !opts.noCookie ? { cookie } : {}) };
    const res = await worker.fetch(new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const sc = res.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    let json = null; const text = await res.text(); try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text, headers: res.headers };
  };
  return { call, login: (u) => call("/api/login", { username: u, password: ACCOUNTS[u][2] }), setCookie: (c) => (cookie = c), get cookie() { return cookie; } };
}

let pass = 0, fail = 0;
const t = (name, ok, extra = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "   <-- " + extra}`); };

const env = await makeEnv();
const owner = await client(worker, env), alice = await client(worker, env), bob = await client(worker, env), eve = await client(worker, env), anon = await client(worker, env);
for (const [c, n] of [[owner, "Owner"], [alice, "Alice"], [bob, "Bob"], [eve, "Eve"]]) { const r = await c.login(n); if (r.status !== 200) console.log("login failed", n, r.text); }
const A = (c, body, o) => c.call("/api/admin", body, o);
const me = async (c) => (await c.call("/api/state")).json?.me;

console.log("--- permissions ---");
t("anon cannot use admin", (await A(anon, { action: "ban", username: "Bob" })).status === 401);
t("normal user cannot use admin", (await A(eve, { action: "ban", username: "Bob" })).status === 403);
t("cross-site POST blocked", (await A(owner, { action: "set", key: "canEdit", value: "1" }, { origin: "https://evil.test" })).status === 403);

console.log("--- owner (ADMIN_USERS) self-protection ---");
t("owner cannot ban himself", (await A(owner, { action: "ban", username: "Owner" })).status >= 400, "self-ban succeeded");
t("owner cannot un-admin himself (env owner stays admin)", (await A(owner, { action: "removeAdmin", username: "Owner" })).status >= 400, "removeAdmin returned ok but he is still admin");
t("owner still admin & not banned", (await me(owner))?.admin === true && (await me(owner))?.banned === false);

console.log("--- admin hierarchy ---");
t("owner can make Alice admin", (await A(owner, { action: "makeAdmin", username: "Alice" })).status === 200);
t("Alice (admin) works", (await A(alice, { action: "set", key: "placeTimer", value: "120" })).status === 200);
t("Alice cannot promote Bob (only owners)", (await A(alice, { action: "makeAdmin", username: "Bob" })).status >= 400, "admin could promote");
t("Alice cannot ban the owner", (await A(alice, { action: "ban", username: "Owner" })).status >= 400, "admin banned the owner");
t("Alice cannot ban herself", (await A(alice, { action: "ban", username: "Alice" })).status >= 400, "self-ban ok");
t("Alice cannot un-admin herself", (await A(alice, { action: "removeAdmin", username: "Alice" })).status >= 400);
t("owner removes Alice admin", (await A(owner, { action: "removeAdmin", username: "Alice" })).status === 200);
t("demoted Alice loses admin immediately", (await A(alice, { action: "set", key: "placeTimer", value: "1" })).status === 403, "still works after demotion");
t("demoted Alice cannot re-admin herself", (await A(alice, { action: "makeAdmin", username: "Alice" })).status === 403);
await A(owner, { action: "makeAdmin", username: "Alice" });
await A(owner, { action: "ban", username: "Alice" });
t("banned admin can't run admin commands", (await A(alice, { action: "unban", username: "Alice" })).status >= 400, "banned admin unbanned herself");
await A(owner, { action: "unban", username: "Alice" }); await A(owner, { action: "removeAdmin", username: "Alice" });

console.log("--- input validation ---");
t("javascript: stream link rejected", (await A(owner, { action: "set", key: "streamLink", value: "javascript:alert(1)" })).status === 400, "stored a javascript: URL");
t("https stream link accepted", (await A(owner, { action: "set", key: "streamLink", value: "https://twitch.tv/x" })).status === 200);
t("negative timer rejected", (await A(owner, { action: "set", key: "placeTimer", value: "-5" })).status === 400, "stored -5");
t("non-numeric timer rejected", (await A(owner, { action: "set", key: "placeTimer", value: "abc" })).status === 400);
t("huge chunk limit rejected", (await A(owner, { action: "set", key: "chunkObjectLimit", value: "999999999" })).status === 400);
t("canEdit only 0/1", (await A(owner, { action: "set", key: "canEdit", value: "maybe" })).status === 400);
t("SQL injection in username is harmless", (await A(owner, { action: "ban", username: "x'; DROP TABLE users;--" })).status === 404 && (await me(owner)) !== undefined);
t("settings key injection rejected", (await A(owner, { action: "set", key: "globalMessage", value: "hi" })).status === 400);
t("message too long is trimmed to 300", (await A(owner, { action: "broadcast", text: "a".repeat(5000) })).status === 200 && (await owner.call("/api/state")).json.message.text.length === 300);
t("broadcast visible to anon", (await anon.call("/api/state")).json.message?.text?.length === 300);
t("empty broadcast rejected", (await A(owner, { action: "broadcast", text: "   " })).status === 400);
t("non-admin cannot broadcast", (await A(eve, { action: "broadcast", text: "hi" })).status === 403);
t("admin settings hidden from normal user", (await eve.call("/api/state")).json.adminSettings == null);

console.log("--- headers / misc ---");
const r = await anon.call("/api/state");
t("security headers on API", !!r.headers.get("content-security-policy") && r.headers.get("x-frame-options") === "DENY" && r.headers.get("x-content-type-options") === "nosniff");
const asset = await worker.fetch(new Request("https://site.test/"), env, {});
t("security headers on pages", !!asset.headers.get("content-security-policy"));
const lg = await anon.call("/api/login", { username: 123, password: ["x"] });
t("login with wrong types -> 400 not 500", lg.status === 400, lg.status);
const bad = await anon.call("/api/login", { username: "Alice", password: "nope" });
t("wrong password -> 401 and no cookie", bad.status === 401 && !bad.headers.get("set-cookie"));
const ck = (await (await client(worker, env)).login("Eve"));
t("session cookie HttpOnly + SameSite", /HttpOnly/.test(ck.headers.get("set-cookie")) && /SameSite=Lax/.test(ck.headers.get("set-cookie")), ck.headers.get("set-cookie"));
t("logout invalidates session", (await eve.call("/api/logout", {})).status === 200 && (await eve.call("/api/admin", { action: "ban", username: "Bob" })).status === 401);
const hashed = env.db.prepare("SELECT token_hash FROM sessions LIMIT 1").get();
t("session tokens stored hashed", hashed && /^[0-9a-f]{64}$/.test(hashed.token_hash));

console.log("--- gameplay + rate limit ---");
const objs = JSON.parse(fs.readFileSync(path.join(TMP, "src/objects.json"), "utf8"));
const first = Array.isArray(objs) ? objs[0] : Object.values(objs)[0];
const oid = first.id ?? first.ID ?? Object.keys(objs)[0];
const obj = `${oid};100;100;0;0;1;0;ffffff;0;1;ffffff;0;1`;
const bob2 = await client(worker, env); await bob2.login("Bob");
t("player can place an object", (await bob2.call("/api/place", { text: obj })).status === 200);
t("cooldown enforced on 2nd place", (await bob2.call("/api/place", { text: obj })).status === 429);
await A(owner, { action: "ban", username: "Bob" });
t("banned player can't place", (await bob2.call("/api/place", { text: obj })).status === 403);
await A(owner, { action: "unban", username: "Bob" });
await A(owner, { action: "makeAdmin", username: "Bob" }); await A(owner, { action: "ban", username: "Bob" });
t("banned admin can't place either", (await bob2.call("/api/place", { text: obj })).status === 403);
await A(owner, { action: "unban", username: "Bob" }); await A(owner, { action: "removeAdmin", username: "Bob" });
const lim = await makeEnv({ LOGIN_LIMITER: { limit: async () => ({ success: false }) } });
const c3 = await client(worker, lim);
t("login rate limiter -> 429", (await c3.login("Alice")).status === 429);
console.log(`\n${pass} passed, ${fail} failed`);

fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
