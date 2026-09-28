import dotenv from 'dotenv';
import { MqttPublisher } from './MqttPublisher';
import { BearerTokenProvider, BodyType } from './BearerTokenProvider';
import { SseDataProvider } from './SseDataProvider';
import coordinateSets from './ferry_connection'

dotenv.config();

interface ClientCredentialsBody {
  client_id: string;
  client_secret: string;
  scope: string;
  grant_type: 'client_credentials';
}

interface FerryConnection {
  name: string;
  coordinates: number[][];
}

interface AisStreamRequestBody {
  modelType: string;
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  modelFormat: string;
  downsample: boolean;
}

interface VesselEvent {
  imoNumber?: number | string;
}

export class SSE_TO_MQTT_BRIDGE {
  private publisher: MqttPublisher;
  private tokenProvider: BearerTokenProvider<ClientCredentialsBody>;
  private readonly streamingEndpoint: string;
  private readonly providers: SseDataProvider<AisStreamRequestBody>[] = [];

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

    const { STREAMING_ENDPOINT, AUTHENTICATION_URL, CLIENT_ID, CLIENT_SECRET, CLIENT_SCOPE } = process.env;

    if (!STREAMING_ENDPOINT) {
      throw new Error('Missing STREAMING_ENDPOINT in .env');
    }

    this.streamingEndpoint = STREAMING_ENDPOINT;

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

  public async startMultipleStreams(ferryConnections: FerryConnection[]): Promise<void> {
    for (const { name, coordinates } of ferryConnections) {
      const provider = new SseDataProvider<AisStreamRequestBody>({
        name,
        url: this.streamingEndpoint,
        tokenProvider: this.tokenProvider,
        body: {
          modelType: 'Full',
          geometry: {
            type: 'Polygon',
            coordinates: [coordinates]
          },
          modelFormat: 'Json',
          downsample: false
        },
        onMessage: (data: string) => this.publishVesselEvent(name, data)
      });

      this.providers.push(provider);
      await provider.start();
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
}

const streamer = new SSE_TO_MQTT_BRIDGE();
streamer.startMultipleStreams(coordinateSets);