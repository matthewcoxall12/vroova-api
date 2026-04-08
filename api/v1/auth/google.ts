import type { VercelRequest, VercelResponse } from '@vercel/node';
import { OAuth2Client } from 'google-auth-library';
import { createSessionToken, sessionToUser } from '../../_lib/session.js';

function getBody(request: VercelRequest) {
  if (typeof request.body === 'string') return JSON.parse(request.body) as Record<string, unknown>;
  return (request.body ?? {}) as Record<string, unknown>;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const googleWebClientId = process.env.GOOGLE_WEB_CLIENT_ID;
  if (!googleWebClientId) {
    response.status(500).json({ error: 'Google sign-in is not configured.' });
    return;
  }

  try {
    const body = getBody(request);
    const idToken = typeof body.idToken === 'string' ? body.idToken : null;
    if (!idToken) {
      response.status(400).json({ error: 'Missing Google ID token.' });
      return;
    }

    const client = new OAuth2Client(googleWebClientId);
    const ticket = await client.verifyIdToken({
      idToken,
      audience: googleWebClientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      response.status(401).json({ error: 'Google account payload is incomplete.' });
      return;
    }

    const session = {
      sub: `google:${payload.sub}`,
      email: payload.email,
      name: payload.name ?? null,
      picture: payload.picture ?? null,
      tier: 'FREE' as const,
    };
    const token = createSessionToken(session);

    response.status(200).json({
      token,
      user: sessionToUser({
        ...session,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
      }),
    });
  } catch (error) {
    console.error('Google auth failed', {
      message: error instanceof Error ? error.message : 'Unknown auth error',
    });
    response.status(401).json({ error: 'Google sign-in failed.' });
  }
}
