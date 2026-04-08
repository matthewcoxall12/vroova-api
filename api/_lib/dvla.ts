import { normaliseRegistration } from './http.js';

export type DvlaVehicle = {
  registration: string;
  registrationNumber: string;
  make: string;
  colour?: string;
  fuelType?: string;
  yearOfManufacture?: number;
  taxStatus?: string;
  taxDueDate?: string;
  motStatus?: string;
  motExpiryDate?: string;
  engineCapacity?: number;
  co2Emissions?: number;
};

export async function lookupDvlaVehicle(registration: string): Promise<DvlaVehicle> {
  const apiKey = process.env.DVLA_API_KEY;
  if (!apiKey) throw new Error('DVLA_API_KEY is not configured.');

  const registrationNumber = normaliseRegistration(registration);
  if (!registrationNumber) throw new Error('Registration is required.');

  const response = await fetch('https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ registrationNumber }),
  });

  if (response.status === 404) throw new Error('Vehicle not found.');
  if (!response.ok) throw new Error(`DVLA lookup failed with status ${response.status}.`);

  const vehicle = (await response.json()) as Omit<DvlaVehicle, 'registration'>;
  return {
    ...vehicle,
    registration: registrationNumber,
    registrationNumber,
  };
}
