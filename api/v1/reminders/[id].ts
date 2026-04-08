import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRequestUser } from '../../_lib/authUser.js';
import { parseDate, readJsonBody, sendError, sendMethodNotAllowed } from '../../_lib/http.js';
import { prisma } from '../../_lib/prisma.js';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const context = await getRequestUser(request, response);
  if (!context) return;

  const id = typeof request.query.id === 'string' ? request.query.id : '';
  const reminder = await prisma.reminder.findFirst({ where: { id, userId: context.user.id } });
  if (!reminder) {
    sendError(response, 404, 'Reminder not found.');
    return;
  }

  if (request.method === 'PATCH') {
    const body = readJsonBody(request);
    const isCompleted = typeof body.isCompleted === 'boolean' ? body.isCompleted : undefined;
    const updated = await prisma.reminder.update({
      where: { id },
      data: {
        isCompleted,
        completedAt: isCompleted ? new Date() : undefined,
        dueDate: body.dueDate === undefined ? undefined : parseDate(body.dueDate) ?? reminder.dueDate,
      },
    });
    response.status(200).json(updated);
    return;
  }

  if (request.method === 'DELETE') {
    await prisma.reminder.delete({ where: { id } });
    response.status(200).json({ success: true });
    return;
  }

  sendMethodNotAllowed(response, ['PATCH', 'DELETE']);
}
