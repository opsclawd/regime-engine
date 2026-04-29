# CI Pipeline Design

**Issue:** #28 — Add GitHub Actions CI pipeline  
**Date:** 2025-04-29  
**Approach:** Single-job sequential pipeline (Approach A)

## Overview

Add a GitHub Actions CI workflow that runs the full quality gate on every push and pull request to `main`. The project currently uses npm; this design migrates to pnpm first since the issue specifies pnpm and the user confirmed the switch.

## 1. pnpm Migration

The project currently uses npm (`package-lock.json` exists, no `pnpm-lock.yaml`). Before CI can use `pnpm install --frozen-lockfile`, the migration must happen:

- Run `pnpm import` to convert `package-lock.json` → `pnpm-lock.yaml`
- Add `.npmrc` with `strict-peer-dependencies=false` (Node 22 + ESM can produce spurious peer warnings)
- Delete `package-lock.json`
- Update `AGENTS.md` quality gate and dev commands to reference pnpm instead of npm
- Verify all existing `npm run` scripts work identically with `pnpm run`

## 2. GitHub Actions Workflow

File: `.github/workflows/ci.yml`

Single `check` job, sequential steps, no parallelism:

- **Trigger:** `push` to `main` + `pull_request` targeting `main`
- **Runner:** `ubuntu-latest`
- **Timeout:** 10 minutes
- **Steps:**
  1. `actions/checkout@v4`
  2. `pnpm/action-setup@v4` (installs pnpm before Node setup)
  3. `actions/setup-node@v4` with `node-version: 22`, `cache: pnpm`
  4. `pnpm install --frozen-lockfile`
  5. `pnpm run build`
  6. `pnpm run typecheck`
  7. `pnpm run lint`
  8. `pnpm run format`
  9. `pnpm run test`

**Not included:**
- `test:pg` — requires a running Postgres instance; not part of the default quality gate
- Explicit caching steps — `setup-node` with `cache: pnpm` handles pnpm store caching automatically

**Step ordering rationale:** Build runs before typecheck to catch compilation errors first. All commands match what exists in `package.json` scripts.

## 3. Branch Protection

After the CI workflow is merged to `main`, configure GitHub branch protection:

- Require status checks to pass before merging
- Required check: `check` (the job name)

**Sequence:** Merge the CI PR first, then configure branch protection in the repo settings. The check name only appears in the branch protection UI after the workflow has run on `main` at least once.

## Acceptance Criteria

- [ ] `pnpm-lock.yaml` committed, `package-lock.json` deleted
- [ ] `.npmrc` added with `strict-peer-dependencies=false`
- [ ] AGENTS.md updated to reference pnpm
- [ ] All `pnpm run` scripts pass locally (`build`, `typecheck`, `lint`, `format`, `test`)
- [ ] `.github/workflows/ci.yml` created
- [ ] Pipeline runs on every push/PR to `main`
- [ ] All 6 check steps pass in CI
- [ ] Branch protection configured on `main` requiring the `check` job