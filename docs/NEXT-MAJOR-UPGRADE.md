# Next 16 / React 19 / TypeScript 6 — Major Upgrade Runbook ("D" task)

> Deferred from the v241.16 dependency-maintenance pass. High blast
> radius — run this in a **dedicated session**, not bundled with feature
> work. Clears the 3 remaining `npm audit` advisories (postcss XSS + ws)
> as a side effect, since those are transitive via Next's bundled deps.

## Why deferred

- Next 16 + React 19 just shipped. React 19 forces a new compiler model,
  changes `useEffect` cleanup semantics, and migrates ref-as-prop.
- TypeScript 6 removes some deprecated flags.
- Same scale as the v241.8 Next 14→15 migration — needs a controlled
  codemod pass + manual cleanup + full QA, not a one-line bump.

## Pre-flight (do this FIRST, in order)

```bash
# 0. Fresh branch off latest main
cd /home/user/staybid-frontend
git fetch origin main
git checkout -b claude/next16-react19-major-upgrade origin/main

# 1. Snapshot current green state so you can diff behaviour later
npx tsc --noEmit --skipLibCheck && npm run build   # MUST be green before starting
```

## Step 1 — React 19 first (Next 16 requires it)

```bash
npm install react@19 react-dom@19 --legacy-peer-deps
npm install -D @types/react@19 @types/react-dom@19 --legacy-peer-deps

# Official React 19 codemod (handles ref-as-prop, useRef arg, etc.)
npx codemod@latest react/19/migration-recipe

# react-is should already be on 19.x from v241.16; align if not
npm install react-is@19 --legacy-peer-deps
```

## Step 2 — Next 16

```bash
npm install next@16 --legacy-peer-deps

# Run ONLY the targeted async-API codemod (same discipline as v241.8).
# Do NOT run the "upgrade latest" mega-codemod — it pulls canary + every
# transform at once and hides regressions.
npx @next/codemod@16 next-async-request-api .

# Check for the 6 routes the codemod historically misses (v241.8 lesson):
# any dynamic route with `await params` in the body but a SYNC type sig.
# Fix manually: { params }: { params: { id: string } }
#            →  { params }: { params: Promise<{ id: string }> }
grep -rn "params }: { params: {" app/api app/**/\[*\]
```

## Step 3 — TypeScript 6

```bash
npm install -D typescript@6 --legacy-peer-deps
# Watch for removed-flag errors in tsconfig.json. ES2017 target (v241.7)
# is fine. If "ignoreDeprecations" errors appear, address per the tsc
# message — do NOT downgrade the target below es2017 (v241.7 trap).
```

## Step 4 — Validate

```bash
rm -rf .next                              # nuke stale build cache (v241.8 lesson)
npx tsc --noEmit --skipLibCheck           # MUST be exit 0
npm run build                             # MUST be green
npm audit                                 # should now show 0 (or only new) advisories
```

## Step 5 — Manual QA (mobile-first, the v241 regression surface)

- [ ] /bid wizard: launch a multi-room bid end-to-end (sessionStorage
      persistence from v241.14 must survive the React 19 effect changes)
- [ ] /hotels/[id]: "Your offers" multi-room totals + upgrade CTA
- [ ] /my-bids: Place Bid / Negotiate counts agree with hotel page
- [ ] Reel feed (/discover, /reels): scroll + autoplay (React 19
      `useEffect` cleanup timing is the highest-risk area here)
- [ ] Razorpay payment modal open/close
- [ ] Theme toggle (no-FOUC bootstrap script in app/layout.tsx)

## Step 6 — Ship

```bash
# Bump SB_BUILD + badge in app/layout.tsx to v242 (major-bump milestone)
git add -A
git commit -m "v242 — Next 16 + React 19 + TS 6 major upgrade"
git push -u origin claude/next16-react19-major-upgrade
# Open DRAFT PR, wait for Vercel green, squash-merge.
```

## Rollback

If anything is unstable on the Vercel preview, the whole thing is one
branch — just close the PR and delete the branch. main stays on
Next 15 / React 18 (v241.16) untouched.

## Known gotchas (from the v241.8 Next 14→15 pass)

- `node_modules` must be installed before `tsc` (React import errors
  otherwise — they're false until install completes).
- Delete `.next` between Next versions or stale validator types throw.
- Use `--legacy-peer-deps` throughout — the dep tree has peer-range
  conflicts that block a clean install otherwise.
- Always pin the version explicitly, run ONE targeted codemod, then
  manual cleanup. Never the mega "upgrade latest" codemod.
