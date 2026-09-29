import readline from 'readline';
import { Readable } from 'stream';
import { ReadableStream as WebReadableStream } from 'stream/web';
import { HttpError, describeError } from './errors';
import { Logger, defaultLogger } from './logger';
import { SseEvent, SseParser } from './SseParser';

export interface TokenProvider {
  getBearerToken(): Promise<string>;
  /** Called when the server rejects the token (HTTP 401) so the next call fetches a fresh one. */
  invalidate?(): void;
  /**
   * When `token` is due for refresh (epoch ms), or undefined if unknown. An open connection
   * reconnects with a fresh token at that time instead of keeping the stream on an expiring one.
   */
  refreshAt?(token: string): number | undefined;
}

export interface RetryOptions {
  /** Delay before the first retry; doubles on each consecutive failure. Default 2000. */
  initialDelayMs: number;
  /** Upper bound for the delay. Default 30000. */
  maxDelayMs: number;
  /** Consecutive failed attempts before giving up. Default Infinity. */
  maxRetries: number;
  /** Randomises each delay by up to this fraction (0-1) to avoid reconnect storms. Default 0.2. */
  jitter: number;
}

export type SseRequest<TBody extends object> =
  | { method: 'GET'; body?: never }
  | { method: 'POST'; body?: TBody };

export type HttpMethod = SseRequest<object>['method'];

/** Optional lifecycle callbacks for a connection. */
export interface SseDataProviderHooks {
  onConnected?(): void;
  /** The open stream closed or errored; a reconnect follows unless stopped. */
  onDisconnected?(error?: Error): void;
  /** A connection attempt failed (HTTP error, network error, token error). */
  onError?(error: Error): void;
  onReconnecting?(delayMs: number, attempt: number): void;
  /** maxRetries was reached; the provider has stopped. */
  onGaveUp?(): void;
}

export type SseDataProviderOptions<TBody extends object> = SseRequest<TBody> & {
  name: string;
  url: string;
  headers?: Record<string, string>;
  tokenProvider?: TokenProvider;
  retry?: Partial<RetryOptions>;
  /** Fail the attempt if response headers don't arrive within this time. Default 30000. */
  connectTimeoutMs?: number;
  logger?: Logger;
  hooks?: SseDataProviderHooks;
  /** Called for every dispatched event with its data and the full parsed event. */
  onMessage: (data: string, event: SseEvent) => void;
};

// Lower bound between token-refresh reconnects, so a bad expiry can't cause a reconnect loop
const MIN_TOKEN_REFRESH_DELAY_MS = 1000;
// setTimeout fires immediately for delays above this
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

const DEFAULT_RETRY: RetryOptions = {
  initialDelayMs: 2000,
  maxDelayMs: 30000,
  maxRetries: Number.POSITIVE_INFINITY,
  jitter: 0.2
};

export class SseDataProvider<TBody extends object = Record<string, unknown>> {
  private readonly name: string;
  private readonly url: string;
  private readonly method: HttpMethod;
  private readonly body?: TBody;
  private readonly headers: Record<string, string>;
  private readonly tokenProvider?: TokenProvider;
  private readonly retry: RetryOptions;
  private readonly onMessage: (data: string, event: SseEvent) => void;
  private readonly parser: SseParser;
  private readonly logger: Logger;
  private readonly hooks: SseDataProviderHooks;
  private readonly connectTimeoutMs: number;

  private retryCount = 0;
  private retryTimer?: NodeJS.Timeout;
  private tokenRefreshTimer?: NodeJS.Timeout;
  private abortController?: AbortController;
  private stopped = false;
  private refreshingToken = false;

  constructor(options: SseDataProviderOptions<TBody>) {
    if (!options.url) {
      throw new Error(`SseDataProvider "${options.name}" requires a url`);
    }

    this.name = options.name;
    this.url = options.url;
    this.method = options.method;
    this.body = options.body;
    this.headers = options.headers ?? {};
    this.tokenProvider = options.tokenProvider;
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
    this.onMessage = options.onMessage;
    this.logger = options.logger ?? defaultLogger;
    this.hooks = options.hooks ?? {};
    this.connectTimeoutMs = options.connectTimeoutMs ?? 30000;
    this.parser = new SseParser((event: SseEvent) => this.onMessage(event.data, event));
  }

  public async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  public stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.tokenRefreshTimer);
    this.abortController?.abort();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    this.abortController = new AbortController();
    const abortController = this.abortController;
    const connectTimer = setTimeout(
      () => abortController.abort(new Error(`No response within ${this.connectTimeoutMs}ms`)),
      this.connectTimeoutMs
    );

    try {
      const token = await this.tokenProvider?.getBearerToken();
      const response = await fetch(this.url, {
        method: this.method,
        headers: this.buildHeaders(token),
        body: this.body ? JSON.stringify(this.body) : undefined,
        signal: abortController.signal
      });
      clearTimeout(connectTimer);

      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401) {
          this.tokenProvider?.invalidate?.();
        }
        throw new HttpError(response.status, response.statusText, this.url);
      }
      if (!response.body) {
        throw new Error('Response has no body');
      }

      this.logger.info(`SSE connected: "${this.name}"`);
      this.hooks.onConnected?.();
      this.retryCount = 0;
      if (token !== undefined) this.scheduleTokenRefresh(token);

      this.consumeStream(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>));
    } catch (error: unknown) {
      clearTimeout(connectTimer);
      if (this.stopped) return;
      this.logger.error(`SSE connection failed for "${this.name}": ${describeError(error)}`);
      this.hooks.onError?.(error instanceof Error ? error : new Error(String(error)));
      this.scheduleReconnect();
    }
  }

  private consumeStream(stream: Readable): void {
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity
    });

    let streamError: Error | undefined;

    this.parser.reset();
    rl.on('line', (line: string) => this.parser.push(line));

    rl.on('close', () => {
      clearTimeout(this.tokenRefreshTimer);
      if (this.stopped) return;

      if (this.refreshingToken) {
        this.refreshingToken = false;
        this.hooks.onDisconnected?.();
        void this.connect();
        return;
      }

      this.logger.warn(`SSE stream closed for "${this.name}"`);
      this.hooks.onDisconnected?.(streamError);
      this.scheduleReconnect();
    });

    // readline re-emits input errors; they are reported by the stream handler below
    rl.on('error', () => undefined);

    stream.on('error', (error: Error) => {
      if (!this.stopped && !this.refreshingToken) {
        this.logger.error(`SSE stream error for "${this.name}": ${error.message}`);
        streamError = error;
      }
      rl.close();
    });

    stream.on('end', () => {
      if (!this.stopped) {
        this.logger.debug(`SSE stream ended for "${this.name}"`);
      }
      rl.close();
    });
  }

  private buildHeaders(token: string | undefined): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      ...this.headers
    };

    if (this.body) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.parser.lastEventId) {
      headers['Last-Event-ID'] = this.parser.lastEventId;
    }

    if (token !== undefined) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }

  // Reconnect with a fresh token shortly before the current one expires
  private scheduleTokenRefresh(token: string): void {
    const refreshAt = this.tokenProvider?.refreshAt?.(token);
    if (refreshAt === undefined || !Number.isFinite(refreshAt)) return;

    const delay = Math.min(MAX_TIMER_DELAY_MS, Math.max(MIN_TOKEN_REFRESH_DELAY_MS, refreshAt - Date.now()));
    this.logger.debug(`Token for "${this.name}" is due for refresh in ${delay}ms`);

    clearTimeout(this.tokenRefreshTimer);
    this.tokenRefreshTimer = setTimeout(() => {
      if (Date.now() < refreshAt - MIN_TOKEN_REFRESH_DELAY_MS) {
        this.scheduleTokenRefresh(token); // capped timer fired early
        return;
      }
      this.logger.info(`Token for "${this.name}" is due for refresh, reconnecting`);
      this.refreshingToken = true;
      this.abortController?.abort();
    }, delay);
  }

  private scheduleReconnect(): void {
    if (this.retryCount >= this.retry.maxRetries) {
      this.logger.error(`Giving up on "${this.name}" after ${this.retryCount} retries`);
      this.stop();
      this.hooks.onGaveUp?.();
      return;
    }

    const initialDelayMs = this.parser.retryMs ?? this.retry.initialDelayMs;
    const backoff = Math.min(this.retry.maxDelayMs, initialDelayMs * Math.pow(2, this.retryCount));
    const jitter = Math.min(Math.max(this.retry.jitter, 0), 1);
    const delay = Math.round(backoff * (1 - jitter * Math.random()));
    this.retryCount++;

    this.logger.info(`Reconnecting "${this.name}" in ${delay}ms`);
    this.hooks.onReconnecting?.(delay, this.retryCount);
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }
}
