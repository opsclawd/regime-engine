import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildApp } from "../src/app.js";
import type { RegimeState } from "../src/contract/v1/types.js";

interface HarnessExecutionFixture {
  status?: "SUCCESS" | "FAILED" | "SKIPPED";
  costs?: {
    txFeesUsd: number;
    priorityFeesUsd: number;
    slippageUsd: number;
  };
  portfolioAfter?: {
    navUsd: number;
    solUnits: number;
    usdcUnits: number;
  };
}

interface HarnessStepFixture {
  request: Record<string, unknown>;
  execution?: HarnessExecutionFixture;
}

const parseArgs = (argv: string[]) => {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    args[key] = value;
    index += 1;
  }

  return args;
};

const loadFixtureSteps = (fixturePath: string): HarnessStepFixture[] => {
  const resolvedPath = resolve(fixturePath);
  const stats = statSync(resolvedPath);

  if (stats.isDirectory()) {
    const files = readdirSync(resolvedPath)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => join(resolvedPath, file));
    return files.map((file) => {
      return JSON.parse(readFileSync(file, "utf8")) as HarnessStepFixture;
    });
  }

  return [JSON.parse(readFileSync(resolvedPath, "utf8")) as HarnessStepFixture];
};

const toActionResults = (actionTypes: string[], status: "SUCCESS" | "FAILED" | "SKIPPED") => {
  if (actionTypes.length === 0) {
    return [
      {
        actionType: "HOLD",
        status
      }
    ];
  }

  return actionTypes.map((actionType) => ({
    actionType,
    status
  }));
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const fixture = args.fixture ?? "./fixtures/demo";
  const from = args.from ?? "2026-01-01";
  const to = args.to ?? "2026-01-31";

  const fixtureSteps = loadFixtureSteps(fixture);
  if (fixtureSteps.length === 0) {
    throw new Error(`No fixture steps found in ${fixture}`);
  }

  const ledgerPath = resolve("tmp/harness-ledger.sqlite");
  rmSync(ledgerPath, { force: true });
  process.env.LEDGER_DB_PATH = ledgerPath;

  const app = buildApp();
  let regimeState: RegimeState | undefined;
  const runSummaries: Array<{
    index: number;
    planId: string;
    planHash: string;
    actionCount: number;
  }> = [];

  for (let index = 0; index < fixtureSteps.length; index += 1) {
    const step = fixtureSteps[index];
    const requestPayload = structuredClone(step.request) as Record<string, unknown>;
    if (!("regimeState" in requestPayload) && regimeState) {
      requestPayload.regimeState = regimeState;
    }
    const planResponse = await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: requestPayload
    });

    if (planResponse.statusCode !== 200) {
      throw new Error(`Plan request failed at step ${index + 1}: ${planResponse.body}`);
    }

    const plan = planResponse.json() as {
      planId: string;
      planHash: string;
      actions: Array<{ type: string }>;
      nextRegimeState: RegimeState;
    };
    regimeState = plan.nextRegimeState;
    const request = step.request as {
      asOfUnixMs: number;
      portfolio: {
        navUsd: number;
        solUnits: number;
        usdcUnits: number;
      };
    };

    const executionStatus = step.execution?.status ?? "SUCCESS";
    const executionPayload = {
      schemaVersion: "1.0",
      planId: plan.planId,
      planHash: plan.planHash,
      asOfUnixMs: request.asOfUnixMs,
      actionResults: toActionResults(
        plan.actions.map((action) => action.type),
        executionStatus
      ),
      costs: step.execution?.costs ?? {
        txFeesUsd: 0.03,
        priorityFeesUsd: 0.01,
        slippageUsd: 0.08
      },
      portfolioAfter: step.execution?.portfolioAfter ?? request.portfolio
    };

    const executionResponse = await app.inject({
      method: "POST",
      url: "/v1/execution-result",
      payload: executionPayload
    });

    if (executionResponse.statusCode !== 200) {
      throw new Error(`Execution-result failed at step ${index + 1}: ${executionResponse.body}`);
    }

    runSummaries.push({
      index: index + 1,
      planId: plan.planId,
      planHash: plan.planHash,
      actionCount: plan.actions.length
    });
  }

  const reportResponse = await app.inject({
    method: "GET",
    url: `/v1/report/weekly?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  });

  if (reportResponse.statusCode !== 200) {
    throw new Error(`Weekly report request failed: ${reportResponse.body}`);
  }

  const report = reportResponse.json() as {
    markdown: string;
    summary: Record<string, unknown>;
  };

  const outputDirectory = resolve("tmp/reports");
  mkdirSync(outputDirectory, { recursive: true });
  const outputBase = `weekly-${from}-${to}`;
  const markdownPath = join(outputDirectory, `${outputBase}.md`);
  const jsonPath = join(outputDirectory, `${outputBase}.json`);

  writeFileSync(markdownPath, `${report.markdown}\n`, "utf8");
  writeFileSync(jsonPath, `${JSON.stringify(report.summary, null, 2)}\n`, "utf8");

  await app.close();

  process.stdout.write(
    `Harness completed with ${fixtureSteps.length} steps.\n` +
      `Ledger: ${ledgerPath}\n` +
      `Markdown report: ${markdownPath}\n` +
      `JSON report: ${jsonPath}\n`
  );
  for (const summary of runSummaries) {
    process.stdout.write(
      `Step ${summary.index}: planId=${summary.planId}, actions=${summary.actionCount}, hash=${summary.planHash}\n`
    );
  }
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Harness failed: ${message}\n`);
  process.exitCode = 1;
});
