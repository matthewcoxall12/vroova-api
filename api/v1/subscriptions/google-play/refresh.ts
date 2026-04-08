import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRequestUser, userPayload } from '../../../_lib/authUser.js';
import { prisma } from '../../../_lib/prisma.js';
import { createSessionToken } from '../../../_lib/session.js';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const context = await getRequestUser(request, response);
  if (!context) return;

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const entitlement = await prisma.subscriptionEntitlement.findFirst({
    where: { userId: context.user.id },
    orderBy: { updatedAt: 'desc' },
  });
  const expiresAt = entitlement?.expiryTime?.toISOString() ?? null;
  const isActive = entitlement?.status === 'ACTIVE' && (!entitlement.expiryTime || entitlement.expiryTime.getTime() > Date.now());
  const tier: 'FREE' | 'PRO' = isActive ? 'PRO' : 'FREE';
  if ((context.user.profile?.tier ?? 'FREE') !== tier) {
    await prisma.profile.upsert({
      where: { userId: context.user.id },
      update: { tier },
      create: { userId: context.user.id, tier },
    });
  }

  const nextSession = {
    sub: context.user.id,
    email: context.user.email,
    name: context.user.fullName ?? null,
    picture: context.user.pictureUrl ?? null,
    tier,
    subscriptionProductId: isActive ? entitlement?.productId ?? null : null,
    subscriptionStatus: entitlement?.status ?? (tier === 'PRO' ? 'ACTIVE' : 'FREE'),
    subscriptionExpiresAt: isActive ? expiresAt : null,
  };

  const refreshedUser = {
    ...userPayload(context.user),
    tier,
    subscriptionProductId: nextSession.subscriptionProductId,
    subscriptionStatus: nextSession.subscriptionStatus,
    subscriptionExpiresAt: nextSession.subscriptionExpiresAt,
  };

  response.status(200).json({
    success: tier === 'PRO',
    tier,
    status: nextSession.subscriptionStatus,
    productId: nextSession.subscriptionProductId,
    expiresAt: nextSession.subscriptionExpiresAt,
    token: createSessionToken(nextSession),
    user: refreshedUser,
  });
}
