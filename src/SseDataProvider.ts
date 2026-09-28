import axios, { AxiosError } from 'axios';
import readline from 'readline';
import { Readable } from 'stream';

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
  onMessage: (data: string) => void;
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
  private readonly onMessage: (data: string) => void;

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
      const response = await axios.request<Readable>({
        url: this.url,
        method: this.method,
        data: this.body,
        headers: await this.buildHeaders(),
        responseType: 'stream',
        signal: this.abortController.signal
      });

      console.log(`📡 Connected to SSE for "${this.name}"`);
      this.retryCount = 0;

      this.consumeStream(response.data);
    } catch (error: unknown) {
      if (this.stopped) return;
      console.error(`❌ SSE connection failed for "${this.name}":`, SseDataProvider.describeError(error));
      this.scheduleReconnect();
    }
  }

  private consumeStream(stream: Readable): void {
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity
    });

    rl.on('line', (line: string) => {
      if (line.startsWith('data:')) {
        this.onMessage(line.replace(/^data:\s*/, ''));
      }
    });

    rl.on('close', () => {
      if (this.stopped) return;
      console.warn(`🔌 SSE stream closed for "${this.name}". Reconnecting...`);
      this.scheduleReconnect();
    });

    stream.on('error', (error: Error) => {
      if (!this.stopped) {
        console.error(`❌ SSE stream error for "${this.name}":`, error.message);
      }
      rl.close();
    });

    stream.on('aborted', () => {
      if (!this.stopped) {
        console.warn(`⚠️ Stream aborted for "${this.name}".`);
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
      Connection: 'keep-alive',
      ...this.headers
    };

    if (this.body) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.tokenProvider) {
      headers.Authorization = `Bearer ${await this.tokenProvider.getBearerToken()}`;
    }

    return headers;
  }

  private scheduleReconnect(): void {
    const delay = Math.min(this.retry.maxDelayMs, this.retry.initialDelayMs * Math.pow(2, this.retryCount));
    this.retryCount++;

    console.log(`🔁 Retrying "${this.name}" in ${delay / 1000}s...`);
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }

  private static describeError(error: unknown): string {
    if (error instanceof AxiosError) {
      return `${error.message}${error.response ? ` (status ${error.response.status})` : ''}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
}
