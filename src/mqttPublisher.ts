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
    }

    private parse: any;

    publish(message: string, ferry_connection: string) {
        if (!this.client.connected) {
            console.warn('⚠️ MQTT client not connected. Skipping publish.');
            return;
        }

        this.parse = JSON.parse(message);
        const jsonData = this.parse;

        if (jsonData == null || jsonData.imoNumber == null) {
            return;
        }

        const topic = this.topic + `/${ferry_connection}/${jsonData.imoNumber}`

        this.client.publish(topic, message, {qos: 0}, (err) => {
            if (err) {
                console.error('❌ MQTT publish error:', err.message);
            } else {
                console.log(`🚀 Published to MQTT topic: ${topic}, Message: ${jsonData.imoNumber}`);
            }
        });
    }
}