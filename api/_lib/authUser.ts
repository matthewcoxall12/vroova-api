import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBearerSession, sendAuthError, sessionToUser, type VroovaSession } from './session.js';
import { prisma } from './prisma.js';

export async function getRequestUser(request: VercelRequest, response: VercelResponse) {
  try {
    const session = getBearerSession(request);
    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      include: { profile: true },
    });

    if (!user) {
      return {
        session,
        user: await ensureUserFromSession(session),
      };
    }

    return { session, user };
  } catch {
    sendAuthError(response);
    return null;
  }
}

export async function ensureUserFromSession(session: VroovaSession) {
  const user = await prisma.user.upsert({
    where: { id: session.sub },
    update: {
      email: session.email,
      fullName: session.name ?? null,
      pictureUrl: session.picture ?? null,
    },
    create: {
      id: session.sub,
      email: session.email,
      googleSubject: session.sub.startsWith('google:') ? session.sub.slice('google:'.length) : null,
      fullName: session.name ?? null,
      pictureUrl: session.picture ?? null,
      profile: {
        create: { tier: session.tier },
      },
    },
    include: { profile: true },
  });

  if (!user.profile) {
    return prisma.user.update({
      where: { id: user.id },
      data: { profile: { create: { tier: session.tier } } },
      include: { profile: true },
    });
  }

  return user;
}

export function userPayload(user: Awaited<ReturnType<typeof ensureUserFromSession>>) {
  return {
    ...sessionToUser({
      sub: user.id,
      email: user.email,
      name: user.fullName,
      picture: user.pictureUrl,
      tier: user.profile?.tier ?? 'FREE',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
    }),
  };
}
