# server/ and api/: the account server

Plain Node `http`, no framework. Accounts (email + scrypt password, Google sign-in),
30-day session cookies, the rider profile and ride sync, all in MongoDB. In production
`npm start` also serves the built game from `dist/`.

## What lives here
- `index.js`: `handle(req, res)`: every `/api/...` endpoint (`auth/config|me|signup|signin|signout|google`, `profile`, `rides`, `rides/<id>`), cleaning of ride summaries/samples/efforts, static files when `NODE_ENV=production`. Connects to MongoDB on import.
- `security.js`: `hashPassword`/`verifyPassword` (scrypt, versioned, old format rehashed), `createRateLimiter`, `originAllowed`, JSON body reading with size limits, cookie reading, `staticPath` (no path escape).
- `profile.js`: `cleanProfile` and `mergeProfiles`: the rider record saved on the account and how two computers' copies merge (bought bikes add up, starter kit never overwrites a real one, timestamps never in the future).
- `local.js`: `npm run dev:local`. Starts a private MongoDB in `.localdb/` (mongodb-memory-server), then `dev.js` against it. `--api-only` runs just the API.
- `dev.js`: `npm run dev`. API on 127.0.0.1:8787, waits for it, then Vite; Vite proxies `/api` to 8787 (`vite.config.ts`).
- `../api/index.js`: Vercel. `vercel.json` rewrites `/api/:path*` to `/api/index?__path=…`; this file restores the path and calls the same `handle`. Vercel serves `dist/` itself.

## Local vs Vercel
- Local: `npm run dev:local` needs no `.env` values; it makes `MONGODB_URI`, `MONGODB_DB=cyclebuddy-local` and a random `SESSION_SECRET`. `npm run dev` reads `.env` (Atlas).
- Vercel: env comes from the Vercel dashboard (Domen sets it). `MONGODB_DB` is `cyclebuddy` in Production and `cyclebuddy-preview` in Preview. Set `TRUST_PROXY=1` there so rate limits use `X-Forwarded-For`.
- Account is Domen's personal Vercel: `vercel-me` only, preview deploys only, never `--prod`. Don't deploy without asking.

## Rules
- **Never print, log or commit env values** (`MONGODB_URI`, `SESSION_SECRET`, Google ids) or `.env`. Log "configured / not configured", never the value.
- **Never print the test account password** from `.localdb/test-account.json`. Don't commit `.localdb/` (`tests/conventions.test.js` fails on it).
- Every write endpoint goes through `originAllowed` and must be JSON. Keep new endpoints inside `handleApi` so they get both.
- Clean every field from the client (`num`, `text`, `cleanSummary`, `cleanProfile`). Never store a client object as is.
- Each user only sees their own rides: every query filters on `userId: user._id`.

## Add an endpoint
1. Add the branch in `handleApi` (`index.js`); get the user with `currentUser(req)`, send 401 when null.
2. Read the body with `readBody(req, maxBytes)`, clean every field, then write.
3. Add a case to `server/api.test.js`. Run `npx vitest run server/api.test.js`.

## Tests
- `npx vitest run server/api.test.js`: spawns the real server on a throwaway MongoDB: sign-up, profile, rides, two accounts apart, delete, sign-out, 404. Slow (30 s budget).
- `npx vitest run server/security.test.js server/profile.test.js`: passwords, rate limiter, origin check, profile merge. Fast.
- `npm run smoke` after `npm run build`: the production server serves `/`, `/play`, the built files and the API.

## Traps
- `index.js` awaits `connectMongo()` at import. Without `MONGODB_URI` or `SESSION_SECRET` the server still starts: `auth/config` and `auth/me` report `ready: false` and every other endpoint answers 503 with the "add it to .env" message. A failed connect retries every 10 s.
- `profile.js` keeps its own lists of brands, graphics presets, times of day, cameras, map modes and paint slots. A new value added in the game is silently dropped on save until it is added here too.
- Rate limits live in process memory. On Vercel each function instance has its own count.
- Ride upload allows a 12 MB body (`readBody(req, 12_000_000)`), but Vercel functions accept about 4.5 MB of request body, so a very long ride with a FIT file can fail there and not locally.
- `GOOGLE_CLIENT_SECRET` is in `.env.example` but nothing in the server reads it.
