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
          summary: "Service health check",
          responses: {
            "200": {
              description: "Healthy response"
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
      }
    }
  } as const;
};