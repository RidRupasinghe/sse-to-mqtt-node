import mqtt, {MqttClient} from 'mqtt';
import dotenv from 'dotenv';

dotenv.config();

export class MQTTPublisher {
    private client: MqttClient;
    private readonly topic: string;

    constructor() {
        const {MQTT_BROKER_URL, MQTT_USERNAME, MQTT_PASSWORD, MQTT_TOPIC} = process.env;

        if (!MQTT_BROKER_URL || !MQTT_TOPIC) {
            throw new Error("Missing MQTT configuration in .env");
        }

        this.topic = MQTT_TOPIC;

        this.client = mqtt.connect(MQTT_BROKER_URL, {
            username: MQTT_USERNAME,
            password: MQTT_PASSWORD
        });

        this.client.on('connect', () => {
            console.log('✅ Connected to MQTT broker');
        });

        this.client.on('error', (err) => {
            console.error('❌ MQTT connection error:', err.message);
        });

        this.client.on('close', () => {
            console.warn('📴 MQTT client disconnected');
        });

        this.client.on('reconnect', () => {
            console.log('🔄 MQTT client reconnecting...');
        });
    }

    private _publishMessage(message: string, ferry_connection: string) {
        try {
            const jsonData = JSON.parse(message);
            if (!jsonData || !jsonData.imoNumber) return;

            const topic = `${this.topic}/${ferry_connection}/${jsonData.imoNumber}`;

            this.client.publish(topic, message, {qos: 0}, (err) => {
                if (err) {
                    console.error('❌ MQTT publish error:', err.message);
                } else {
                    console.log(`🚀 Published to MQTT topic: ${topic}, Message: ${jsonData.imoNumber}`);
                }
            });
        } catch (e) {
            console.error('❌ Error parsing or publishing MQTT message:', (e as Error).message);
        }
    }


    publish(message: string, ferry_connection: string) {
        if (!this.client.connected) {
            console.warn('⚠️ MQTT client not connected. Attempting to reconnect...');

            this.client.reconnect(); // triggers reconnect event if disconnected

            // Wait for reconnection before trying to publish
            this.client.once('connect', () => {
                console.log('🔌 Reconnected to MQTT broker. Publishing message...');
                this._publishMessage(message, ferry_connection);
            });

            this.client.once('error', (err) => {
                console.error('❌ Failed to reconnect to MQTT broker:', err.message);
            });

            return;
        }

        this._publishMessage(message, ferry_connection);
    }

}