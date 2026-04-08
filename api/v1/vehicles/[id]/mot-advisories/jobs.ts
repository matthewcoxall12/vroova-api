import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRequestUser } from '../../../../_lib/authUser.js';
import { readJsonBody, sendError, sendMethodNotAllowed } from '../../../../_lib/http.js';
import { prisma } from '../../../../_lib/prisma.js';
import { categorizeAdvisory, priorityFromAdvisoryType } from '../../../../_lib/vehicles.js';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const context = await getRequestUser(request, response);
  if (!context) return;

  if (request.method !== 'POST') {
    sendMethodNotAllowed(response, ['POST']);
    return;
  }
  if (context.user.profile?.tier !== 'PRO') {
    sendError(response, 403, 'Converting MOT advisories to jobs requires Pro.', { requiresUpgrade: true });
    return;
  }

  const vehicleId = typeof request.query.id === 'string' ? request.query.id : '';
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId: context.user.id, isActive: true } });
  if (!vehicle) {
    sendError(response, 404, 'Vehicle not found.');
    return;
  }

  const raw = readJsonBody(request);
  const advisories = Array.isArray(raw) ? raw : [];
  const existing = await prisma.job.findMany({
    where: { userId: context.user.id, vehicleId, source: 'mot_advisory' },
    select: { motAdvisoryText: true },
  });
  const existingText = new Set(existing.map(job => job.motAdvisoryText).filter(Boolean));
  const data = advisories
    .map(item => ({
      text: typeof item?.text === 'string' ? item.text : '',
      type: typeof item?.type === 'string' ? item.type : 'ADVISORY',
    }))
    .filter(item => item.text && !existingText.has(item.text))
    .map(item => ({
      userId: context.user.id,
      vehicleId,
      title: item.text.length > 80 ? `${item.text.slice(0, 77)}...` : item.text,
      description: `MOT advisory: ${item.text}`,
      category: categorizeAdvisory(item.text),
      priority: priorityFromAdvisoryType(item.type) as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
      source: 'mot_advisory',
      motAdvisoryText: item.text,
    }));

  if (data.length) await prisma.job.createMany({ data });
  response.status(200).json({ created: data.length });
}
