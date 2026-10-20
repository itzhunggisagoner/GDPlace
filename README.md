![Logo](https://github.com/itzhunggisagoner/GDPlace/raw/refs/heads/main/public/logo.png)

# GD Place

A collaborative **Geometry Dash level editor in the style of r/place**: everyone places and deletes GD objects
on one huge shared level, with a cooldown between actions. You log in with your **Geometry Dash account**,
and everything runs on **Cloudflare Workers + D1** (no Firebase).

Based on [PlaceGD/gd-place-2022](https://github.com/PlaceGD/gd-place-2022) (MIT, © Spu7Nix, FlowVix, DexterHill0, GDColon).

- **Frontend:** Svelte + Vite + PixiJS (`src/`, `public/`)
- **Backend:** one Cloudflare Worker (`worker/index.js`): API, game rules, admin
- **Database:** Cloudflare D1 (`schema.sql`)
- **Login:** GD username + password, checked directly against the GD servers. The password is never stored; the session is an HttpOnly cookie.

## Run it

```bash
npm install
npm run db:create     # once, copy the printed database_id into wrangler.jsonc
npm run db:local      # create the tables in the local D1
npm run build
npm run dev:api       # worker + local D1 -> http://localhost:8787
npm run dev           # (second terminal) vite -> http://localhost:8080
```

Deploy:

```bash
npm run db:remote     # create the tables on the real D1 (safe to re-run)
npm run deploy
```

## Forking? Change these first

| What | Where |
|---|---|
| **Owners / admins** (GD usernames, comma separated, not case sensitive) | `wrangler.jsonc` → `vars.ADMIN_USERS` |
| Your D1 database (name and id) | `wrangler.jsonc` → `d1_databases`, and the `db:*` scripts in `package.json` |
| Worker name (decides your `*.workers.dev` address) | `wrangler.jsonc` → `name` |
| Default cooldowns and object limit | `wrangler.jsonc` → `vars.PLACE_TIMER`, `DELETE_TIMER`, `CHUNK_OBJECT_LIMIT` (admins can also change them live in the Admin panel) |
| GD server or proxy (use a proxy if GD blocks Cloudflare IPs) | `wrangler.jsonc` → `vars.GD_SERVER`, secret `GD_PROXY_TOKEN` (`npx wrangler secret put GD_PROXY_TOKEN`) |
| Login rate limit | `wrangler.jsonc` → `ratelimits` (`LOGIN_LIMITER`, 10 tries per minute per IP) |
| Site title and link preview | `index.html` (`<title>` and `og:*` tags) |
| Logo and favicon | `logo.svg`, `public/favicon.png` |
| Gold text gradient colours | `src/global.css` → `--gd-gold-top`, `--gd-gold-bottom` |
| UI size on phones | `src/global.css` → `--ui-zoom` |
| Popup / notification look | `src/ui/NotificationHost.svelte` |
| Button sprites (green, purple, red) | `public/ui/*Button.png`, `src/ui/GDButton.svelte` |
| Security headers / CSP | `worker/index.js` → `CSP` constant |
| Credits | `LICENSE` and the section above: keep the original authors |

## Admin

There are two kinds of admin:

- **Owners** are the names in `ADMIN_USERS`. They are always admins and can't be banned or demoted from the panel
  (to remove an owner, delete the name from `wrangler.jsonc` and redeploy). Only owners can add or remove other admins.
- **Admins** are added by an owner in the Admin panel. They can ban normal users, change settings and send messages,
  but can't ban admins or owners.

Nobody can ban themselves or remove their own admin rights. Banned admins lose their powers.

After logging in, admins see an **Admin** button in the top-left corner. It can:

- change the cooldowns, object limit, stream link and turn editing on or off (applied immediately)
- ban / unban, set a name colour, set personal timers for a user
- send a **global message**: shown to everyone as a normal notification, once per message

The stream link (a Twitch/YouTube link) is shown on the landing page and in the editor. It must start with `https://`.

## Tests

```bash
node --no-warnings tests/worker.test.mjs
```

Needs Node 22.5+ and no extra packages. It runs the worker against an in-memory SQLite database
and a fake GD server (nothing real is contacted) and checks permissions, input validation, sessions and rate limiting.

## Project structure

```
worker/index.js     API + GD login + game rules + admin + security headers
schema.sql          D1 tables
tests/              worker tests
src/backend/        API client (state, auth, database)
src/admin/          Admin panel
src/ui/             shared UI: GDText, GDButton, FramePanel, NotificationHost, animations...
src/                editor, settings, login popup, landing page
public/             images, fonts, sounds
```

## How live updates work

The editor loads a snapshot of each chunk (`/api/chunk`) and polls `/api/changes` about every 2.5 seconds.
Your own changes show up immediately. The change log is pruned after 6 hours; clients that fall behind reload their chunks.

## License

MIT, see `LICENSE`.
