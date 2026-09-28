import axios, {AxiosRequestConfig} from 'axios';
import readline from 'readline';
import {getAccessToken} from './oauth';
import {Logger, ReconnectOptions, StreamConfig} from './types';

export class SseStream {
    private stopped = false;
    private abortController?: AbortController;
    private retryTimer?: NodeJS.Timeout;
    private readonly initialMs: number;
    private readonly maxMs: number;

    constructor(
        private readonly stream: StreamConfig,
        private readonly onMessage: (payload: string) => void,
        private readonly logger: Logger,
        reconnect: ReconnectOptions = {},
    ) {
        this.initialMs = reconnect.initialMs ?? 2000;
        this.maxMs = reconnect.maxMs ?? 30000;
    }

    start(): void {
        this.stopped = false;
        void this.connect(0);
    }

    stop(): void {
        this.stopped = true;
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = undefined;
        }
        this.abortController?.abort();
    }

    private async connect(retryCount: number): Promise<void> {
        if (this.stopped) {
            return;
        }

        const label = this.stream.name ?? this.stream.url;

        try {
            this.abortController = new AbortController();
            const headers: Record<string, string> = {
                Accept: 'text/event-stream',
                Connection: 'keep-alive',
                ...this.stream.headers,
            };

            if (this.stream.auth?.type === 'oauth2-client-credentials') {
                const token = await getAccessToken(this.stream.auth);
                headers.Authorization = `Bearer ${token}`;
                this.logger.info(`Bearer token retrieved for "${label}"`);
            }

            if (this.stream.body !== undefined && !headers['Content-Type'] && !headers['content-type']) {
                headers['Content-Type'] = 'application/json';
            }

            const method = this.stream.method ?? (this.stream.body ? 'POST' : 'GET');
            const request: AxiosRequestConfig = {
                method,
                url: this.stream.url,
                headers,
                responseType: 'stream',
                signal: this.abortController.signal,
                ...(this.stream.body !== undefined ? {data: this.stream.body} : {}),
            };

            const response = await axios.request(request);
            this.logger.info(`Connected to SSE for "${label}"`);

            const rl = readline.createInterface({
                input: response.data,
                crlfDelay: Infinity,
            });

            rl.on('line', (line: string) => {
                if (!line.startsWith('data:')) {
                    return;
                }
                const eventData = line.replace(/^data:\s*/, '');
                if (eventData) {
                    this.onMessage(eventData);
                }
            });

            rl.on('close', () => {
                if (!this.stopped) {
                    this.logger.warn(`SSE stream closed for "${label}". Reconnecting...`);
                    this.scheduleRetry(label, retryCount);
                }
            });

            response.data.on('error', (err: Error) => {
                if (this.stopped || (err as {name?: string}).name === 'CanceledError' || err.name === 'AbortError') {
                    return;
                }
                this.logger.error(`SSE stream error for "${label}": ${err.message}`);
                rl.close();
            });

            response.data.on('aborted', () => {
                if (!this.stopped) {
                    this.logger.warn(`Stream aborted for "${label}". Retrying...`);
                    rl.close();
                }
            });

            response.data.on('end', () => {
                if (!this.stopped) {
                    this.logger.warn(`Stream ended for "${label}". Reconnecting...`);
                    rl.close();
                }
            });
        } catch (err) {
            if (this.stopped || axios.isCancel(err)) {
                return;
            }
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(`SSE connection failed for "${label}": ${message}`);
            this.scheduleRetry(label, retryCount);
        }
    }

    private scheduleRetry(label: string, retryCount: number): void {
        if (this.stopped || this.retryTimer) {
            return;
        }
        const delay = Math.min(this.maxMs, this.initialMs * Math.pow(2, retryCount));
        this.logger.info(`Retrying "${label}" in ${delay / 1000}s...`);
        this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            void this.connect(retryCount + 1);
        }, delay);
    }
}
