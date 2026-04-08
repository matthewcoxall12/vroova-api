import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRequestUser } from '../../../_lib/authUser.js';
import { fetchMotHistory } from '../../../_lib/dvsa.js';
import { sendError, sendMethodNotAllowed } from '../../../_lib/http.js';
import { prisma } from '../../../_lib/prisma.js';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const context = await getRequestUser(request, response);
  if (!context) return;

  if (request.method !== 'GET') {
    sendMethodNotAllowed(response, ['GET']);
    return;
  }

  const id = typeof request.query.id === 'string' ? request.query.id : '';
  const vehicle = await prisma.vehicle.findFirst({ where: { id, userId: context.user.id, isActive: true } });
  if (!vehicle) {
    sendError(response, 404, 'Vehicle not found.');
    return;
  }

  try {
    response.status(200).json(await fetchMotHistory(vehicle.registration));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MOT history request failed.';
    sendError(response, message.includes('not configured') ? 503 : 502, message);
  }
}
