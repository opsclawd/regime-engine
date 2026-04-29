# CI Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate from npm to pnpm and add a GitHub Actions CI pipeline that runs the full quality gate on every push/PR to main.

**Architecture:** Two-phase approach — first migrate the package manager from npm to pnpm (lockfile conversion, config, docs update), then add the CI workflow file. The CI workflow is a single sequential job with 6 check steps.

**Tech Stack:** pnpm 10+, GitHub Actions (actions/checkout@v4, pnpm/action-setup@v4, actions/setup-node@v4)

---

### Task 1: Migrate from npm to pnpm

**Files:**

- Delete: `package-lock.json`
- Create: `pnpm-lock.yaml` (via `pnpm import`)
- Create: `.npmrc`
- Modify: `AGENTS.md` (lines 43-54 — Build, Test, and Development Commands section)

- [ ] **Step 1: Generate pnpm lockfile from npm lockfile**

Run:

```bash
pnpm import
```

Expected: `pnpm-lock.yaml` created in project root.

- [ ] **Step 2: Create .npmrc**

Create `.npmrc` in the project root:

```ini
strict-peer-dependencies=false
```

This prevents spurious peer dependency errors with Node 22 + ESM.

- [ ] **Step 3: Delete package-lock.json**

```bash
rm package-lock.json
```

- [ ] **Step 4: Verify all scripts work with pnpm**

Run each command and confirm success:

```bash
pnpm install
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run format
pnpm run test
```

Expected: All commands pass with zero exit codes.

- [ ] **Step 5: Update AGENTS.md to reference pnpm**

Replace all `npm run` references with `pnpm run` in the "Build, Test, and Development Commands" section. The updated section:

```markdown
## Build, Test, and Development Commands

These commands must exist and stay accurate:

- `pnpm run dev`: start local server (must serve `/health`)
- `pnpm run build`: production build (tsup/tsc + bundler as chosen)
- `pnpm run typecheck`: strict TypeScript checks without emitting
- `pnpm run lint`: ESLint across repo with zero warnings allowed
- `pnpm run test`: Vitest once (CI mode)
- `pnpm run test:watch`: Vitest in watch mode (optional)
- `pnpm run format`: Prettier check/write (optional but recommended)
- `pnpm run harness`: run fixtures end-to-end and emit report artifacts

Quality gate (must pass before PR):

- `pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run build`
```

- [ ] **Step 6: Commit pnpm migration**

```bash
git add pnpm-lock.yaml .npmrc AGENTS.md
git rm package-lock.json
git commit -m "m24: migrate from npm to pnpm"
```

Expected: Commit includes `pnpm-lock.yaml` (added), `.npmrc` (added), `AGENTS.md` (modified), `package-lock.json` (deleted).

---

### Task 2: Add GitHub Actions CI workflow

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Create .github/workflows/ci.yml**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    name: Build, Test & Lint
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm run build

      - run: pnpm run typecheck

      - run: pnpm run lint

      - run: pnpm run format

      - run: pnpm run test
```

- [ ] **Step 3: Validate the workflow YAML**

Check that the YAML is well-formed:

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```

Expected: No errors printed (exit 0).

- [ ] **Step 4: Commit the CI workflow**

```bash
git add .github/workflows/ci.yml
git commit -m "m24: add GitHub Actions CI pipeline"
```

---

### Task 3: Verify and push

**Files:** None (verification only)

- [ ] **Step 1: Run the full quality gate locally**

```bash
pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run build
```

Expected: All commands pass with zero exit codes.

- [ ] **Step 2: Push to remote**

```bash
git push origin main
```

Expected: Both commits pushed. GitHub Actions triggers a CI run on the `main` branch.

- [ ] **Step 3: Verify CI pipeline runs**

Check the Actions tab in the GitHub repo. The `check` job should appear and all 6 steps should pass.

- [ ] **Step 4: Configure branch protection (manual)**

After the first successful CI run on `main`, go to GitHub repo Settings → Branches → Branch protection rules → Add rule for `main`:

- Check "Require status checks to pass before merging"
- Select the `check` status check
- Check "Require branches to be up to date before merging" (optional but recommended)

This step is manual and not part of the code changes.
