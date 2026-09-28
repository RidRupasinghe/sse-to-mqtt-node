import mqtt, { IClientOptions, MqttClient } from 'mqtt';

export type QoS = 0 | 1 | 2;

export interface MqttPublisherOptions {
  brokerUrl: string;
  baseTopic: string;
  username?: string;
  password?: string;
  qos?: QoS;
  clientOptions?: IClientOptions;
}

export type MqttPayload = string | Buffer | object;

export class MqttPublisher {
  private readonly client: MqttClient;
  private readonly baseTopic: string;
  private readonly qos: QoS;

  constructor(options: MqttPublisherOptions) {
    if (!options.brokerUrl || !options.baseTopic) {
      throw new Error('MqttPublisher requires a brokerUrl and baseTopic');
    }

    this.baseTopic = options.baseTopic;
    this.qos = options.qos ?? 0;

    this.client = mqtt.connect(options.brokerUrl, {
      ...options.clientOptions,
      username: options.username,
      password: options.password
    });

    this.registerEventHandlers();
  }

  // Messages published while disconnected are queued by mqtt.js and sent on reconnect
  public publish(topicSegments: string | string[], payload: MqttPayload): Promise<void> {
    const topic = this.buildTopic(topicSegments);
    const message = MqttPublisher.serializePayload(payload);

    return new Promise((resolve, reject) => {
      this.client.publish(topic, message, { qos: this.qos }, (error?: Error) => {
        if (error) {
          console.error(`❌ MQTT publish error on ${topic}:`, error.message);
          reject(error);
          return;
        }

        console.log(`🚀 Published to MQTT topic: ${topic}`);
        resolve();
      });
    });
  }

  public async disconnect(): Promise<void> {
    await this.client.endAsync();
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

  private registerEventHandlers(): void {
    this.client.on('connect', () => {
      console.log('✅ Connected to MQTT broker');
    });

    this.client.on('error', (error: Error) => {
      console.error('❌ MQTT connection error:', error.message);
    });

    this.client.on('close', () => {
      console.warn('📴 MQTT client disconnected');
    });

    this.client.on('reconnect', () => {
      console.log('🔄 MQTT client reconnecting...');
    });
  }
}
