import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRequestUser, userPayload } from '../_lib/authUser.js';
import { prisma } from '../_lib/prisma.js';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const context = await getRequestUser(request, response);
  if (!context) return;

  if (request.method === 'GET') {
    response.status(200).json(userPayload(context.user));
    return;
  }

  if (request.method === 'DELETE') {
    await prisma.user.delete({ where: { id: context.user.id } });
    response.status(200).json({ success: true });
    return;
  }

  response.setHeader('Allow', 'GET, DELETE');
  response.status(405).json({ error: 'Method not allowed' });
}
