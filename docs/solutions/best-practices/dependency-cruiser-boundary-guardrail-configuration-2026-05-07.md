---
title: dependency-cruiser boundary guardrail configuration patterns
date: 2026-05-07
category: best-practices
module: engine
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Setting up dependency-cruiser for architecture boundary enforcement
  - Adding forbidden rules that constrain npm packages or Node builtins
  - Diagnosing why depcruise rules silently fail to detect violations
  - Splitting layered architectures with boundary guards
tags:
  - dependency-cruiser
  - architecture-guardrails
  - boundary-enforcement
  - safe-regex
  - npm-dependency-detection
  - clean-architecture
---

# dependency-cruiser boundary guardrail configuration patterns

## Context

When enforcing layered architecture boundaries with dependency-cruiser in a TypeScript/Node project, three non-obvious pitfalls silently weaken enforcement:

1. **`safe-regex` rejects quantified groups** like `(.+)?` and `(.*)?` as "unsafe", even when they aren't actually dangerous in context. The pattern `drizzle-orm(/.*)?` is rejected outright.
2. **`includeOnly: "^src/"` filters out all `node_modules` dependencies before rule evaluation**, making npm package constraints invisible. A file importing `fastify` shows 0 dependencies cruised — the rule silently never fires.
3. **Node.js built-in imports** (`node:process`) resolve with the `node:` prefix stripped (`resolved: "process"`), so npm and builtin patterns can't share a single rule.

These issues produce a config that validates and passes CI but **enforces nothing for npm package dependencies**.

## Guidance

### 1. Never use `includeOnly: "^src/"` for npm package enforcement

`includeOnly` filters the dependency graph **before** rules evaluate. With `includeOnly: "^src/"`, every npm edge is removed before any forbidden rule can match. Use `doNotFollow: { path: "node_modules" }` instead — it prevents crawling into `node_modules` but keeps the dependency **edge** visible for rule matching.

### 2. Split framework/storage rules into separate npm and node-builtin rules

NPM packages and Node.js built-ins resolve differently:

- **NPM packages**: `dependencyTypes: ["npm", ...]`, resolved path like `node_modules/.pnpm/fastify@5.8.5/node_modules/fastify/fastify.js`
- **Node builtins**: `dependencyTypes: ["core", ...]`, resolved path is the bare module name (`"process"` — the `node:` prefix is stripped)

Split each boundary constraint into two rules:

```javascript
// .dependency-cruiser.cjs — per-layer pattern (engine shown, domain/application follow same pattern)

// NPM packages — matched by resolved path + dependencyTypes
{
  name: "engine-no-framework-npm",
  comment: "src/engine/** must not import framework or storage npm packages.",
  severity: "error",
  from: { path: "^src/engine/" },
  to: {
    dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer"],
    path: "node_modules/.+/(fastify|drizzle-orm|postgres)/"
  }
},

// Node builtins — matched by bare module name (node: prefix is stripped)
{
  name: "engine-no-node-builtins",
  comment: "src/engine/** must not import node:sqlite, node:process, or process.",
  severity: "error",
  from: { path: "^src/engine/" },
  to: {
    path: "^(node:sqlite|node:process|process)$"
  }
},
```

### 3. Use prefix or exact-match patterns for safe-regex compliance

| Rejected pattern                         | Reason            | Working replacement                              |
| ---------------------------------------- | ----------------- | ------------------------------------------------ |
| `drizzle-orm(/.*)?`                      | quantified group  | Split into `^drizzle-orm$` and `^drizzle-orm/.*` |
| `(.+)?`                                  | quantified group  | Remove or rewrite as separate alternatives       |
| `^(\|fastify\|drizzle-orm(/.\*)?\|...)$` | contains `(/.*)?` | Split into separate npm + builtin rules          |

For npm rules, match against the resolved path: `node_modules/.+/(pkg1|pkg2|pkg3)/`. For builtins, match: `^(node:sqlite|node:process|process)$`.

### 4. Always verify with deliberate violations

After writing the config, create a deliberate violation (e.g., `import fastify from "fastify"` in `src/engine/`) and run `depcruise`. If you see 0 violations, the config is broken — likely `includeOnly` is filtering edges out.

## Why This Matters

- **`includeOnly: "^src/"` silently disables npm package enforcement** — all `node_modules` edges are removed before rules evaluate. The config validates, CI passes, but architecture constraints are not enforced.
- **Split rules are clearer** — each rule has a single concern: "no framework npm packages" vs "no direct database/storage builtins". Adding new packages or builtins means editing exactly one rule.
- **`safe-regex` false positives are fixable** — the split-rule pattern is both safe-regex compliant and more maintainable than a monolithic pattern.

## When to Apply

- Setting up dependency-cruiser for architecture enforcement in any TypeScript project
- Adding forbidden rules that constrain which npm packages or Node.js builtins a layer may import
- Diagnosing why dependency-cruiser rules aren't firing despite valid config and deliberate violations
- Splitting layered architectures (engine / domain / application / adapters / composition) with boundary guards
- Whenever a rule pattern contains a quantified group like `(.+)?`, `(.*)?`, or `(/.*)?` — rewrite it

## Examples

### Before: Single combined rule with `includeOnly` (BROKEN)

```javascript
{
  name: "engine-no-framework-or-storage",
  severity: "error",
  from: { path: "^src/engine/" },
  to: {
    // safe-regex rejects (/.+)? patterns, and even if it didn't,
    // includeOnly kills the npm edges before rules evaluate
    path: "^(fastify|drizzle-orm(/.*)?|postgres|node:sqlite|node:process|process)$"
  }
},
options: {
  includeOnly: "^src/",  // ← THIS MAKES ALL NPM RULES INVISIBLE
}
```

Result: A file with `import fastify from "fastify"` in `src/engine/` produces **0 violations**. The rule is dead.

### After: Split rules without `includeOnly` (WORKING)

```javascript
{
  name: "engine-no-framework-npm",
  severity: "error",
  from: { path: "^src/engine/" },
  to: {
    dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer"],
    path: "node_modules/.+/(fastify|drizzle-orm|postgres)/"
  }
},
{
  name: "engine-no-node-builtins",
  severity: "error",
  from: { path: "^src/engine/" },
  to: {
    path: "^(node:sqlite|node:process|process)$"
  }
},
// ...
options: {
  doNotFollow: { path: "node_modules" },  // ← prevents crawl, keeps edges
  // NO includeOnly!
}
```

Result: Architecture boundaries are correctly enforced. Both npm package and builtin violations are caught.

## Related

- Issue #37 — architecture boundary guardrails design and implementation
- Issue #38, #39, #40 — progressive extraction of domain, application, and adapters
- `typescript-strict-tooling-friction-patterns-2026-05-01` — CI gate patterns including the `boundaries` step
- `architecture.md` — Architecture boundaries section documenting target structure and enforcement
