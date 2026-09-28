import axios from 'axios';
import qs from 'qs';
import {OAuth2ClientCredentials} from './types';

export async function getAccessToken(auth: OAuth2ClientCredentials): Promise<string> {
    const formData = qs.stringify({
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
        grant_type: 'client_credentials',
        ...(auth.scope ? {scope: auth.scope} : {}),
    });

    const response = await axios.post(auth.tokenUrl, formData, {
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    });

    const token = response.data?.access_token || response.data?.token;
    if (!token) {
        throw new Error('OAuth token response did not include access_token');
    }

    return token;
}
