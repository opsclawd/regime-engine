export const isTableMissingError = (error: unknown): boolean => {
  if (error instanceof Error && "code" in error) {
    const pgError = error as { code: string };
    return pgError.code === "42P01";
  }
  return false;
};
