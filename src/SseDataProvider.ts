import readline from 'readline';
import { Readable } from 'stream';
import { ReadableStream as WebReadableStream } from 'stream/web';
import { HttpError, describeError } from './errors';
import { SseEvent, SseParser } from './SseParser';

export interface TokenProvider {
  getBearerToken(): Promise<string>;
}

export interface RetryOptions {
  initialDelayMs: number;
  maxDelayMs: number;
}

export type SseRequest<TBody extends object> =
  | { method: 'GET'; body?: never }
  | { method: 'POST'; body?: TBody };

export type HttpMethod = SseRequest<object>['method'];

export type SseDataProviderOptions<TBody extends object> = SseRequest<TBody> & {
  name: string;
  url: string;
  headers?: Record<string, string>;
  tokenProvider?: TokenProvider;
  retry?: Partial<RetryOptions>;
  /** Called for every dispatched event with its data and the full parsed event. */
  onMessage: (data: string, event: SseEvent) => void;
};

const DEFAULT_RETRY: RetryOptions = {
  initialDelayMs: 2000,
  maxDelayMs: 30000
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

  private retryCount = 0;
  private retryTimer?: NodeJS.Timeout;
  private abortController?: AbortController;
  private stopped = false;

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
    this.parser = new SseParser((event: SseEvent) => this.onMessage(event.data, event));
  }

  public async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  public stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.abortController?.abort();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    this.abortController = new AbortController();

    try {
      const response = await fetch(this.url, {
        method: this.method,
        headers: await this.buildHeaders(),
        body: this.body ? JSON.stringify(this.body) : undefined,
        signal: this.abortController.signal
      });

      if (!response.ok) {
        await response.body?.cancel();
        throw new HttpError(response.status, response.statusText, this.url);
      }
      if (!response.body) {
        throw new Error('Response has no body');
      }

      console.log(`📡 Connected to SSE for "${this.name}"`);
      this.retryCount = 0;

      this.consumeStream(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>));
    } catch (error: unknown) {
      if (this.stopped) return;
      console.error(`❌ SSE connection failed for "${this.name}":`, describeError(error));
      this.scheduleReconnect();
    }
  }

  private consumeStream(stream: Readable): void {
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity
    });

    this.parser.reset();
    rl.on('line', (line: string) => this.parser.push(line));

    rl.on('close', () => {
      if (this.stopped) return;
      console.warn(`🔌 SSE stream closed for "${this.name}". Reconnecting...`);
      this.scheduleReconnect();
    });

    // readline re-emits input errors; they are reported by the stream handler below
    rl.on('error', () => undefined);

    stream.on('error', (error: Error) => {
      if (!this.stopped) {
        console.error(`❌ SSE stream error for "${this.name}":`, error.message);
      }
      rl.close();
    });

    stream.on('end', () => {
      if (!this.stopped) {
        console.warn(`📴 Stream ended for "${this.name}".`);
      }
      rl.close();
    });
  }

  private async buildHeaders(): Promise<Record<string, string>> {
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

    if (this.tokenProvider) {
      headers.Authorization = `Bearer ${await this.tokenProvider.getBearerToken()}`;
    }

    return headers;
  }

  private scheduleReconnect(): void {
    const initialDelayMs = this.parser.retryMs ?? this.retry.initialDelayMs;
    const delay = Math.min(this.retry.maxDelayMs, initialDelayMs * Math.pow(2, this.retryCount));
    this.retryCount++;

    console.log(`🔁 Retrying "${this.name}" in ${delay / 1000}s...`);
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }
}
