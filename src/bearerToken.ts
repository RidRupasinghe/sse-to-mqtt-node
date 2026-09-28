import axios from 'axios';
import qs from 'qs';
import dotenv from 'dotenv';

dotenv.config();

export async function getBearerToken(): Promise<string> {
  try {
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
  } catch (error) {
    console.error('❌ Failed to retrieve bearer token:', error);
    throw error;
  }
}
