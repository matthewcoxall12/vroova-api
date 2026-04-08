import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRequestUser } from '../../_lib/authUser.js';
import { lookupDvlaVehicle } from '../../_lib/dvla.js';
import { readJsonBody, sendError, sendMethodNotAllowed } from '../../_lib/http.js';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const context = await getRequestUser(request, response);
  if (!context) return;

  if (request.method !== 'POST') {
    sendMethodNotAllowed(response, ['POST']);
    return;
  }

  try {
    const body = readJsonBody(request);
    const registration = typeof body.registration === 'string' ? body.registration : '';
    const vehicle = await lookupDvlaVehicle(registration);
    response.status(200).json({ vehicle });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not lookup vehicle.';
    sendError(response, message.includes('not configured') ? 503 : 400, message);
  }
}
