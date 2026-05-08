export class ExecutionResultPlanNotFoundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExecutionResultPlanNotFoundError";
  }
}

export class ExecutionResultPlanHashMismatchError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExecutionResultPlanHashMismatchError";
  }
}

export class ExecutionResultConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExecutionResultConflictError";
  }
}

export class ClmmExecutionEventConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ClmmExecutionEventConflictError";
  }
}
