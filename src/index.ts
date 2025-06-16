import dotenv from 'dotenv';
import axios from 'axios';
import qs from 'qs';
import readline from 'readline';
import { publishToMQTT } from './mqttPublisher';

dotenv.config();

const {
  AUTHENTICATION_URL,
  CLIENT_ID,
  CLIENT_SECRET,
  CLIENT_SCOPE,
  STREAMING_ENDPOINT
} = process.env as {
  AUTHENTICATION_URL: string;
  CLIENT_ID: string;
  CLIENT_SECRET: string;
  CLIENT_SCOPE: string;
  STREAMING_ENDPOINT: string;
};


async function getBearerToken() {
  try {
    const formData = qs.stringify({
      client_id: CLIENT_ID,
      scope: CLIENT_SCOPE,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials'
    });

    const response = await axios.post(AUTHENTICATION_URL, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('✅ Bearer token retrieved');
    return response.data.access_token || response.data.token;
  } catch (err: any) {
    console.error('❌ Failed to fetch token:', err.message);
    throw err;
  }
}

async function getBarentswatchData(retryCount = 0) {
  try {
    const bearerToken = await getBearerToken();

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

    const response = await axios.post(STREAMING_ENDPOINT, postData, {
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
        // console.log('📥 SSE Event:', eventData);
        publishToMQTT(eventData);
      }
    });

    rl.on('close', () => {
      console.warn('🔌 SSE stream closed. Reconnecting...');
      retryWithBackoff(retryCount);
    });

    response.data.on('error', (err: Error) => {
      console.error('❌ SSE stream error:', err.message);
      rl.close();
    });

  } catch (err: any) {
    console.error('❌ SSE connection failed:', err.message);
    retryWithBackoff(retryCount);
  }
}

function retryWithBackoff(retryCount: number): void {
  const delay = Math.min(30000, 2000 * Math.pow(2, retryCount));
  console.log(`🔁 Retrying in ${delay / 1000}s...`);
  setTimeout(() => getBarentswatchData(retryCount + 1), delay);
}

async function start() {
  try {
    await getBarentswatchData();
  } catch (err: any) {
    console.error('❌ Startup failed:', err.message);
  }
}

getBarentswatchData();
