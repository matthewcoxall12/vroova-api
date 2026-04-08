import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRequestUser } from '../_lib/authUser.js';
import { getOptionalString, parseDate, readJsonBody, sendError, sendMethodNotAllowed } from '../_lib/http.js';
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
  const provider = getOptionalString(body, 'provider');
  const renewalDate = parseDate(body.renewalDate);
  if (!vehicleId || !provider || !renewalDate) {
    sendError(response, 400, 'vehicleId, provider and renewalDate are required.');
    return;
  }
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId: context.user.id, isActive: true } });
  if (!vehicle) {
    sendError(response, 404, 'Vehicle not found.');
    return;
  }

  const policy = await prisma.insurancePolicy.create({
    data: {
      vehicleId,
      userId: context.user.id,
      provider,
      renewalDate,
      policyNumber: getOptionalString(body, 'policyNumber'),
      notes: getOptionalString(body, 'notes'),
    },
  });
  response.status(201).json(policy);
}
