import { EventEmitter } from 'events';
import { MqttPayload, MqttPublisher, MqttPublisherOptions, QoS } from './MqttPublisher';
import { RetryOptions, SseDataProvider, SseRequest, TokenProvider } from './SseDataProvider';
import { SseEvent } from './SseParser';
import { describeError } from './errors';
import { resolveTopicTemplates, validateTopicTemplate } from './topicTemplate';
import { Logger, defaultLogger } from './logger';

export type TopicSegments = string | string[];

// Returns the topic (relative to the MQTT base topic) for a message, or undefined to skip it
export type TopicResolver = (data: string, connectionName: string) => TopicSegments | undefined;

/** Returns the payload to publish for an event, or undefined to skip it. */
export type PayloadTransform = (data: string, event: SseEvent) => MqttPayload | undefined;

export type SseConnection<TBody extends object = Record<string, unknown>> = SseRequest<TBody> & {
  name: string;
  /** Absolute URL, or a path resolved against the bridge endpoint. Defaults to the endpoint. */
  url?: string;
  headers?: Record<string, string>;
  /** Overrides the publisher's default QoS for this connection. */
  qos?: QoS;
  /** Overrides the publisher's default retain flag for this connection. */
  retain?: boolean;
  /** Reshapes or filters each message before publishing; the topic is still resolved from the raw data. */
  transform?: PayloadTransform;
  // Defaults to "{name}". String topics may contain placeholders:
  // {name} for the connection name, or {field.path} for a field of the JSON message.
  // Messages where a placeholder cannot be resolved are skipped. Placeholder values
  // have +, #, / and NUL replaced with _.
  topic?: TopicSegments | TopicResolver;
};

export interface SseToMqttBridgeOptions<TBody extends object = Record<string, unknown>> {
  endpoint: string;
  connections: SseConnection<TBody>[];
  mqtt: MqttPublisherOptions;
  tokenProvider?: TokenProvider;
  headers?: Record<string, string>;
  retry?: Partial<RetryOptions>;
  /** Fail a connection attempt if no response headers arrive within this time. Default 30000. */
  connectTimeoutMs?: number;
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
  published: [connection: string, topic: string, payload: MqttPayload];
  /** Only emitted when there is at least one listener, so it never crashes the process. */
  error: [error: Error, connection: string];
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

    for (const connection of options.connections) {
      if (typeof connection.topic === 'string') validateTopicTemplate(connection.topic);
      if (Array.isArray(connection.topic)) connection.topic.forEach(validateTopicTemplate);
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
      url: new URL(connection.url ?? '', options.endpoint).toString(),
      headers: { ...options.headers, ...connection.headers },
      tokenProvider: options.tokenProvider,
      retry: options.retry,
      connectTimeoutMs: options.connectTimeoutMs,
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
        this.handleMessage(connection, data, event);
      }
    });
  }

  private handleMessage(connection: SseConnection<TBody>, data: string, event: SseEvent): void {
    let topic: TopicSegments | undefined;
    let payload: MqttPayload | undefined;

    try {
      topic = SseToMqttBridge.resolveTopic(connection, data);
      if (!topic || topic.length === 0) return;
      payload = connection.transform ? connection.transform(data, event) : data;
    } catch (error: unknown) {
      this.logger.error(`Failed to process message for "${connection.name}": ${describeError(error)}`);
      this.emitError(error instanceof Error ? error : new Error(String(error)), connection.name);
      return;
    }

    if (payload === undefined) return;

    const published = payload;
    const relativeTopic = Array.isArray(topic) ? topic.join('/') : topic;
    this.publisher.publish(topic, published, { qos: connection.qos, retain: connection.retain }).then(
      () => this.emit('published', connection.name, relativeTopic, published),
      (error: Error) => this.emitError(error, connection.name) // already logged by MqttPublisher
    );
  }

  private emitError(error: Error, connection: string): void {
    if (this.listenerCount('error') > 0) {
      this.emit('error', error, connection);
    }
  }

  private static resolveTopic<TBody extends object>(connection: SseConnection<TBody>, data: string): TopicSegments | undefined {
    const topic = connection.topic ?? '{name}';

    if (typeof topic === 'function') {
      return topic(data, connection.name);
    }
    return resolveTopicTemplates(Array.isArray(topic) ? topic : [topic], connection.name, data);
  }
}
