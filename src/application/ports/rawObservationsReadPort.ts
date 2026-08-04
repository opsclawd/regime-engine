export type RawObservation = Readonly<Record<string, unknown>>;

export interface RawObservationsReadPort {
  getByRunId(runId: string): Promise<readonly RawObservation[]>;
}
