export const buildOpenApiDocument = () => {
  return {
    openapi: "3.1.0",
    info: {
      title: "Regime Engine API",
      version: "1.0.0"
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
          summary: "Compute a deterministic plan",
          responses: {
            "200": {
              description: "Plan response"
            },
            "400": {
              description: "Validation error"
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
          summary: "Generate weekly markdown + JSON report from ledger data",
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
          summary: "Ingest candle revisions for a logical feed",
          responses: {
            "200": {
              description: "Per-slot insert/revise/idempotent/reject counts"
            },
            "400": {
              description:
                "Validation error (BATCH_TOO_LARGE, MALFORMED_CANDLE, DUPLICATE_CANDLE_IN_BATCH, VALIDATION_ERROR, UNSUPPORTED_SCHEMA_VERSION)"
            },
            "401": {
              description: "Missing or invalid X-Candles-Ingest-Token"
            },
            "500": {
              description:
                "CANDLES_INGEST_TOKEN environment variable not set"
            }
          }
        }
      },
      "/v1/regime/current": {
        get: {
          summary:
            "Market-only regime classification + CLMM suitability for a feed",
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
              schema: { type: "string", enum: ["1h"] }
            }
          ],
          responses: {
            "200": {
              description:
                "RegimeCurrentResponse with regime, telemetry, suitability, freshness, metadata"
            },
            "400": {
              description: "VALIDATION_ERROR for missing/invalid selectors"
            },
            "404": {
              description:
                "CANDLES_NOT_FOUND when no closed candles exist for the feed"
            }
          }
        }
      }
    }
  } as const;
};
