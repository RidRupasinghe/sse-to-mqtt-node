import { EventEmitter } from 'events';
import { MqttPublisher, MqttPublisherOptions } from './MqttPublisher';
import { RetryOptions, SseDataProvider, SseRequest, TokenProvider } from './SseDataProvider';
import { SseEvent } from './SseParser';
import { describeError } from './errors';
import { Logger, defaultLogger } from './logger';

export type TopicSegments = string | string[];

// Returns the topic (relative to the MQTT base topic) for a message, or undefined to skip it
export type TopicResolver = (data: string, connectionName: string) => TopicSegments | undefined;

export type SseConnection<TBody extends object = Record<string, unknown>> = SseRequest<TBody> & {
  name: string;
  headers?: Record<string, string>;
  // Defaults to the connection name. String topics may contain placeholders:
  // {name} for the connection name, or {field.path} for a field of the JSON message.
  // Messages where a placeholder cannot be resolved are skipped.
  topic?: TopicSegments | TopicResolver;
};

export interface SseToMqttBridgeOptions<TBody extends object = Record<string, unknown>> {
  endpoint: string;
  connections: SseConnection<TBody>[];
  mqtt: MqttPublisherOptions;
  tokenProvider?: TokenProvider;
  headers?: Record<string, string>;
  retry?: Partial<RetryOptions>;
  /** Used by the bridge and passed to every component unless they set their own. Silent by default. */
  logger?: Logger;
}

/** Events emitted by SseToMqttBridge; each listener receives the connection name first. */
export interface SseToMqttBridgeEvents {
  connected: [connection: string];
  disconnected: [connection: string, error: Error | undefined];
  reconnecting: [connection: string, delayMs: number, attempt: number];
  gaveUp: [connection: string];
  message: [connection: string, event: SseEvent];
  published: [connection: string, topic: string, payload: string];
  /** Only emitted when there is at least one listener, so it never crashes the process. */
  error: [error: Error, connection: string];
}

const PLACEHOLDER = /\{([^{}]+)\}/g;

// Parses the message only if a template needs a field from it
class LazyJson {
  private parsed = false;
  private value: unknown;

  constructor(private readonly raw: string) {}

  public get(path: string): unknown {
    if (!this.parsed) {
      this.value = JSON.parse(this.raw);
      this.parsed = true;
    }

    return path.split('.').reduce<unknown>(
      (current, key) => (current !== null && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined),
      this.value
    );
  }
}

export class SseToMqttBridge<TBody extends object = Record<string, unknown>> extends EventEmitter<SseToMqttBridgeEvents> {
  private readonly publisher: MqttPublisher;
  private readonly providers: SseDataProvider<TBody>[];
  private readonly logger: Logger;

  constructor(options: SseToMqttBridgeOptions<TBody>) {
    super();

    if (!options.endpoint) {
      throw new Error('SseToMqttBridge requires an endpoint');
    }

    const names = options.connections.map((connection) => connection.name);
    const duplicate = names.find((name, index) => names.indexOf(name) !== index);
    if (duplicate) {
      throw new Error(`Duplicate connection name: "${duplicate}"`);
    }

    this.logger = options.logger ?? defaultLogger;
    this.publisher = new MqttPublisher({ logger: this.logger, ...options.mqtt });
    this.providers = options.connections.map((connection) => this.createProvider(options, connection));
  }

  public async start(): Promise<void> {
    await Promise.all(this.providers.map((provider) => provider.start()));
  }

  public async stop(): Promise<void> {
    this.providers.forEach((provider) => provider.stop());
    await this.publisher.disconnect();
  }

  private createProvider(options: SseToMqttBridgeOptions<TBody>, connection: SseConnection<TBody>): SseDataProvider<TBody> {
    const request: SseRequest<TBody> = connection.method === 'POST'
      ? { method: 'POST', body: connection.body }
      : { method: 'GET' };

    return new SseDataProvider<TBody>({
      ...request,
      name: connection.name,
      url: options.endpoint,
      headers: { ...options.headers, ...connection.headers },
      tokenProvider: options.tokenProvider,
      retry: options.retry,
      logger: this.logger,
      hooks: {
        onConnected: () => this.emit('connected', connection.name),
        onDisconnected: (error?: Error) => this.emit('disconnected', connection.name, error),
        onError: (error: Error) => this.emitError(error, connection.name),
        onReconnecting: (delayMs: number, attempt: number) => this.emit('reconnecting', connection.name, delayMs, attempt),
        onGaveUp: () => this.emit('gaveUp', connection.name)
      },
      onMessage: (data: string, event: SseEvent) => {
        this.emit('message', connection.name, event);
        this.handleMessage(connection, data);
      }
    });
  }

  private handleMessage(connection: SseConnection<TBody>, data: string): void {
    let topic: TopicSegments | undefined;

    try {
      topic = SseToMqttBridge.resolveTopic(connection, data);
    } catch (error: unknown) {
      this.logger.error(`Failed to resolve topic for "${connection.name}": ${describeError(error)}`);
      this.emitError(error instanceof Error ? error : new Error(String(error)), connection.name);
      return;
    }

    if (!topic || topic.length === 0) return;

    const relativeTopic = Array.isArray(topic) ? topic.join('/') : topic;
    this.publisher.publish(topic, data).then(
      () => this.emit('published', connection.name, relativeTopic, data),
      (error: Error) => this.emitError(error, connection.name) // already logged by MqttPublisher
    );
  }

  private emitError(error: Error, connection: string): void {
    if (this.listenerCount('error') > 0) {
      this.emit('error', error, connection);
    }
  }

  private static resolveTopic<TBody extends object>(connection: SseConnection<TBody>, data: string): TopicSegments | undefined {
    const topic = connection.topic ?? connection.name;

    if (typeof topic === 'function') {
      return topic(data, connection.name);
    }

    const templates = Array.isArray(topic) ? topic : [topic];
    const message = new LazyJson(data);
    const resolved: string[] = [];

    for (const template of templates) {
      const segment = SseToMqttBridge.resolveTemplate(template, connection.name, message);
      if (segment === undefined) return undefined;
      resolved.push(segment);
    }

    return resolved;
  }

  private static resolveTemplate(template: string, connectionName: string, message: LazyJson): string | undefined {
    let unresolved = false;

    const result = template.replace(PLACEHOLDER, (_match: string, key: string) => {
      const value = key === 'name' ? connectionName : message.get(key);

      if (value === undefined || value === null || value === '') {
        unresolved = true;
        return '';
      }
      return String(value);
    });

    return unresolved ? undefined : result;
  }
}
