import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBearerSession, sendAuthError, sessionToUser } from '../_lib/session.js';

export default function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const session = getBearerSession(request);

    if (request.method === 'GET') {
      response.status(200).json(sessionToUser(session));
      return;
    }

    if (request.method === 'DELETE') {
      response.status(200).json({ success: true });
      return;
    }

    response.setHeader('Allow', 'GET, DELETE');
    response.status(405).json({ error: 'Method not allowed' });
  } catch {
    sendAuthError(response);
  }
}
