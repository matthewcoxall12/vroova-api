import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRequestUser } from '../../_lib/authUser.js';
import { getOptionalNumber, getOptionalString, parseDate, readJsonBody, sendError, sendMethodNotAllowed } from '../../_lib/http.js';
import { prisma } from '../../_lib/prisma.js';

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
  const dueDate = parseDate(body.dueDate);
  if (!title || !dueDate) {
    sendError(response, 400, 'title and dueDate are required.');
    return;
  }
  if (vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId: context.user.id, isActive: true } });
    if (!vehicle) {
      sendError(response, 404, 'Vehicle not found.');
      return;
    }
  }

  const reminder = await prisma.reminder.create({
    data: {
      userId: context.user.id,
      vehicleId,
      title,
      reminderType: getOptionalString(body, 'reminderType') ?? 'service',
      description: getOptionalString(body, 'description'),
      dueDate,
      remindDaysBefore: getOptionalNumber(body, 'remindDaysBefore') ?? 14,
    },
  });
  response.status(201).json(reminder);
}
