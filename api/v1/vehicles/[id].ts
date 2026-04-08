import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRequestUser } from '../../_lib/authUser.js';
import { sendError, sendMethodNotAllowed } from '../../_lib/http.js';
import { prisma } from '../../_lib/prisma.js';
import { serializeVehicle, vehicleInclude } from '../../_lib/vehicles.js';

function getId(request: VercelRequest) {
  return typeof request.query.id === 'string' ? request.query.id : '';
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const context = await getRequestUser(request, response);
  if (!context) return;

  const id = getId(request);
  if (!id) {
    sendError(response, 400, 'Vehicle id is required.');
    return;
  }

  if (request.method === 'GET') {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id, userId: context.user.id, isActive: true },
      include: vehicleInclude,
    });
    if (!vehicle) {
      sendError(response, 404, 'Vehicle not found.');
      return;
    }
    response.status(200).json(serializeVehicle(vehicle));
    return;
  }

  if (request.method === 'DELETE') {
    const vehicle = await prisma.vehicle.findFirst({ where: { id, userId: context.user.id } });
    if (!vehicle) {
      sendError(response, 404, 'Vehicle not found.');
      return;
    }
    await prisma.vehicle.update({ where: { id }, data: { isActive: false } });
    response.status(200).json({ success: true });
    return;
  }

  sendMethodNotAllowed(response, ['GET', 'DELETE']);
}
