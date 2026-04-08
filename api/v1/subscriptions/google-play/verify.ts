import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBearerSession, sendAuthError } from '../../../_lib/session.js';

export default function handler(request: VercelRequest, response: VercelResponse) {
  try {
    getBearerSession(request);

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      response.status(405).json({ error: 'Method not allowed' });
      return;
    }

    if (!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) {
      response.status(503).json({ error: 'Google Play verification is not configured yet.' });
      return;
    }

    response.status(202).json({
      tier: 'FREE',
      status: 'PENDING_VERIFICATION',
    });
  } catch {
    sendAuthError(response);
  }
}
