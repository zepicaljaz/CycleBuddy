# CLAUDE.md: CycleBuddy

Domen's brother's indoor cycling game. Read `README.md`, `ARCHITECTURE.md`, `CHANGES.md` and `NEXT_STEPS.md` first.

## Git: before anything else
- **Every session starts with `git fetch origin && git pull --ff-only` on `main`** (the GitHub repository is public). Domen and his brother both work on it; never start from a stale copy. If the pull is not a fast-forward, stop and tell Domen before merging anything.
- **Workflow for both of us: `CONTRIBUTING.md`** (shared with the brother on GitHub). In short: never commit to `main`; every change gets its own branch (`feature/`, `fix/`, `perf/`, `ui/`, `docs/` + short name, sub-branches off a feature branch for big work), pushed, merged into `main` through a pull request. **Every pull request is for DomenZepic to review before merging: open it, report the link, never merge it yourself** (also not your own docs PRs) until Domen approves or says merge. Pushing branches and opening PRs is fine.
- `main` is always the version that is built and played.
- Releases: bump `version` in `package.json` + `package-lock.json`, add a section to `CHANGES.md`, tag `vX.Y.Z` on `main`, push with `--tags`. Steps in `README.md` → Versions and releases.
- Code from a zip or another copy: its own branch from the shared base (`brother-YYYY-MM-DD`), committed unchanged, then merged. Never commit `.env`, `.localdb/` or recordings.
- When files, folders or modes change, update the "Where everything is" map in `README.md` in the same commit.

- Keep the low-poly look. It is cheap on CPU and GPU, and that is the point.
- The laptop lags under heavy runs. Run targeted tests (`npx vitest run <file>`) while working; run the full suite once at the end. No headless browsers or perf runs unless asked.
- `npm run dev:local` for a local server. The test account lives in `.localdb/test-account.json`; never print its password.
- Real climb data must come from published profiles, with sources. Never invent gradients. A new climb must pass `checkClimb` and `src/routes/real/data.test.ts`.
- Don't use race trademarks as product names. Stages say what they were modelled on in `inspiredBy`.
- UI: no card grids, pills or emoji. Big type you can read from the saddle; numbers in tabular figures.
- Don't deploy or publish anything without asking.
- Real roads (1:1): built offline by `scripts/real-track/build.mjs`; method, choices and how to add one are in `docs/REAL_ROADS.md`. Road gradient comes from the published profile, never raw terrain data. The one exception, approved by Domen, is Tre Cime: the Veneto LiDAR survey, held to every published figure (see that doc). Keep `ATTRIBUTION.md` current when adding a data source. At hairpins the ground must stay a slope: no wall against the verge, no fin, no hole. The rules are in that doc under "Hairpins and the ground mesh".

## Vercel

- CycleBuddy is on Domen's **personal** Vercel account. Use `vercel-me` (own login in `~/.vercel-me`), never plain `vercel`/`vercel-td` or the Vercel MCP connector: those are the Tasty Dose work account. Check `vercel-me whoami` first.
- Production deploys come from `main` only (GitHub). Test a branch with `vercel-me deploy --target preview`, never `--prod`.
- Never print or commit env values; `MONGODB_URI` is set by Domen in the Vercel dashboard.
