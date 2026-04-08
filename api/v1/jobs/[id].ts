import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRequestUser } from '../../_lib/authUser.js';
import { getOptionalNumber, getOptionalString, parseDate, readJsonBody, sendError, sendMethodNotAllowed } from '../../_lib/http.js';
import { prisma } from '../../_lib/prisma.js';

function validStatus(value: unknown) {
  return ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DEFERRED'].includes(String(value))
    ? (String(value) as 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'DEFERRED')
    : null;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const context = await getRequestUser(request, response);
  if (!context) return;

  const id = typeof request.query.id === 'string' ? request.query.id : '';
  const job = await prisma.job.findFirst({ where: { id, userId: context.user.id } });
  if (!job) {
    sendError(response, 404, 'Job not found.');
    return;
  }

  if (request.method === 'PATCH') {
    const body = readJsonBody(request);
    const status = validStatus(body.status);
    const updated = await prisma.job.update({
      where: { id },
      data: {
        title: getOptionalString(body, 'title') ?? undefined,
        description: getOptionalString(body, 'description') ?? undefined,
        category: getOptionalString(body, 'category') ?? undefined,
        dueDate: body.dueDate === undefined ? undefined : parseDate(body.dueDate),
        estimatedCost: body.estimatedCost === undefined ? undefined : getOptionalNumber(body, 'estimatedCost'),
        status: status ?? undefined,
        completedAt: status === 'COMPLETED' ? new Date() : undefined,
      },
    });
    response.status(200).json(updated);
    return;
  }

  if (request.method === 'DELETE') {
    await prisma.job.delete({ where: { id } });
    response.status(200).json({ success: true });
    return;
  }

  sendMethodNotAllowed(response, ['PATCH', 'DELETE']);
}
