import type { Prisma } from '@prisma/client';

export const vehicleInclude = {
  jobs: { orderBy: { createdAt: 'desc' } },
  reminders: { orderBy: { dueDate: 'asc' } },
  mileageLogs: { orderBy: { recordedAt: 'desc' }, take: 20 },
  insurancePolicies: { orderBy: { renewalDate: 'asc' } },
  serviceRecords: { orderBy: { recordDate: 'desc' }, take: 20 },
  documents: { orderBy: { createdAt: 'desc' }, take: 20 },
} satisfies Prisma.VehicleInclude;

export function serializeVehicle<T>(vehicle: T) {
  return JSON.parse(JSON.stringify(vehicle, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))) as T;
}

export function categorizeAdvisory(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes('brake')) return 'brakes';
  if (lower.includes('tyre') || lower.includes('tire')) return 'tyres';
  if (lower.includes('suspension') || lower.includes('spring') || lower.includes('shock')) return 'suspension';
  if (lower.includes('exhaust') || lower.includes('emission')) return 'exhaust';
  if (lower.includes('light') || lower.includes('lamp')) return 'lights';
  if (lower.includes('engine') || lower.includes('oil')) return 'engine';
  if (lower.includes('corrosion') || lower.includes('rust') || lower.includes('body')) return 'bodywork';
  if (lower.includes('wiper')) return 'wipers';
  return 'other';
}

export function priorityFromAdvisoryType(type: string) {
  const upper = type.toUpperCase();
  if (upper === 'DANGEROUS') return 'URGENT';
  if (upper === 'MAJOR' || upper === 'FAIL') return 'HIGH';
  if (upper === 'MINOR' || upper === 'PRS') return 'MEDIUM';
  return 'LOW';
}
