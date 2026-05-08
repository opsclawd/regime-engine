/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ----- src/engine/** (existing pure core) -----
    {
      name: "engine-no-outer-layers",
      comment:
        "src/engine/** is the existing pure core. It must not import outer layers " +
        "(http, ledger, workers, adapters, composition, application) or the runtime entry points.",
      severity: "error",
      from: { path: "^src/engine/" },
      to: {
        path: "^src/(http|ledger|workers|adapters|composition|application)/|^src/(app|server)\\.ts$"
      }
    },
    {
      name: "engine-no-framework-npm",
      comment:
        "src/engine/** must not import framework or storage npm packages (fastify, drizzle-orm, postgres).",
      severity: "error",
      from: { path: "^src/engine/" },
      to: {
        dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer"],
        path: "node_modules/.+/(fastify|drizzle-orm|postgres)/"
      }
    },
    {
      name: "engine-no-node-builtins",
      comment: "src/engine/** must not import node:sqlite, node:process, or process.",
      severity: "error",
      from: { path: "^src/engine/" },
      to: {
        path: "^(node:sqlite|node:process|process)$"
      }
    },

    // ----- src/domain/** (future inner domain) -----
    {
      name: "domain-no-outer-layers",
      comment:
        "src/domain/** is future inner domain code. It must not import application, " +
        "outer adapters, runtime entry points, or any outer-layer folder.",
      severity: "error",
      from: { path: "^src/domain/" },
      to: {
        path: "^src/(http|ledger|workers|adapters|composition|application)/|^src/(app|server)\\.ts$"
      }
    },
    {
      name: "domain-no-framework-npm",
      comment:
        "src/domain/** must not import framework or storage npm packages (fastify, drizzle-orm, postgres).",
      severity: "error",
      from: { path: "^src/domain/" },
      to: {
        dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer"],
        path: "node_modules/.+/(fastify|drizzle-orm|postgres)/"
      }
    },
    {
      name: "domain-no-node-builtins",
      comment: "src/domain/** must not import node:sqlite, node:process, or process.",
      severity: "error",
      from: { path: "^src/domain/" },
      to: {
        path: "^(node:sqlite|node:process|process)$"
      }
    },

    // ----- src/application/** (future use-case orchestration) -----
    {
      name: "application-no-outer-layers",
      comment:
        "src/application/** orchestrates use cases against ports. It must not import http, " +
        "ledger, adapters, composition, workers, or runtime entry points.",
      severity: "error",
      from: { path: "^src/application/" },
      to: {
        path: "^src/(http|ledger|workers|adapters|composition)/|^src/(app|server)\\.ts$"
      }
    },
    {
      name: "application-no-framework-npm",
      comment:
        "src/application/** must not import framework or storage npm packages (fastify, drizzle-orm, postgres).",
      severity: "error",
      from: { path: "^src/application/" },
      to: {
        dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer"],
        path: "node_modules/.+/(fastify|drizzle-orm|postgres)/"
      }
    },
    {
      name: "application-no-node-builtins",
      comment: "src/application/** must not import node:sqlite, node:process, or process.",
      severity: "error",
      from: { path: "^src/application/" },
      to: {
        path: "^(node:sqlite|node:process|process)$"
      }
    },

    // ----- src/adapters/** (future outer adapters) -----
    {
      name: "adapters-no-composition-or-entry",
      comment:
        "src/adapters/** is outer-layer code. It must not import composition wiring or runtime entry points.",
      severity: "error",
      from: { path: "^src/adapters/" },
      to: {
        path: "^src/composition/|^src/(app|server)\\.ts$"
      }
    }
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["node", "import", "require", "default"],
      mainFields: ["main", "types"]
    }
  }
};
