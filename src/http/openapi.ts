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
      }
    }
  } as const;
};
