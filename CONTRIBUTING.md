# How we work on CycleBuddy

Two people work on this game. These rules keep both copies in step and make it clear
exactly what is in every version. They apply to everyone, including AI assistants.

## The short version

1. **Pull first.** Before you change anything: `git checkout main && git pull`.
2. **One branch per change.** Never work on `main` directly. `git checkout -b feature/time-trial-bikes`.
3. **Small commits** with a message that says what changed and why.
4. **Push your branch, open a pull request** into `main` on GitHub.
5. **DomenZepic reviews every pull request before it is merged.** Nobody merges a pull request
   Domen hasn't reviewed and approved, and that includes pull requests made by AI assistants.
6. **Releases are tags.** When `main` is ready to play, bump the version and tag it `vX.Y.Z`.

No more zips: clone the public repository once, then pull and push. Anyone can read a public
repository. Pushing needs a GitHub login, and the owner adds the other person under
Settings → Collaborators so they can push from their own computer. Copy `.env.example` to
`.env` after cloning. The real `.env` is never committed.

```bash
git clone <the repository URL from GitHub's Code button>
cd cyclebuddy
npm install
cp .env.example .env
npm run dev:local
```

## Branches

| Branch | What it is | Who writes to it |
|---|---|---|
| `main` | The version that is built and played. Always works. | Only through merged pull requests |
| `feature/<name>` | A new thing: a mode, a world, a screen | One person |
| `fix/<name>` | A bug fix | One person |
| `perf/<name>` | Making it faster, with numbers before and after | One person |
| `ui/<name>` | How screens look | One person |
| `docs/<name>` | README, changelog, notes | One person |
| `brother-YYYY-MM-DD` | A copy that arrived as a zip, committed unchanged (history only) | Nobody, after it is merged |

Names are short, lowercase, words joined with `-`: `feature/career-transfers`,
`fix/hr-reconnect`, `perf/terrain-lod`.

A bigger piece of work can have **sub-branches**: branch off the feature branch, merge back
into it, and merge the feature into `main` when the whole thing works.

```
main
 └── feature/career-v2
      ├── feature/career-v2-transfers
      └── feature/career-v2-contracts
```

```bash
git checkout feature/career-v2
git checkout -b feature/career-v2-transfers
# ...work, commit...
git push -u origin feature/career-v2-transfers
# pull request into feature/career-v2 (not main)
```

## Day to day

```bash
# start of every session
git checkout main
git pull

# start a change
git checkout -b fix/pause-buttons

# work, then commit
git add -A
git commit -m "Pause: buttons answer the first click"

# share it
git push -u origin fix/pause-buttons
gh pr create --base main --fill      # or open the pull request on github.com
                                     # CODEOWNERS adds DomenZepic as reviewer
```

While your branch is open and `main` moves on, bring the new work in:

```bash
git checkout main && git pull
git checkout fix/pause-buttons
git merge main
```

When the pull request is merged, delete the branch (GitHub offers a button) and pull `main`.

## Review

- **Every pull request is reviewed by [DomenZepic](https://github.com/DomenZepic) before it is
  merged.** `.github/CODEOWNERS` asks him for a review on every pull request automatically.
- Open it with a description of what changed, why, and how it was tested (and the numbers
  for performance work). Screenshots for anything you can see on screen.
- Review comments get answered with a new commit on the same branch, not a new pull request.
- Domen merges once he has approved it (or says it can be merged). Use "Merge pull request"
  (a merge commit), so the branch history stays visible.

## Before a pull request is merged

- **The GitHub check is green.** Every pull request runs types, all tests, the build and the
  smoke test (`.github/workflows/test.yml`). Red means it is not merged.
- Locally the same: `npm run typecheck && npm test && npm run build && npm run smoke`.
- New features come with a test; bug fixes with a test that fails without the fix.
- The game runs: start a ride and look at what you changed.
- Performance work says what it measured, before and after (`/play?perf`: fps, draw calls, triangles).
- If files, folders or modes changed, the map in `README.md` ("Where everything is") is updated.
- Nothing secret: no `.env`, no `.localdb/`, no passwords or keys, no screen recordings.

## Versions

- The version is `version` in `package.json` (and `package-lock.json`).
  - New features: raise the middle number, 0.9.0 → 0.10.0.
  - Fixes only: raise the last number, 0.9.0 → 0.9.1.
- Every version gets a section at the top of `CHANGES.md`.
- Each release is a tag on `main`:

```bash
git checkout main && git pull
# bump the version, write the CHANGES.md section, commit (on a docs/release branch + PR)
npm run typecheck && npm test && npm run build
git tag -a v0.9.1 -m "0.9.1: <one line>"
git push --tags
```

- The home screen shows the version and commit of the running build (`v0.9.0 · add4068`).
  `-dirty` means it was built with uncommitted changes. When reporting a bug, include that line.
- `git tag` lists every release; `git checkout v0.9.0` brings any one back.

## Commit messages

First line: what changed, in plain words, under ~70 characters ("Fences: cull per 500 m
cell"). Then, if needed, why, and the numbers for performance work. One change per commit,
so a single commit can be undone without losing anything else.

## If something goes wrong

- **Pull says "not possible to fast-forward"**: someone pushed to `main` while you had local
  commits on it. Don't force anything. Move your commits to a branch
  (`git checkout -b fix/whatever`) and reset your `main` to GitHub's
  (`git checkout main && git reset --hard origin/main`). Then open a pull request as usual.
- **Merge conflict**: both of you changed the same lines. Open the file, keep what both changes
  need, test, commit. If unsure, ask the other person before merging.
- **Never** `git push --force` to `main`.
