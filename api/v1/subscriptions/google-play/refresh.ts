import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBearerSession, sendAuthError } from '../../../_lib/session.js';

export default function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const session = getBearerSession(request);

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      response.status(405).json({ error: 'Method not allowed' });
      return;
    }

    response.status(200).json({
      tier: session.tier,
      status: session.tier === 'PRO' ? 'ACTIVE' : 'FREE',
    });
  } catch {
    sendAuthError(response);
  }
}
