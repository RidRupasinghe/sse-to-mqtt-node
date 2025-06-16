require('dotenv').config();

const readline = require('readline');
const qs = require('qs');
const axios = require('axios');
const EventSource = require('eventsource');
const mqtt = require('mqtt');

const {
  AUTHENTICATION_URL,
  CLIENT_ID,
  CLIENT_SECRET,
  CLIENT_SCOPE,
  STREAMING_ENDPOINT
} = process.env;

async function getBearerToken() {
  try {
    const formData = qs.stringify({
      "client_id": CLIENT_ID,
      "scope": CLIENT_SCOPE,
      "client_secret": CLIENT_SECRET,
      "grant_type": "client_credentials"
    });


    const response = await axios.post(AUTHENTICATION_URL, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-custom-header': 'your-header-value'
      }
    });

    console.log('✅ Bearer token retrieved ');
    return response.data.access_token || response.data.token;
  } catch (err) {
    console.error('❌ Failed to fetch token:', err.message);
    throw err;
  }
}

async function getBarentswatchData() {
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

  try {
    const response = await axios.post(STREAMING_ENDPOINT, postData, {
      headers,
      responseType: 'stream'
    });

    console.log('📡 Connected to SSE (POST)');

    const rl = readline.createInterface({
      input: response.data,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      if (line.startsWith('data:')) {
        const eventData = line.replace(/^data:\s*/, '');
        console.log('📥 SSE Event:', eventData);
      }
    });

    rl.on('close', () => {
      console.log('🔌 SSE stream closed');
      getBarentswatchData();
    });

  } catch (err) {
    console.error('❌ SSE POST stream failed:', err.response?.data || err.message);
  }

}

async function start() {
  try {
    getBarentswatchData();
  } catch (err) {
    console.error('❌ Startup failed:', err.message);
  }
}

start();
