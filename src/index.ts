import dotenv from 'dotenv';
import axios from 'axios';
import readline from 'readline';
import qs from 'qs';
import { MQTTPublisher } from './mqttPublisher';

dotenv.config();

export class BarentswatchStreamer {
  private publisher: MQTTPublisher;

  constructor() {
    this.publisher = new MQTTPublisher();
  }

  private async getBearerToken(): Promise<string> {
    const { AUTHENTICATION_URL, CLIENT_ID, CLIENT_SECRET, CLIENT_SCOPE } = process.env;

    const formData = qs.stringify({
      client_id: CLIENT_ID,
      scope: CLIENT_SCOPE,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials'
    });

    const response = await axios.post(AUTHENTICATION_URL!, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('✅ Bearer token retrieved');
    return response.data.access_token || response.data.token;
  }

  private retryWithBackoff(retryCount: number) {
    const delay = Math.min(30000, 2000 * Math.pow(2, retryCount));
    console.log(`🔁 Retrying in ${delay / 1000}s...`);
    setTimeout(() => this.getBarentswatchData(retryCount + 1), delay);
  }

  public async getBarentswatchData(retryCount = 0): Promise<void> {
    try {
      const bearerToken = await this.getBearerToken();

      const headers = {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      };

      const postData = {
        modelType: "Simple",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [10.122744898278713, 63.43448467991965],
            [10.212844898278713, 63.43448467991965],
            [10.212844898278713, 63.52458467991965],
            [10.122744898278713, 63.52458467991965],
            [10.122744898278713, 63.43448467991965]
          ]]
        },
        modelFormat: "Json",
        downsample: false
      };

      const response = await axios.post(process.env.STREAMING_ENDPOINT!, postData, {
        headers,
        responseType: 'stream'
      });

      console.log('📡 Connected to SSE');

      const rl = readline.createInterface({
        input: response.data,
        crlfDelay: Infinity
      });

      rl.on('line', (line: string) => {
        if (line.startsWith('data:')) {
          const eventData = line.replace(/^data:\s*/, '');
          this.publisher.publish(eventData);
        }
      });

      rl.on('close', () => {
        console.warn('🔌 SSE stream closed. Reconnecting...');
        this.retryWithBackoff(retryCount);
      });

      response.data.on('error', (err: any) => {
        console.error('❌ SSE stream error:', err.message);
        rl.close();
      });

    } catch (err: any) {
      console.error('❌ SSE connection failed:', err.message);
      this.retryWithBackoff(retryCount);
    }
  }
}

const streamer = new BarentswatchStreamer();
streamer.getBarentswatchData();