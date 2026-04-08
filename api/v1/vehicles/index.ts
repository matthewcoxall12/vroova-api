import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBearerSession, sendAuthError } from '../../_lib/session.js';

export default function handler(request: VercelRequest, response: VercelResponse) {
  try {
    getBearerSession(request);

    if (request.method === 'GET') {
      response.status(200).json([]);
      return;
    }

    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Method not allowed' });
  } catch {
    sendAuthError(response);
  }
}
