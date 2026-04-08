import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createSessionToken, getBearerSession, sendAuthError, sessionToUser } from '../../../_lib/session.js';

export default function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const session = getBearerSession(request);

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      response.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const expiresAt = session.subscriptionExpiresAt ?? null;
    const isExpired = expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false;
    const tier: 'FREE' | 'PRO' = session.tier === 'PRO' && !isExpired ? 'PRO' : 'FREE';
    const status = tier === 'PRO' ? session.subscriptionStatus ?? 'ACTIVE' : isExpired ? 'EXPIRED' : 'FREE';
    const nextSession = {
      sub: session.sub,
      email: session.email,
      name: session.name ?? null,
      picture: session.picture ?? null,
      tier,
      subscriptionProductId: tier === 'PRO' ? session.subscriptionProductId ?? null : null,
      subscriptionStatus: status,
      subscriptionExpiresAt: tier === 'PRO' ? expiresAt : null,
    };

    response.status(200).json({
      success: tier === 'PRO',
      tier,
      status,
      productId: nextSession.subscriptionProductId,
      expiresAt: nextSession.subscriptionExpiresAt,
      token: createSessionToken(nextSession),
      user: sessionToUser({
        ...nextSession,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
      }),
    });
  } catch {
    sendAuthError(response);
  }
}
