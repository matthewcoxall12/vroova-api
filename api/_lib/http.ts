import type { VercelRequest, VercelResponse } from '@vercel/node';

export function readJsonBody(request: VercelRequest) {
  if (typeof request.body === 'string') {
    return request.body ? (JSON.parse(request.body) as Record<string, unknown>) : {};
  }
  return (request.body ?? {}) as Record<string, unknown>;
}

export function getString(body: Record<string, unknown>, key: string, fallback = '') {
  const value = body[key];
  return typeof value === 'string' ? value.trim() : fallback;
}

export function getOptionalString(body: Record<string, unknown>, key: string) {
  const value = getString(body, key);
  return value || null;
}

export function getOptionalNumber(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function parseDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normaliseRegistration(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.toUpperCase().replace(/\s+/g, '');
}

export function sendMethodNotAllowed(response: VercelResponse, methods: string[]) {
  response.setHeader('Allow', methods.join(', '));
  response.status(405).json({ error: 'Method not allowed' });
}

export function sendError(response: VercelResponse, status: number, message: string, extra?: Record<string, unknown>) {
  response.status(status).json({ error: message, ...(extra ?? {}) });
}
