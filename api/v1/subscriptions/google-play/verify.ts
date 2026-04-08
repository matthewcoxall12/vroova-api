import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGooglePlayPackageName, getGooglePlaySubscriptionProductId, verifyGooglePlaySubscription } from '../../../_lib/googlePlay.js';
import { getRequestUser } from '../../../_lib/authUser.js';
import { prisma } from '../../../_lib/prisma.js';
import { createSessionToken, sessionToUser } from '../../../_lib/session.js';

function getBody(request: VercelRequest) {
  if (typeof request.body === 'string') return JSON.parse(request.body) as Record<string, unknown>;
  return (request.body ?? {}) as Record<string, unknown>;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const context = await getRequestUser(request, response);
  if (!context) return;

  try {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      response.status(405).json({ error: 'Method not allowed' });
      return;
    }

    if (!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) {
      response.status(503).json({ error: 'Google Play verification is not configured yet.' });
      return;
    }

    const body = getBody(request);
    const packageName = typeof body.packageName === 'string' ? body.packageName : null;
    const productId = typeof body.productId === 'string' ? body.productId : null;
    const purchaseToken = typeof body.purchaseToken === 'string' ? body.purchaseToken : null;

    if (!packageName || !productId || !purchaseToken) {
      response.status(400).json({ error: 'packageName, productId and purchaseToken are required.' });
      return;
    }

    if (packageName !== getGooglePlayPackageName() || productId !== getGooglePlaySubscriptionProductId()) {
      response.status(400).json({ error: 'Purchase does not match Vroova Android subscription configuration.' });
      return;
    }

    const entitlement = await verifyGooglePlaySubscription({ packageName, productId, purchaseToken });
    await prisma.subscriptionEntitlement.upsert({
      where: { purchaseTokenHash: entitlement.purchaseTokenHash },
      update: {
        userId: context.user.id,
        tier: entitlement.tier,
        status: entitlement.status,
        productId: entitlement.productId,
        packageName,
        expiryTime: entitlement.expiresAt ? new Date(entitlement.expiresAt) : null,
        autoRenewing: entitlement.autoRenewing,
        rawProviderPayload: entitlement.raw,
        lastVerifiedAt: new Date(),
      },
      create: {
        userId: context.user.id,
        tier: entitlement.tier,
        status: entitlement.status,
        productId: entitlement.productId,
        purchaseTokenHash: entitlement.purchaseTokenHash,
        packageName,
        expiryTime: entitlement.expiresAt ? new Date(entitlement.expiresAt) : null,
        autoRenewing: entitlement.autoRenewing,
        rawProviderPayload: entitlement.raw,
        lastVerifiedAt: new Date(),
      },
    });
    await prisma.profile.upsert({
      where: { userId: context.user.id },
      update: { tier: entitlement.tier },
      create: { userId: context.user.id, tier: entitlement.tier },
    });

    const nextSession = {
      sub: context.user.id,
      email: context.user.email,
      name: context.user.fullName ?? null,
      picture: context.user.pictureUrl ?? null,
      tier: entitlement.tier,
      subscriptionProductId: entitlement.productId,
      subscriptionStatus: entitlement.status,
      subscriptionExpiresAt: entitlement.expiresAt,
    };
    const token = createSessionToken(nextSession);

    response.status(200).json({
      success: entitlement.active,
      tier: entitlement.tier,
      status: entitlement.status,
      productId: entitlement.productId,
      expiresAt: entitlement.expiresAt,
      autoRenewing: entitlement.autoRenewing,
      needsAcknowledgement: entitlement.needsAcknowledgement,
      isTestPurchase: entitlement.isTestPurchase,
      purchaseTokenHash: entitlement.purchaseTokenHash,
      token,
      user: sessionToUser({
        ...nextSession,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
      }),
    });
  } catch (error) {
    console.error('Google Play verification failed', {
      message: error instanceof Error ? error.message : 'Unknown Google Play verification error',
    });
    response.status(502).json({ error: 'Google Play subscription verification failed.' });
  }
}
