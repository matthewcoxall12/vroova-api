import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRequestUser } from '../../../_lib/authUser.js';
import { lookupDvlaVehicle } from '../../../_lib/dvla.js';
import { sendError, sendMethodNotAllowed } from '../../../_lib/http.js';
import { prisma } from '../../../_lib/prisma.js';
import { serializeVehicle, vehicleInclude } from '../../../_lib/vehicles.js';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const context = await getRequestUser(request, response);
  if (!context) return;

  if (request.method !== 'POST') {
    sendMethodNotAllowed(response, ['POST']);
    return;
  }

  const id = typeof request.query.id === 'string' ? request.query.id : '';
  const existing = await prisma.vehicle.findFirst({ where: { id, userId: context.user.id, isActive: true } });
  if (!existing) {
    sendError(response, 404, 'Vehicle not found.');
    return;
  }

  try {
    const dvla = await lookupDvlaVehicle(existing.registration);
    const updated = await prisma.vehicle.update({
      where: { id },
      data: {
        make: dvla.make,
        colour: dvla.colour,
        fuelType: dvla.fuelType,
        yearOfManufacture: dvla.yearOfManufacture,
        engineCapacity: dvla.engineCapacity,
        co2Emissions: dvla.co2Emissions,
        taxStatus: dvla.taxStatus,
        taxDueDate: dvla.taxDueDate ? new Date(dvla.taxDueDate) : null,
        motStatus: dvla.motStatus,
        motExpiryDate: dvla.motExpiryDate ? new Date(dvla.motExpiryDate) : null,
        dvlaLastRefreshedAt: new Date(),
      },
      include: vehicleInclude,
    });
    response.status(200).json(serializeVehicle(updated));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DVLA refresh failed.';
    sendError(response, message.includes('not configured') ? 503 : 502, message);
  }
}
