/** Thrown when an HTTP request completes with a non-2xx status. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly url: string
  ) {
    super(`Request to ${url} failed with status ${status}${statusText ? ` ${statusText}` : ''}`);
    this.name = 'HttpError';
  }
}

/** Short, secret-free description of an unknown thrown value, for logging. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
