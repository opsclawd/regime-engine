import evidenceBundleSchema from "../../../contracts/evidence-bundle/v1/evidence-bundle.schema.json" with { type: "json" };
import policyInsightSchema from "../../../contracts/policy-insight/v1/policy-insight.schema.json" with { type: "json" };
import currentPairInsight from "../../../contracts/policy-insight/v1/fixtures/valid/current-pair.json" with { type: "json" };
import historyInsight from "../../../contracts/policy-insight/v1/fixtures/valid/history.json" with { type: "json" };

export const buildOpenApiDocument = () => {
  return {
    openapi: "3.1.0",
    info: {
      title: "Regime Engine API",
      version: "1.0.0"
    },
    components: {
      securitySchemes: {
        EvidenceIngestToken: {
          type: "apiKey",
          in: "header",
          name: "X-Evidence-Ingest-Token"
        }
      },
      schemas: {
        EvidenceBundleV1: evidenceBundleSchema,
        EvidenceRecord: {
          type: "object",
          additionalProperties: false,
          required: ["bundle", "evidenceHash", "receiptId", "receivedAt", "freshness"],
          properties: {
            bundle: { $ref: "#/components/schemas/EvidenceBundleV1" },
            evidenceHash: { type: "string" },
            receiptId: { type: "integer" },
            receivedAt: { type: "string", format: "date-time" },
            freshness: { $ref: "#/components/schemas/EvidenceFreshness" }
          }
        },
        EvidenceFreshness: {
          type: "object",
          additionalProperties: false,
          required: ["status", "asOf", "freshUntil", "expiresAt"],
          properties: {
            status: { type: "string", enum: ["FRESH", "STALE", "EXPIRED"] },
            asOf: { type: "string", format: "date-time" },
            freshUntil: { type: "string", format: "date-time" },
            expiresAt: { type: "string", format: "date-time" }
          }
        },
        EvidenceReceipt: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "status", "runId", "evidenceHash", "receiptId", "receivedAt"],
          properties: {
            schemaVersion: { type: "string" },
            status: { type: "string" },
            runId: { type: "string" },
            evidenceHash: { type: "string" },
            receiptId: { type: "integer" },
            receivedAt: { type: "string", format: "date-time" }
          }
        },
        EvidenceCurrentResponse: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "pair", "scope", "queriedAt", "items"],
          properties: {
            schemaVersion: { type: "string" },
            pair: { type: "string" },
            scope: { type: "string" },
            queriedAt: { type: "string", format: "date-time" },
            items: {
              type: "array",
              items: { $ref: "#/components/schemas/EvidenceRecord" }
            }
          }
        },
        EvidenceHistoryResponse: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "pair", "scope", "queriedAt", "limit", "items", "nextCursor"],
          properties: {
            schemaVersion: { type: "string" },
            pair: { type: "string" },
            scope: { type: "string" },
            queriedAt: { type: "string", format: "date-time" },
            limit: { type: "integer" },
            items: {
              type: "array",
              items: { $ref: "#/components/schemas/EvidenceRecord" }
            },
            nextCursor: { type: "string", nullable: true }
          }
        },
        EvidenceError: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "error"],
          properties: {
            schemaVersion: { type: "string" },
            error: {
              type: "object",
              additionalProperties: false,
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["path", "code", "message"],
                    properties: {
                      path: { type: "string" },
                      code: { type: "string" },
                      message: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        },
        EvidenceCursor: {
          type: "object",
          additionalProperties: false,
          required: ["v", "receivedAtUnixMs", "id"],
          properties: {
            v: { const: 1 },
            receivedAtUnixMs: { type: "integer" },
            id: { type: "integer", minimum: 1 }
          }
        },
        PolicyInsightSchema: policyInsightSchema,
        InsightCurrentResponse: {
          $ref: "#/components/schemas/PolicyInsightSchema"
        },
        InsightHistoryResponse: {
          $ref: "#/components/schemas/PolicyInsightSchema/$defs/PolicyInsightHistoryResponse"
        },
        InsightError: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "error"],
          properties: {
            schemaVersion: { type: "string" },
            error: {
              type: "object",
              additionalProperties: false,
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["path", "code", "message"],
                    properties: {
                      path: { type: "string" },
                      code: { type: "string" },
                      message: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    paths: {
      "/health": {
        get: {
          summary: "Service health check (includes Postgres and SQLite status)",
          responses: {
            "200": {
              description: "All data stores healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["ok", "postgres", "sqlite"],
                    properties: {
                      ok: { type: "boolean" },
                      postgres: { type: "string", enum: ["ok", "unavailable", "not_configured"] },
                      sqlite: { type: "string", enum: ["ok", "unavailable"] }
                    }
                  }
                }
              }
            },
            "503": {
              description: "One or more data stores unhealthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["ok", "postgres", "sqlite"],
                    properties: {
                      ok: { type: "boolean" },
                      postgres: { type: "string", enum: ["ok", "unavailable", "not_configured"] },
                      sqlite: { type: "string", enum: ["ok", "unavailable"] }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/version": {
        get: {
          summary: "Service version metadata",
          responses: {
            "200": {
              description: "Version payload"
            }
          }
        }
      },
      "/v1/openapi.json": {
        get: {
          summary: "OpenAPI document",
          responses: {
            "200": {
              description: "OpenAPI JSON"
            }
          }
        }
      },
      "/v1/plan": {
        post: {
          summary: "Compute a position-scoped CLMM plan for a single position",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: [
                    "schemaVersion",
                    "asOfUnixMs",
                    "market",
                    "position",
                    "portfolio",
                    "autopilotState",
                    "config"
                  ],
                  properties: {
                    schemaVersion: { type: "string", enum: ["1.0"] },
                    asOfUnixMs: { type: "number" },
                    market: {
                      type: "object",
                      required: ["symbol", "source", "network", "poolAddress", "timeframe"],
                      properties: {
                        symbol: { type: "string" },
                        source: { type: "string" },
                        network: { type: "string" },
                        poolAddress: { type: "string" },
                        timeframe: { type: "string", enum: ["15m", "1h"] }
                      }
                    },
                    position: {
                      type: "object",
                      required: [
                        "positionId",
                        "observedAtUnixMs",
                        "lowerBoundPrice",
                        "upperBoundPrice",
                        "currentPrice",
                        "rangeState",
                        "breachQualified"
                      ],
                      properties: {
                        positionId: { type: "string" },
                        observedAtUnixMs: { type: "number" },
                        lowerBoundPrice: { type: "number" },
                        upperBoundPrice: { type: "number" },
                        currentPrice: { type: "number" },
                        rangeState: {
                          type: "string",
                          enum: ["in-range", "below-range", "above-range"]
                        },
                        breachQualified: { type: "boolean" },
                        breachQualifiedAtUnixMs: { type: "number" },
                        distanceToLowerPct: { type: "number" },
                        distanceToUpperPct: { type: "number" },
                        liquidityUsd: { type: "number" },
                        unclaimedFeesUsd: { type: "number" },
                        inventorySkewSolPct: { type: "number" },
                        inventorySkewUsdcPct: { type: "number" }
                      }
                    },
                    portfolio: {
                      type: "object",
                      required: ["navUsd", "solUnits", "usdcUnits"],
                      properties: {
                        navUsd: { type: "number" },
                        solUnits: { type: "number" },
                        usdcUnits: { type: "number" }
                      }
                    },
                    autopilotState: {
                      type: "object",
                      required: [
                        "activeClmm",
                        "stopouts24h",
                        "redeploys24h",
                        "cooldownUntilUnixMs",
                        "standDownUntilUnixMs",
                        "strikeCount"
                      ],
                      properties: {
                        activeClmm: { type: "boolean" },
                        stopouts24h: { type: "number" },
                        redeploys24h: { type: "number" },
                        cooldownUntilUnixMs: { type: "number" },
                        standDownUntilUnixMs: { type: "number" },
                        strikeCount: { type: "number" }
                      }
                    },
                    config: {
                      type: "object",
                      required: ["regime", "allocation", "churn", "baselines"],
                      properties: {
                        regime: { type: "object" },
                        allocation: { type: "object" },
                        churn: { type: "object" },
                        baselines: { type: "object" }
                      }
                    },
                    regimeState: { type: "object" }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Position-scoped plan with HOLD / STAND_DOWN / REQUEST_EXIT_CLMM",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: [
                      "schemaVersion",
                      "planId",
                      "planHash",
                      "asOfUnixMs",
                      "scope",
                      "regime",
                      "targets",
                      "actions",
                      "constraints",
                      "nextRegimeState",
                      "reasons",
                      "telemetry",
                      "marketData"
                    ],
                    properties: {
                      schemaVersion: { type: "string" },
                      planId: { type: "string" },
                      planHash: { type: "string" },
                      asOfUnixMs: { type: "number" },
                      scope: { type: "object" },
                      regime: { type: "string" },
                      targets: { type: "object" },
                      actions: { type: "array" },
                      constraints: { type: "object" },
                      nextRegimeState: { type: "object" },
                      reasons: { type: "array" },
                      telemetry: { type: "object" },
                      marketData: { type: "object" }
                    }
                  }
                }
              }
            },
            "400": {
              description: "Validation error (invalid request body)",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["schemaVersion", "error"],
                    properties: {
                      schemaVersion: { type: "string" },
                      error: {
                        type: "object",
                        required: ["code", "message"],
                        properties: {
                          code: { type: "string" },
                          message: { type: "string" },
                          details: { type: "array" }
                        }
                      }
                    }
                  }
                }
              }
            },
            "503": {
              description: "Service unavailable (stale market data or position state)",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["schemaVersion", "error"],
                    properties: {
                      schemaVersion: { type: "string" },
                      error: {
                        type: "object",
                        required: ["code", "message"],
                        properties: {
                          code: { type: "string" },
                          message: { type: "string" },
                          details: { type: "array" }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/v1/execution-result": {
        post: {
          summary: "Submit execution result",
          responses: {
            "200": {
              description: "Execution result acknowledgement"
            },
            "400": {
              description: "Validation error"
            },
            "404": {
              description: "Referenced plan was not found"
            },
            "409": {
              description: "Plan linkage or execution result conflict"
            }
          }
        }
      },
      "/v1/clmm-execution-result": {
        post: {
          summary: "Ingest CLMM execution event",
          responses: {
            "200": {
              description: "CLMM execution event acknowledged"
            },
            "400": {
              description: "Validation error"
            },
            "401": {
              description: "Invalid or missing authentication token"
            },
            "409": {
              description: "CLMM execution event conflict"
            }
          }
        }
      },
      "/v1/report/weekly": {
        get: {
          summary:
            "Generate weekly markdown + JSON report. Report facts come from the append-only ledger; baseline prices (SOL HODL, SOL DCA, USDC carry) come from the active canonical candle store.",
          responses: {
            "200": {
              description: "Weekly report payload"
            },
            "400": {
              description: "Invalid date range"
            }
          }
        }
      },
      "/v1/sr-levels": {
        post: {
          summary: "Ingest S/R level brief",
          responses: {
            "201": {
              description: "S/R level brief ingested"
            },
            "200": {
              description: "Idempotent replay of already-ingested brief"
            },
            "400": {
              description: "Validation error"
            },
            "401": {
              description: "Invalid or missing authentication token"
            },
            "409": {
              description: "S/R level brief conflict"
            }
          }
        }
      },
      "/v1/sr-levels/current": {
        get: {
          summary: "Get current S/R levels for symbol and source",
          responses: {
            "200": {
              description: "Current S/R levels"
            },
            "400": {
              description: "Missing required query parameters"
            },
            "404": {
              description: "No S/R level brief found"
            }
          }
        }
      },
      "/v1/candles": {
        post: {
          summary:
            "Ingest candle revisions for a logical feed. Provider ingestion is restricted to timeframe=15m; 1h regime reads are derived from stored 15m candles by GET /v1/regime/current.",
          responses: {
            "200": {
              description: "Per-slot insert/revise/idempotent/reject counts"
            },
            "400": {
              description:
                "Validation error (BATCH_TOO_LARGE, MALFORMED_CANDLE, DUPLICATE_CANDLE_IN_BATCH, VALIDATION_ERROR, UNSUPPORTED_SCHEMA_VERSION). Candle unixMs must be aligned to 15-minute boundaries."
            },
            "401": {
              description: "Missing or invalid X-Candles-Ingest-Token"
            },
            "500": {
              description: "CANDLES_INGEST_TOKEN environment variable not set"
            }
          }
        }
      },
      "/v1/regime/current": {
        get: {
          summary:
            "Market-only regime classification + CLMM suitability. timeframe=15m classifies stored 15m candles directly; timeframe=1h derives complete 1h candles from stored 15m candles on the fly.",
          parameters: [
            {
              name: "symbol",
              in: "query",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "source",
              in: "query",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "network",
              in: "query",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "poolAddress",
              in: "query",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "timeframe",
              in: "query",
              required: true,
              schema: { type: "string", enum: ["15m", "1h"] }
            }
          ],
          responses: {
            "200": {
              description:
                "RegimeCurrentResponse with regime, telemetry, suitability, freshness, metadata. " +
                'Metadata includes sourceTimeframe (always "15m"), sourceCandleCount, ' +
                'and optionally derivedTimeframe ("1h") and aggregationVersion ("ohlcv-agg-v1") ' +
                "when timeframe=1h aggregation was applied."
            },
            "400": {
              description: "VALIDATION_ERROR for missing/invalid selectors"
            },
            "404": {
              description:
                "CANDLES_NOT_FOUND with detail code NO_SOURCE_CANDLES or " +
                "NO_DERIVED_CANDLES_AFTER_AGGREGATION when no complete derived bars survive cutoff"
            }
          }
        }
      },
      "/v1/insights/sol-usdc": {
        post: {
          summary: "Ingest a CLMM insight for SOL/USDC",
          responses: {
            "201": {
              description: "Insight created successfully"
            },
            "200": {
              description: "Idempotent replay of already-ingested insight"
            },
            "400": {
              description: "Validation error"
            },
            "401": {
              description: "Invalid or missing X-Insight-Ingest-Token"
            },
            "409": {
              description: "Insight conflict (same source+runId, different payload)"
            },
            "500": {
              description: "INSIGHT_INGEST_TOKEN environment variable not set"
            },
            "503": {
              description: "Insights store not available (no DATABASE_URL configured)"
            }
          }
        }
      },
      "/v1/insights/sol-usdc/current": {
        get: {
          summary: "Get the most recent CLMM insight for SOL/USDC",
          parameters: [
            {
              name: "scope",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["pair", "position"] }
            },
            {
              name: "whirlpoolAddress",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            },
            {
              name: "walletAddress",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            },
            {
              name: "positionId",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            }
          ],
          responses: {
            "200": {
              description: "Current insight with freshness metadata",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/InsightCurrentResponse" },
                  examples: {
                    "Current SOL/USDC insight": {
                      value: currentPairInsight
                    }
                  }
                }
              }
            },
            "400": {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/InsightError" }
                }
              }
            },
            "404": {
              description: "No insight found for SOL/USDC",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/InsightError" }
                }
              }
            },
            "503": {
              description: "Insights store not available (no DATABASE_URL configured)",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/InsightError" }
                }
              }
            }
          }
        }
      },
      "/v1/insights/sol-usdc/history": {
        get: {
          summary: "Get historical CLMM insights for SOL/USDC",
          parameters: [
            {
              name: "scope",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["pair", "position"] }
            },
            {
              name: "whirlpoolAddress",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            },
            {
              name: "walletAddress",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            },
            {
              name: "positionId",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }
            },
            {
              name: "cursor",
              in: "query",
              required: false,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": {
              description: "List of insights with pagination support",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/InsightHistoryResponse" },
                  examples: {
                    "Historical SOL/USDC insights": {
                      value: historyInsight
                    }
                  }
                }
              }
            },
            "400": {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/InsightError" }
                }
              }
            },
            "503": {
              description: "Insights store not available (no DATABASE_URL configured)",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/InsightError" }
                }
              }
            }
          }
        }
      },
      "/v2/sr-levels": {
        post: {
          summary: "Ingest S/R thesis brief (v2)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["schemaVersion", "source", "symbol", "brief", "theses"],
                  additionalProperties: false,
                  properties: {
                    schemaVersion: { type: "string", enum: ["2.0"] },
                    source: { type: "string", minLength: 1, maxLength: 64 },
                    symbol: { type: "string", minLength: 1, maxLength: 64 },
                    brief: {
                      type: "object",
                      required: ["briefId", "sourceRecordedAtIso", "summary"],
                      additionalProperties: false,
                      properties: {
                        briefId: { type: "string", minLength: 1, maxLength: 256 },
                        sourceRecordedAtIso: {
                          type: "string",
                          format: "date-time",
                          nullable: true
                        },
                        summary: { type: "string", nullable: true }
                      }
                    },
                    theses: {
                      type: "array",
                      minItems: 1,
                      maxItems: 100,
                      items: {
                        type: "object",
                        required: [
                          "asset",
                          "timeframe",
                          "bias",
                          "setupType",
                          "supportLevels",
                          "resistanceLevels",
                          "entryZone",
                          "targets",
                          "invalidation",
                          "trigger",
                          "chartReference",
                          "sourceHandle",
                          "sourceChannel",
                          "sourceKind",
                          "sourceReliability",
                          "rawThesisText",
                          "collectedAt",
                          "publishedAt",
                          "sourceUrl",
                          "notes"
                        ],
                        additionalProperties: false,
                        properties: {
                          asset: { type: "string", minLength: 1, maxLength: 64 },
                          timeframe: { type: "string", minLength: 1, maxLength: 64 },
                          bias: { type: "string", nullable: true },
                          setupType: { type: "string", nullable: true },
                          supportLevels: { type: "array", items: { type: "string" } },
                          resistanceLevels: { type: "array", items: { type: "string" } },
                          entryZone: { type: "string", nullable: true },
                          targets: { type: "array", items: { type: "string" } },
                          invalidation: { type: "string", nullable: true },
                          trigger: { type: "string", nullable: true },
                          chartReference: { type: "string", nullable: true },
                          sourceHandle: { type: "string", minLength: 1, maxLength: 256 },
                          sourceChannel: { type: "string", nullable: true },
                          sourceKind: { type: "string", minLength: 1, maxLength: 64 },
                          sourceReliability: { type: "string", nullable: true },
                          rawThesisText: { type: "string", nullable: true },
                          collectedAt: { type: "string", format: "date-time", nullable: true },
                          publishedAt: { type: "string", format: "date-time", nullable: true },
                          sourceUrl: { type: "string", nullable: true },
                          notes: { type: "string", nullable: true }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            "201": {
              description: "S/R thesis brief ingested"
            },
            "200": {
              description: "Idempotent replay of already-ingested brief"
            },
            "400": {
              description: "Validation error or unsupported schema version"
            },
            "401": {
              description: "Invalid or missing X-Ingest-Token"
            },
            "409": {
              description: "S/R thesis v2 conflict (same identity, different payload)"
            },
            "500": {
              description: "OPENCLAW_INGEST_TOKEN environment variable not set"
            },
            "503": {
              description: "S/R thesis v2 store not available (no DATABASE_URL configured)"
            }
          }
        }
      },
      "/v2/sr-levels/current": {
        get: {
          summary: "Get current S/R thesis brief for symbol and source (v2)",
          parameters: [
            {
              name: "symbol",
              in: "query",
              required: true,
              schema: { type: "string", minLength: 1, maxLength: 64 }
            },
            {
              name: "source",
              in: "query",
              required: true,
              schema: { type: "string", minLength: 1, maxLength: 64 }
            }
          ],
          responses: {
            "200": {
              description: "Current S/R thesis brief"
            },
            "400": {
              description: "Missing required query parameters"
            },
            "404": {
              description: "No S/R thesis brief found"
            },
            "503": {
              description: "S/R thesis v2 store not available (no DATABASE_URL configured)"
            }
          }
        }
      },
      "/v1/evidence/sol-usdc": {
        post: {
          summary: "Ingest an evidence bundle",
          description:
            "Fixed pair SOL/USDC. Accepts pair scope (default, no selection) or non-pair scopes (whirlpool/wallet/position) on solana-mainnet. Identifier bounds: 1-128 characters.",
          security: [{ EvidenceIngestToken: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EvidenceBundleV1" }
              }
            }
          },
          responses: {
            "200": {
              description: "Evidence bundle already exists (idempotent)",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EvidenceReceipt" },
                  example: {
                    schemaVersion: "1.0",
                    status: "duplicate",
                    runId: "run-123",
                    evidenceHash: "abc123",
                    receiptId: 42,
                    receivedAt: "2026-07-18T12:00:00.000Z"
                  }
                }
              }
            },
            "201": {
              description: "Evidence bundle created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EvidenceReceipt" },
                  example: {
                    schemaVersion: "1.0",
                    status: "created",
                    runId: "run-123",
                    evidenceHash: "abc123",
                    receiptId: 42,
                    receivedAt: "2026-07-18T12:00:00.000Z"
                  }
                }
              }
            },
            "400": {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EvidenceError" }
                }
              }
            },
            "401": {
              description: "Invalid or missing X-Evidence-Ingest-Token"
            },
            "409": {
              description: "Conflict: same source+runId, different payload"
            },
            "413": {
              description: "Payload too large (max 4MB)"
            },
            "500": {
              description: "Internal server error"
            },
            "503": {
              description: "Evidence store unavailable"
            }
          }
        }
      },
      "/v1/evidence/sol-usdc/current": {
        get: {
          summary: "Get most recent evidence bundle with no selection",
          description:
            "Returns the most recent evidence bundle matching scope and source filters. Pair scope is default (no selection). Non-pair scopes require solana-mainnet network with whirlpoolAddress, walletAddress, or positionId.",
          security: [],
          parameters: [
            {
              name: "scope",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["pair", "whirlpool", "wallet", "position"] }
            },
            {
              name: "whirlpoolAddress",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            },
            {
              name: "walletAddress",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            },
            {
              name: "positionId",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            },
            {
              name: "source.publisher",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            },
            {
              name: "source.sourceId",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            }
          ],
          responses: {
            "200": {
              description: "Current evidence bundle",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EvidenceCurrentResponse" },
                  example: {
                    schemaVersion: "1.0",
                    pair: "SOL/USDC",
                    scope: "pair",
                    queriedAt: "2026-07-18T12:30:00.000Z",
                    items: [
                      {
                        bundle: {},
                        evidenceHash: "abc123",
                        receiptId: 42,
                        receivedAt: "2026-07-18T12:00:00.000Z",
                        freshness: {
                          status: "FRESH",
                          asOf: "2026-07-18T12:00:00.000Z",
                          freshUntil: "2026-07-18T18:00:00.000Z",
                          expiresAt: "2026-07-19T12:00:00.000Z"
                        }
                      }
                    ]
                  }
                }
              }
            },
            "400": {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EvidenceError" }
                }
              }
            },
            "404": {
              description: "No evidence found matching criteria"
            },
            "500": {
              description: "Internal server error"
            },
            "503": {
              description: "Evidence store unavailable"
            }
          }
        }
      },
      "/v1/evidence/sol-usdc/history": {
        get: {
          summary: "Get historical evidence bundles",
          description:
            "Returns paginated historical evidence bundles with opaque cursor continuation. Scope and source filters must remain unchanged between requests for consistent pagination.",
          security: [],
          parameters: [
            {
              name: "cursor",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Opaque cursor for continuation. Must use exactly as received."
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 100, default: 30 }
            },
            {
              name: "scope",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["pair", "whirlpool", "wallet", "position"] }
            },
            {
              name: "whirlpoolAddress",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            },
            {
              name: "walletAddress",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            },
            {
              name: "positionId",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            },
            {
              name: "source.publisher",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            },
            {
              name: "source.sourceId",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            }
          ],
          responses: {
            "200": {
              description: "Historical evidence bundles",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EvidenceHistoryResponse" },
                  example: {
                    items: [
                      {
                        bundle: {},
                        evidenceHash: "abc123",
                        receiptId: 42,
                        receivedAt: "2026-07-18T12:00:00.000Z",
                        freshness: {
                          status: "FRESH",
                          asOf: "2026-07-18T12:00:00.000Z",
                          freshUntil: "2026-07-18T18:00:00.000Z",
                          expiresAt: "2026-07-19T12:00:00.000Z"
                        }
                      }
                    ],
                    nextCursor: "eyJ2IjoxLCJyZWNlaXZlZEF0VW5peE1zIjoxNzUxMzgwODAwMDAwLCJpZCI6NDJ9"
                  }
                }
              }
            },
            "400": {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EvidenceError" }
                }
              }
            },
            "500": {
              description: "Internal server error"
            },
            "503": {
              description: "Evidence store unavailable"
            }
          }
        }
      }
    }
  } as const;
};
