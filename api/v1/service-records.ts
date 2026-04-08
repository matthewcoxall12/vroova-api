import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRequestUser } from '../_lib/authUser.js';
import { getOptionalNumber, getOptionalString, parseDate, readJsonBody, sendError, sendMethodNotAllowed } from '../_lib/http.js';
import { prisma } from '../_lib/prisma.js';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const context = await getRequestUser(request, response);
  if (!context) return;
  if (request.method !== 'POST') {
    sendMethodNotAllowed(response, ['POST']);
    return;
  }

  const body = readJsonBody(request);
  const vehicleId = getOptionalString(body, 'vehicleId');
  const title = getOptionalString(body, 'title') ?? getOptionalString(body, 'provider') ?? 'Service record';
  if (!vehicleId || !title) {
    sendError(response, 400, 'vehicleId and title are required.');
    return;
  }
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId: context.user.id, isActive: true } });
  if (!vehicle) {
    sendError(response, 404, 'Vehicle not found.');
    return;
  }

  const record = await prisma.serviceRecord.create({
    data: {
      vehicleId,
      userId: context.user.id,
      title,
      description: getOptionalString(body, 'description'),
      provider: getOptionalString(body, 'provider'),
      recordDate: parseDate(body.recordDate) ?? new Date(),
      mileage: getOptionalNumber(body, 'mileage'),
      cost: getOptionalNumber(body, 'cost'),
      recordType: getOptionalString(body, 'recordType') ?? 'service',
    },
  });
  response.status(201).json(record);
}
