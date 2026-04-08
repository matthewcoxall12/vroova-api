import type { VercelRequest, VercelResponse } from '@vercel/node';

type DvlaVehicle = {
  registrationNumber?: string;
  make?: string;
  colour?: string;
  fuelType?: string;
  motStatus?: string;
  motExpiryDate?: string;
  taxStatus?: string;
  taxDueDate?: string;
  yearOfManufacture?: number;
  engineCapacity?: number;
  co2Emissions?: number;
};

function getBody(request: VercelRequest) {
  if (typeof request.body === 'string') return JSON.parse(request.body) as Record<string, unknown>;
  return (request.body ?? {}) as Record<string, unknown>;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const dvlaApiKey = process.env.DVLA_API_KEY;
  if (!dvlaApiKey) {
    response.status(503).json({ error: 'DVLA lookup is not configured yet.' });
    return;
  }

  try {
    const body = getBody(request);
    const registration = typeof body.registration === 'string' ? body.registration.trim().toUpperCase().replace(/\s+/g, '') : '';
    if (!registration) {
      response.status(400).json({ error: 'Registration is required.' });
      return;
    }

    const dvlaResponse = await fetch('https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': dvlaApiKey,
      },
      body: JSON.stringify({ registrationNumber: registration }),
    });
    const vehicle = (await dvlaResponse.json().catch(() => ({}))) as DvlaVehicle & { message?: string };

    if (!dvlaResponse.ok) {
      response.status(dvlaResponse.status).json({ error: vehicle.message ?? 'Vehicle lookup failed.' });
      return;
    }

    response.status(200).json({
      vehicle: {
        registration,
        registrationNumber: vehicle.registrationNumber ?? registration,
        make: vehicle.make ?? null,
        colour: vehicle.colour ?? null,
        fuelType: vehicle.fuelType ?? null,
        motStatus: vehicle.motStatus ?? null,
        motExpiryDate: vehicle.motExpiryDate ?? null,
        taxStatus: vehicle.taxStatus ?? null,
        taxDueDate: vehicle.taxDueDate ?? null,
        yearOfManufacture: vehicle.yearOfManufacture ?? null,
        engineCapacity: vehicle.engineCapacity ?? null,
        co2Emissions: vehicle.co2Emissions ?? null,
      },
    });
  } catch (error) {
    console.error('Public vehicle check failed', {
      message: error instanceof Error ? error.message : 'Unknown vehicle lookup error',
    });
    response.status(502).json({ error: 'Vehicle lookup failed.' });
  }
}
