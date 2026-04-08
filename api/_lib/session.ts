import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export type VroovaSession = {
  sub: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  tier: 'FREE' | 'PRO';
  iat: number;
  exp: number;
};

export type VroovaUser = {
  id: string;
  email: string;
  fullName?: string | null;
  pictureUrl?: string | null;
  tier: 'FREE' | 'PRO';
};

const tokenTtlSeconds = 60 * 60 * 24 * 30;

function base64Url(input: string) {
  return Buffer.from(input).toString('base64url');
}

function sign(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function getSessionSecret() {
  const secret = process.env.VROOVA_JWT_SECRET ?? process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('VROOVA_JWT_SECRET must be set to at least 32 characters.');
  }
  return secret;
}

export function createSessionToken(user: Omit<VroovaSession, 'iat' | 'exp'>) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT', kid: 'vroova-session-v1' };
  const payload: VroovaSession & { jti: string } = {
    ...user,
    iat: now,
    exp: now + tokenTtlSeconds,
    jti: randomUUID(),
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  return `${unsignedToken}.${sign(unsignedToken, getSessionSecret())}`;
}

export function verifySessionToken(token: string): VroovaSession {
  const [encodedHeader, encodedPayload, signature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !signature) throw new Error('Malformed session token.');

  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const expected = sign(unsignedToken, getSessionSecret());
  const expectedBuffer = new Uint8Array(Buffer.from(expected));
  const actualBuffer = new Uint8Array(Buffer.from(signature));
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new Error('Invalid session token signature.');
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as VroovaSession;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Session token has expired.');
  }
  return payload;
}

export function sessionToUser(session: VroovaSession): VroovaUser {
  return {
    id: session.sub,
    email: session.email,
    fullName: session.name ?? null,
    pictureUrl: session.picture ?? null,
    tier: session.tier,
  };
}

export function getBearerSession(request: VercelRequest) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new Error('Missing bearer token.');
  return verifySessionToken(header.slice('Bearer '.length));
}

export function sendAuthError(response: VercelResponse) {
  response.status(401).json({ error: 'Unauthorized' });
}
