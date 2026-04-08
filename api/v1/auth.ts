import type { VercelRequest, VercelResponse } from '@vercel/node';

const requiredEnvironment = {
  googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID,
  googlePlayServiceAccountJson: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
};

export default function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }

  console.log('Vroova auth request received', {
    body: request.body,
    hasGoogleWebClientId: Boolean(requiredEnvironment.googleWebClientId),
    hasGooglePlayServiceAccountJson: Boolean(requiredEnvironment.googlePlayServiceAccountJson),
  });

  response.status(200).json({ success: true });
}
