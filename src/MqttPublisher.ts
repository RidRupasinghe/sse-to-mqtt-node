import mqtt, { IClientOptions, MqttClient } from 'mqtt';
import { Logger, defaultLogger } from './logger';

export type QoS = 0 | 1 | 2;

interface MqttPublisherCommonOptions {
  /** Prefix for every published topic. */
  baseTopic: string;
  /** Default 0. */
  qos?: QoS;
  /** Default false. */
  retain?: boolean;
  logger?: Logger;
}

/** Connect to a broker, or pass an existing `client` (which is then left open on disconnect). */
export type MqttPublisherOptions = MqttPublisherCommonOptions & (
  | {
    brokerUrl: string;
    username?: string;
    password?: string;
    clientOptions?: IClientOptions;
    client?: never;
  }
  | {
    client: MqttClient;
    brokerUrl?: never;
    username?: never;
    password?: never;
    clientOptions?: never;
  }
);

export type MqttPayload = string | Buffer | object;

/** Per-message overrides of the publisher defaults. */
export interface PublishOptions {
  qos?: QoS;
  retain?: boolean;
}

export class MqttPublisher {
  private readonly client: MqttClient;
  private readonly baseTopic: string;
  private readonly qos: QoS;
  private readonly retain: boolean;
  private readonly logger: Logger;
  private readonly ownsClient: boolean;

  constructor(options: MqttPublisherOptions) {
    if (!options.baseTopic) {
      throw new Error('MqttPublisher requires a baseTopic');
    }
    if (!options.client && !options.brokerUrl) {
      throw new Error('MqttPublisher requires a brokerUrl or a client');
    }

    this.baseTopic = options.baseTopic;
    this.qos = options.qos ?? 0;
    this.retain = options.retain ?? false;
    this.logger = options.logger ?? defaultLogger;

    this.ownsClient = !options.client;
    this.client = options.client ?? mqtt.connect(options.brokerUrl, {
      ...options.clientOptions,
      username: options.username,
      password: options.password
    });

    this.registerEventHandlers();
  }

  // Messages published while disconnected are queued by mqtt.js and sent on reconnect
  public publish(topicSegments: string | string[], payload: MqttPayload, options: PublishOptions = {}): Promise<void> {
    const topic = this.buildTopic(topicSegments);
    const message = MqttPublisher.serializePayload(payload);

    return new Promise((resolve, reject) => {
      const publishOptions = { qos: options.qos ?? this.qos, retain: options.retain ?? this.retain };
      this.client.publish(topic, message, publishOptions, (error?: Error) => {
        if (error) {
          this.logger.error(`MQTT publish to ${topic} failed: ${error.message}`);
          reject(error);
          return;
        }

        this.logger.debug(`MQTT published to ${topic}`);
        resolve();
      });
    });
  }

  /** Ends the connection if this publisher created it; a client passed in is left open. */
  public async disconnect(): Promise<void> {
    this.client.removeListener('connect', this.onConnect);
    this.client.removeListener('error', this.onError);
    this.client.removeListener('close', this.onClose);
    this.client.removeListener('reconnect', this.onReconnect);

    if (this.ownsClient) {
      await this.client.endAsync();
    }
  }

  private buildTopic(topicSegments: string | string[]): string {
    const segments = Array.isArray(topicSegments) ? topicSegments : [topicSegments];
    return [this.baseTopic, ...segments].filter(Boolean).join('/');
  }

  private static serializePayload(payload: MqttPayload): string | Buffer {
    if (typeof payload === 'string' || Buffer.isBuffer(payload)) {
      return payload;
    }
    return JSON.stringify(payload);
  }

  private readonly onConnect = (): void => this.logger.info('MQTT connected');
  private readonly onError = (error: Error): void => this.logger.error(`MQTT connection error: ${error.message}`);
  private readonly onClose = (): void => this.logger.warn('MQTT disconnected');
  private readonly onReconnect = (): void => this.logger.info('MQTT reconnecting');

  private registerEventHandlers(): void {
    this.client.on('connect', this.onConnect);
    this.client.on('error', this.onError);
    this.client.on('close', this.onClose);
    this.client.on('reconnect', this.onReconnect);
  }
}
