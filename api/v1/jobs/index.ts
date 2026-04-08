import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRequestUser } from '../../_lib/authUser.js';
import { getOptionalNumber, getOptionalString, parseDate, readJsonBody, sendError, sendMethodNotAllowed } from '../../_lib/http.js';
import { prisma } from '../../_lib/prisma.js';

function validPriority(value: unknown) {
  return ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(String(value)) ? (String(value) as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT') : 'MEDIUM';
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const context = await getRequestUser(request, response);
  if (!context) return;

  if (request.method !== 'POST') {
    sendMethodNotAllowed(response, ['POST']);
    return;
  }

  const body = readJsonBody(request);
  const vehicleId = getOptionalString(body, 'vehicleId');
  const title = getOptionalString(body, 'title');
  if (!vehicleId || !title) {
    sendError(response, 400, 'vehicleId and title are required.');
    return;
  }

  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId: context.user.id, isActive: true } });
  if (!vehicle) {
    sendError(response, 404, 'Vehicle not found.');
    return;
  }

  const job = await prisma.job.create({
    data: {
      userId: context.user.id,
      vehicleId,
      title,
      description: getOptionalString(body, 'description'),
      category: getOptionalString(body, 'category') ?? 'service',
      priority: validPriority(body.priority),
      dueDate: parseDate(body.dueDate),
      estimatedCost: getOptionalNumber(body, 'estimatedCost'),
    },
  });
  response.status(201).json(job);
}
