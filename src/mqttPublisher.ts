import dotenv from 'dotenv';
import mqtt, { MqttClient } from 'mqtt';

dotenv.config();

const {
  MQTT_BROKER_URL,
  MQTT_USERNAME,
  MQTT_PASSWORD,
  MQTT_TOPIC
} = process.env as {
  MQTT_BROKER_URL: string;
  MQTT_USERNAME: string;
  MQTT_PASSWORD: string;
  MQTT_TOPIC: string;
};

let mqttClient: MqttClient;

function connect() {
  if (mqttClient && mqttClient.connected) return;

  mqttClient = mqtt.connect(MQTT_BROKER_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD
  });

  mqttClient.on('connect', () => {
    console.log('✅ Connected to MQTT broker');
  });

  mqttClient.on('error', (err) => {
    console.error('❌ MQTT connection error:', err.message);
  });

  mqttClient.on('close', () => {
    console.warn('⚠️ MQTT connection closed. Attempting reconnect...');
    setTimeout(connect, 3000);
  });
}

connect();

export function publishToMQTT(message: any) {
  if (mqttClient && mqttClient.connected) {
    mqttClient.publish(MQTT_TOPIC, message, { qos: 0 }, (err) => {
      if (err) {
        console.error('❌ MQTT publish error:', err.message);
      } else {
        console.log(`🚀 Published to MQTT topic: ${MQTT_TOPIC} => ${message}`);
      }
    });
  } else {
    console.warn('⚠️ MQTT not connected. Skipping message:', message);
  }
}