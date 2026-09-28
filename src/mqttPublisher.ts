import mqtt, {MqttClient} from 'mqtt';
import {Logger, MqttConfig} from './types';

export class MQTTPublisher {
    private client: MqttClient;
    private readonly qos: 0 | 1 | 2;
    private readonly retain: boolean;
    private readonly logger: Logger;

    constructor(config: MqttConfig, logger: Logger) {
        if (!config.brokerUrl) {
            throw new Error('Missing MQTT broker URL');
        }

        this.qos = config.qos ?? 0;
        this.retain = config.retain ?? false;
        this.logger = logger;

        this.client = mqtt.connect(config.brokerUrl, {
            username: config.username,
            password: config.password,
            clientId: config.clientId,
        });

        this.client.on('connect', () => {
            this.logger.info('Connected to MQTT broker');
        });

        this.client.on('error', (err) => {
            this.logger.error(`MQTT connection error: ${err.message}`);
        });

        this.client.on('close', () => {
            this.logger.warn('MQTT client disconnected');
        });

        this.client.on('reconnect', () => {
            this.logger.info('MQTT client reconnecting...');
        });
    }

    publish(topic: string, message: string): void {
        if (!this.client.connected) {
            this.logger.warn('MQTT client not connected. Waiting to reconnect before publishing...');
            this.client.reconnect();
            this.client.once('connect', () => this.publishNow(topic, message));
            return;
        }

        this.publishNow(topic, message);
    }

    async close(): Promise<void> {
        await new Promise<void>((resolve) => {
            this.client.end(false, {}, () => resolve());
        });
    }

    private publishNow(topic: string, message: string): void {
        this.client.publish(topic, message, {qos: this.qos, retain: this.retain}, (err) => {
            if (err) {
                this.logger.error(`MQTT publish error: ${err.message}`);
                return;
            }
            this.logger.info(`Published to MQTT topic: ${topic}`);
        });
    }
}
