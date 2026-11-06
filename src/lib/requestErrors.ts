export class RequestError extends Error {
  constructor(message: string, public readonly statusCode = 400, public readonly code?: string) {
    super(message);
    this.name = "RequestError";
  }
}

export function publicError(error: unknown, fallback: string) {
  const value = error as { statusCode?: number; message?: string; code?: string } | null;
  const isClientError = Number.isInteger(value?.statusCode) && value.statusCode >= 400 && value.statusCode < 500;
  return {
    status: isClientError ? value.statusCode : 500,
    error: isClientError && value.message ? value.message : fallback,
    ...(isClientError && typeof value.code === "string" ? { code: value.code } : {}),
  };
}
