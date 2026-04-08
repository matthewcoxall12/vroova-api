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
  const mileage = getOptionalNumber(body, 'mileage');
  if (!vehicleId || !mileage) {
    sendError(response, 400, 'vehicleId and mileage are required.');
    return;
  }
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId: context.user.id, isActive: true } });
  if (!vehicle) {
    sendError(response, 404, 'Vehicle not found.');
    return;
  }

  const log = await prisma.mileageLog.create({
    data: {
      vehicleId,
      userId: context.user.id,
      mileage,
      recordedAt: parseDate(body.recordedAt) ?? new Date(),
      notes: getOptionalString(body, 'notes'),
    },
  });
  await prisma.vehicle.update({ where: { id: vehicleId }, data: { currentMileage: mileage } });
  response.status(201).json(log);
}
