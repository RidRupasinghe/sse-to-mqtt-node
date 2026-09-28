import dotenv from 'dotenv';
import axios from 'axios';
import readline from 'readline';
import { MqttPublisher } from './MqttPublisher';
import { BearerTokenProvider, BodyType } from './BearerTokenProvider';
import coordinateSets from './ferry_connection'

dotenv.config();

interface ClientCredentialsBody {
  client_id: string;
  client_secret: string;
  scope: string;
  grant_type: 'client_credentials';
}

interface VesselEvent {
  imoNumber?: number | string;
}

export class SSE_TO_MQTT_BRIDGE {
  private publisher: MqttPublisher;
  private tokenProvider: BearerTokenProvider<ClientCredentialsBody>;

  constructor() {
    const { MQTT_BROKER_URL, MQTT_TOPIC, MQTT_USERNAME, MQTT_PASSWORD } = process.env;

    if (!MQTT_BROKER_URL || !MQTT_TOPIC) {
      throw new Error('Missing MQTT configuration in .env');
    }

    this.publisher = new MqttPublisher({
      brokerUrl: MQTT_BROKER_URL,
      baseTopic: MQTT_TOPIC,
      username: MQTT_USERNAME,
      password: MQTT_PASSWORD
    });

    const { AUTHENTICATION_URL, CLIENT_ID, CLIENT_SECRET, CLIENT_SCOPE } = process.env;

    if (!AUTHENTICATION_URL || !CLIENT_ID || !CLIENT_SECRET || !CLIENT_SCOPE) {
      throw new Error('Missing authentication configuration in .env');
    }

    this.tokenProvider = new BearerTokenProvider<ClientCredentialsBody>({
      url: AUTHENTICATION_URL,
      bodyType: BodyType.FormUrlEncoded,
      body: {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: CLIENT_SCOPE,
        grant_type: 'client_credentials'
      }
    });
  }

  public async startMultipleStreams(namedCoordinateSets: { name: string; coordinates: number[][] }[]) {
    for (const { name, coordinates } of namedCoordinateSets) {
      await this.getBarentswatchData(name, coordinates); // async fire-and-forget
    }
  }

  public async getBarentswatchData(name: string, coordinates: number[][], retryCount = 0): Promise<void> {
    try {
      const bearerToken = await this.tokenProvider.getBearerToken();

      console.log(bearerToken)

      const headers = {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Connection: 'keep-alive',
      };

      const postData = {
        modelType: "Full",
        geometry: {
          type: "Polygon",
          coordinates: [coordinates]
        },
        modelFormat: "Json",
        downsample: false
      };

      const response = await axios.post(process.env.STREAMING_ENDPOINT!, postData, {
        headers,
        responseType: 'stream'
      });

      console.log(`📡 Connected to SSE for "${name}"`);

      const rl = readline.createInterface({
        input: response.data,
        crlfDelay: Infinity
      });

      rl.on('line', (line: string) => {
        if (line.startsWith('data:')) {
          const eventData = line.replace(/^data:\s*/, '');
          this.publishVesselEvent(name, eventData);
        }
      });

      rl.on('close', () => {
        console.warn(`🔌 SSE stream closed for "${name}". Reconnecting...`);
        this.retryWithBackoffCoordinates(name, coordinates, retryCount);
      });

      response.data.on('error', (err: any) => {
        console.error(`❌ SSE stream error for "${name}":`, err.message);
        rl.close();
      });

      response.data.on('aborted', () => {
        console.warn(`⚠️ Stream aborted for "${name}". Retrying...`);
        rl.close();
      });

      response.data.on('end', () => {
        console.warn(`📴 Stream ended for "${name}". Reconnecting...`);
        rl.close();
      });
    } catch (err: any) {
      console.error(`❌ SSE connection failed for "${name}":`, err.message);
      this.retryWithBackoffCoordinates(name, coordinates, retryCount);
    }
  }

  private publishVesselEvent(name: string, eventData: string): void {
    let event: VesselEvent;
    try {
      event = JSON.parse(eventData) as VesselEvent;
    } catch (error: unknown) {
      console.error(`❌ Failed to parse event for "${name}":`, error instanceof Error ? error.message : String(error));
      return;
    }

    if (!event?.imoNumber) return;

    this.publisher.publish([name, String(event.imoNumber)], eventData).catch(() => {
      // already logged by MqttPublisher
    });
  }

  private retryWithBackoffCoordinates(name: string, coordinates: number[][], retryCount: number) {
    const delay = Math.min(30000, 2000 * Math.pow(2, retryCount));
    console.log(`🔁 Retrying "${name}" in ${delay / 1000}s...`);
    setTimeout(() => this.getBarentswatchData(name, coordinates, retryCount + 1), delay);
  }
}

const streamer = new SSE_TO_MQTT_BRIDGE();
streamer.startMultipleStreams(coordinateSets);