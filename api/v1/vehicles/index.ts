import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Prisma } from '@prisma/client';
import { getRequestUser } from '../../_lib/authUser.js';
import { getOptionalNumber, getOptionalString, normaliseRegistration, parseDate, readJsonBody, sendError, sendMethodNotAllowed } from '../../_lib/http.js';
import { prisma } from '../../_lib/prisma.js';
import { serializeVehicle, vehicleInclude } from '../../_lib/vehicles.js';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const context = await getRequestUser(request, response);
  if (!context) return;

  try {
    if (request.method === 'GET') {
      const vehicles = await prisma.vehicle.findMany({
        where: { userId: context.user.id, isActive: true },
        orderBy: { createdAt: 'desc' },
        include: vehicleInclude,
      });
      response.status(200).json(serializeVehicle(vehicles));
      return;
    }

    if (request.method === 'POST') {
      const body = readJsonBody(request);
      const registration = normaliseRegistration(body.registration);
      const make = getOptionalString(body, 'make') ?? 'UNKNOWN';
      if (!registration) {
        sendError(response, 400, 'Registration is required.');
        return;
      }

      const existingVehicleCount = await prisma.vehicle.count({
        where: { userId: context.user.id, isActive: true },
      });
      const tier = context.user.profile?.tier ?? 'FREE';
      const vehicleLimit = tier === 'PRO' ? 5 : 1;
      if (existingVehicleCount >= vehicleLimit) {
        sendError(
          response,
          402,
          tier === 'PRO'
            ? 'Vroova Pro currently supports up to 5 vehicles. Fleet support is coming later.'
            : 'Free plan allows one vehicle. Upgrade to Pro to add more.',
          { requiresUpgrade: tier !== 'PRO' },
        );
        return;
      }

      const vehicle = await prisma.vehicle.create({
        data: {
          userId: context.user.id,
          registration,
          make,
          model: getOptionalString(body, 'model'),
          colour: getOptionalString(body, 'colour'),
          yearOfManufacture: getOptionalNumber(body, 'yearOfManufacture'),
          fuelType: getOptionalString(body, 'fuelType'),
          engineCapacity: getOptionalNumber(body, 'engineCapacity'),
          co2Emissions: getOptionalNumber(body, 'co2Emissions'),
          motStatus: getOptionalString(body, 'motStatus'),
          motExpiryDate: parseDate(body.motExpiryDate),
          taxStatus: getOptionalString(body, 'taxStatus'),
          taxDueDate: parseDate(body.taxDueDate),
          currentMileage: getOptionalNumber(body, 'currentMileage'),
        },
        include: vehicleInclude,
      });
      response.status(201).json(serializeVehicle(vehicle));
      return;
    }

    sendMethodNotAllowed(response, ['GET', 'POST']);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      sendError(response, 409, 'This vehicle is already in your garage.');
      return;
    }
    console.error('Vehicles route failed', { message: error instanceof Error ? error.message : 'Unknown error' });
    sendError(response, 500, 'Vehicle request failed.');
  }
}
