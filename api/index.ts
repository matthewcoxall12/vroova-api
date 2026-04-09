import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { OAuth2Client } from 'google-auth-library';
import { Prisma } from '@prisma/client';
import { getRequestUser, userPayload } from './_lib/authUser.js';
import { lookupDvlaVehicle } from './_lib/dvla.js';
import { fetchMotHistory } from './_lib/dvsa.js';
import { getGooglePlayPackageName, getGooglePlaySubscriptionProductId, verifyGooglePlaySubscription } from './_lib/googlePlay.js';
import {
  getOptionalNumber,
  getOptionalString,
  normaliseRegistration,
  parseDate,
  readJsonBody,
  sendError,
  sendMethodNotAllowed,
} from './_lib/http.js';
import { prisma } from './_lib/prisma.js';
import { createSessionToken, sessionToUser } from './_lib/session.js';
import { categorizeAdvisory, priorityFromAdvisoryType, serializeVehicle, vehicleInclude } from './_lib/vehicles.js';

function segments(request: VercelRequest) {
  const value = request.query.path;
  const raw = Array.isArray(value) ? value.join('/') : typeof value === 'string' ? value : '';
  return raw.split('/').filter(Boolean).filter(part => part !== 'v1');
}

function routeKey(parts: string[]) {
  return `/${parts.join('/')}`;
}

function validPriority(value: unknown) {
  return ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(String(value)) ? (String(value) as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT') : 'MEDIUM';
}

function validStatus(value: unknown) {
  return ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DEFERRED'].includes(String(value))
    ? (String(value) as 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'DEFERRED')
    : null;
}

function normaliseEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hashPassword(password: string, salt = randomBytes(16).toString('base64url')) {
  const hash = pbkdf2Sync(password, salt, 210_000, 32, 'sha256').toString('base64url');
  return { salt, hash };
}

function passwordMatches(password: string, salt: string, expectedHash: string) {
  const { hash } = hashPassword(password, salt);
  const actual = new Uint8Array(Buffer.from(hash));
  const expected = new Uint8Array(Buffer.from(expectedHash));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function authResponseForUser(user: { id: string; email: string; fullName: string | null; pictureUrl: string | null; profile: { tier: 'FREE' | 'PRO' } | null }) {
  const session = {
    sub: user.id,
    email: user.email,
    name: user.fullName ?? null,
    picture: user.pictureUrl ?? null,
    tier: user.profile?.tier ?? ('FREE' as const),
  };

  return {
    token: createSessionToken(session),
    user: sessionToUser({ ...session, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }),
  };
}

async function buildVehicleLookupSnapshot(registration: string) {
  const dvla = await lookupDvlaVehicle(registration);

  try {
    const dvsa = await fetchMotHistory(registration);
    const motHistory = Array.isArray(dvsa.motHistory) ? dvsa.motHistory : Array.isArray(dvsa.motTests) ? dvsa.motTests : [];
    const advisories = Array.isArray(dvsa.advisories) ? dvsa.advisories : [];
    const latestTest = motHistory[0];

    return {
      ...dvla,
      motHistory,
      motHistoryCount: motHistory.length,
      advisoryCount: advisories.length,
      recentAdvisories: advisories.slice(0, 5),
      lastTestResult: latestTest?.testResult ?? null,
      lastTestDate: latestTest?.completedDate ?? null,
      lastMileage: latestTest?.odometerValue ?? null,
      lastMileageUnit: latestTest?.odometerUnit ?? null,
      dvsaAvailable: true,
      motHistoryUnavailableReason: null,
    };
  } catch (error) {
    return {
      ...dvla,
      motHistory: [],
      motHistoryCount: 0,
      advisoryCount: 0,
      recentAdvisories: [],
      lastTestResult: null,
      lastTestDate: null,
      lastMileage: null,
      lastMileageUnit: null,
      dvsaAvailable: false,
      motHistoryUnavailableReason: error instanceof Error ? error.message : 'MOT history unavailable.',
    };
  }
}

function vehicleSnapshotUpdateData(snapshot: Awaited<ReturnType<typeof buildVehicleLookupSnapshot>>) {
  return {
    make: getOptionalString(snapshot, 'make') ?? undefined,
    model: getOptionalString(snapshot, 'model'),
    colour: getOptionalString(snapshot, 'colour'),
    fuelType: getOptionalString(snapshot, 'fuelType'),
    yearOfManufacture: getOptionalNumber(snapshot, 'yearOfManufacture'),
    engineCapacity: getOptionalNumber(snapshot, 'engineCapacity'),
    co2Emissions: getOptionalNumber(snapshot, 'co2Emissions'),
    taxStatus: getOptionalString(snapshot, 'taxStatus'),
    taxDueDate: parseDate(snapshot.taxDueDate),
    motStatus: getOptionalString(snapshot, 'motStatus'),
    motExpiryDate: parseDate(snapshot.motExpiryDate),
    currentMileage: getOptionalNumber(snapshot, 'lastMileage'),
    motHistoryCache: Array.isArray(snapshot.motHistory) ? (snapshot.motHistory as Prisma.JsonArray) : Prisma.JsonNull,
    motHistoryCount: getOptionalNumber(snapshot, 'motHistoryCount'),
    advisoryCount: getOptionalNumber(snapshot, 'advisoryCount'),
    recentAdvisories: Array.isArray(snapshot.recentAdvisories) ? (snapshot.recentAdvisories as Prisma.JsonArray) : Prisma.JsonNull,
    lastTestResult: getOptionalString(snapshot, 'lastTestResult'),
    lastTestDate: parseDate(snapshot.lastTestDate),
    lastMileage: getOptionalNumber(snapshot, 'lastMileage'),
    lastMileageUnit: getOptionalString(snapshot, 'lastMileageUnit'),
    dvsaAvailable: typeof snapshot.dvsaAvailable === 'boolean' ? snapshot.dvsaAvailable : false,
    motHistoryUnavailableReason: getOptionalString(snapshot, 'motHistoryUnavailableReason'),
    dvlaLastRefreshedAt: new Date(),
    dvsaLastRefreshedAt: new Date(),
  };
}

function cachedMotHistoryForVehicle(vehicle: { motHistoryCache?: Prisma.JsonValue | null }) {
  return Array.isArray(vehicle.motHistoryCache) ? vehicle.motHistoryCache : [];
}

async function handleCron(request: VercelRequest, response: VercelResponse, parts: string[]) {
  if (request.method !== 'GET') return sendMethodNotAllowed(response, ['GET']);
  if (parts[1] !== 'refresh-vehicle-snapshots') return sendError(response, 404, 'Cron route not found.');

  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret) {
    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${expectedSecret}`) {
      return sendError(response, 401, 'Unauthorized.');
    }
  }

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const staleVehicles = await prisma.vehicle.findMany({
    where: {
      isActive: true,
      OR: [
        { dvlaLastRefreshedAt: null },
        { dvlaLastRefreshedAt: { lt: cutoff } },
        { dvsaLastRefreshedAt: null },
        { dvsaLastRefreshedAt: { lt: cutoff } },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    take: 25,
  });

  let refreshed = 0;
  const failures: Array<{vehicleId: string; registration: string; error: string}> = [];

  for (const vehicle of staleVehicles) {
    try {
      const snapshot = await buildVehicleLookupSnapshot(vehicle.registration);
      await prisma.vehicle.update({
        where: { id: vehicle.id },
        data: vehicleSnapshotUpdateData(snapshot),
      });
      refreshed += 1;
    } catch (error) {
      failures.push({
        vehicleId: vehicle.id,
        registration: vehicle.registration,
        error: error instanceof Error ? error.message : 'Unknown refresh error',
      });
    }
  }

  response.status(200).json({
    success: true,
    scanned: staleVehicles.length,
    refreshed,
    failed: failures.length,
    failures,
  });
}

async function handleGoogleAuth(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') return sendMethodNotAllowed(response, ['POST']);

  const googleWebClientId = process.env.GOOGLE_WEB_CLIENT_ID;
  if (!googleWebClientId) return sendError(response, 500, 'Google sign-in is not configured.');
  const sessionSecret = process.env.VROOVA_JWT_SECRET ?? process.env.JWT_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) return sendError(response, 500, 'Vroova session signing is not configured.');

  try {
    const body = readJsonBody(request);
    const idToken = typeof body.idToken === 'string' ? body.idToken : null;
    if (!idToken) return sendError(response, 400, 'Missing Google ID token.');

    const client = new OAuth2Client(googleWebClientId);
    const ticket = await client.verifyIdToken({ idToken, audience: googleWebClientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) return sendError(response, 401, 'Google account payload is incomplete.');

    const user = await prisma.user.upsert({
      where: { googleSubject: payload.sub },
      update: { email: payload.email, fullName: payload.name ?? null, pictureUrl: payload.picture ?? null },
      create: {
        id: `google:${payload.sub}`,
        googleSubject: payload.sub,
        email: payload.email,
        fullName: payload.name ?? null,
        pictureUrl: payload.picture ?? null,
        profile: { create: { tier: 'FREE' } },
      },
      include: { profile: true },
    });
    if (!user.profile) await prisma.profile.create({ data: { userId: user.id, tier: 'FREE' } });

    response.status(200).json(authResponseForUser(user));
  } catch (error) {
    console.error('Google auth failed', { message: error instanceof Error ? error.message : 'Unknown auth error' });
    sendError(response, 401, 'Google sign-in failed.');
  }
}

async function handleEmailAuth(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') return sendMethodNotAllowed(response, ['POST']);

  try {
    const body = readJsonBody(request);
    const mode = body.mode === 'register' ? 'register' : 'login';
    const email = normaliseEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';

    if (!email || !email.includes('@')) return sendError(response, 400, 'Enter a valid email address.');
    if (password.length < 8) return sendError(response, 400, 'Password must be at least 8 characters.');

    const existing = await prisma.user.findUnique({ where: { email }, include: { profile: true } });

    if (mode === 'register') {
      if (existing?.passwordHash) return sendError(response, 409, 'An account already exists for this email.');
      if (existing && !existing.passwordHash) return sendError(response, 409, 'This email is already linked to Google sign-in.');

      const { salt, hash } = hashPassword(password);
      const user = await prisma.user.create({
        data: {
          email,
          fullName: fullName || null,
          passwordSalt: salt,
          passwordHash: hash,
          profile: { create: { tier: 'FREE' } },
        },
        include: { profile: true },
      });
      return response.status(200).json(authResponseForUser(user));
    }

    if (!existing?.passwordHash || !existing.passwordSalt) return sendError(response, 401, 'Email or password is incorrect.');
    if (!passwordMatches(password, existing.passwordSalt, existing.passwordHash)) return sendError(response, 401, 'Email or password is incorrect.');
    return response.status(200).json(authResponseForUser(existing));
  } catch (error) {
    console.error('Email auth failed', { message: error instanceof Error ? error.message : 'Unknown auth error' });
    return sendError(response, 500, 'Email sign-in failed.');
  }
}

async function handlePublicVehicleCheck(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') return sendMethodNotAllowed(response, ['POST']);
  try {
    const body = readJsonBody(request);
    const registration = typeof body.registration === 'string' ? body.registration : '';
    response.status(200).json({ vehicle: await buildVehicleLookupSnapshot(registration) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Vehicle lookup failed.';
    sendError(response, message.includes('not configured') ? 503 : 400, message);
  }
}

async function handleVehicles(request: VercelRequest, response: VercelResponse, parts: string[]) {
  const context = await getRequestUser(request, response);
  if (!context) return;

  if (parts.length === 1) {
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
      try {
        const body = readJsonBody(request);
        const registration = normaliseRegistration(body.registration);
        const make = getOptionalString(body, 'make') ?? 'UNKNOWN';
        if (!registration) return sendError(response, 400, 'Registration is required.');

        const existingVehicleCount = await prisma.vehicle.count({ where: { userId: context.user.id, isActive: true } });
        const tier = context.user.profile?.tier ?? 'FREE';
        const vehicleLimit = tier === 'PRO' ? 5 : 1;
        if (existingVehicleCount >= vehicleLimit) {
          return sendError(
            response,
            402,
            tier === 'PRO'
              ? 'Vroova Pro currently supports up to 5 vehicles. Fleet support is coming later.'
              : 'Free plan allows one vehicle. Upgrade to Pro to add more.',
            { requiresUpgrade: tier !== 'PRO' },
          );
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
            motHistoryCache: Array.isArray(body.motHistory) ? body.motHistory : undefined,
            motHistoryCount: getOptionalNumber(body, 'motHistoryCount'),
            advisoryCount: getOptionalNumber(body, 'advisoryCount'),
            recentAdvisories: Array.isArray(body.recentAdvisories) ? body.recentAdvisories : undefined,
            lastTestResult: getOptionalString(body, 'lastTestResult'),
            lastTestDate: parseDate(body.lastTestDate),
            lastMileage: getOptionalNumber(body, 'lastMileage'),
            lastMileageUnit: getOptionalString(body, 'lastMileageUnit'),
            dvsaAvailable: typeof body.dvsaAvailable === 'boolean' ? body.dvsaAvailable : undefined,
            motHistoryUnavailableReason: getOptionalString(body, 'motHistoryUnavailableReason'),
            dvlaLastRefreshedAt: new Date(),
            dvsaLastRefreshedAt: Array.isArray(body.motHistory) ? new Date() : undefined,
          },
          include: vehicleInclude,
        });
        response.status(201).json(serializeVehicle(vehicle));
        return;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return sendError(response, 409, 'This vehicle is already in your garage.');
        console.error('Vehicle create failed', { message: error instanceof Error ? error.message : 'Unknown error' });
        return sendError(response, 500, 'Vehicle request failed.');
      }
    }
    return sendMethodNotAllowed(response, ['GET', 'POST']);
  }

  if (parts[1] === 'lookup' && parts.length === 2) {
    if (request.method !== 'POST') return sendMethodNotAllowed(response, ['POST']);
    try {
      const body = readJsonBody(request);
      response.status(200).json({ vehicle: await buildVehicleLookupSnapshot(typeof body.registration === 'string' ? body.registration : '') });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not lookup vehicle.';
      sendError(response, message.includes('not configured') ? 503 : 400, message);
    }
    return;
  }

  const vehicleId = parts[1];
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId: context.user.id, isActive: true } });
  if (!vehicle) return sendError(response, 404, 'Vehicle not found.');

  if (parts.length === 2) {
    if (request.method === 'GET') {
      const fullVehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId: context.user.id, isActive: true }, include: vehicleInclude });
      response.status(200).json(serializeVehicle(fullVehicle));
      return;
    }
    if (request.method === 'DELETE') {
      await prisma.vehicle.update({ where: { id: vehicleId }, data: { isActive: false } });
      response.status(200).json({ success: true });
      return;
    }
    return sendMethodNotAllowed(response, ['GET', 'DELETE']);
  }

  if (parts[2] === 'refresh' && parts.length === 3) {
    if (request.method !== 'POST') return sendMethodNotAllowed(response, ['POST']);
    try {
      const snapshot = await buildVehicleLookupSnapshot(vehicle.registration);
      const updated = await prisma.vehicle.update({
        where: { id: vehicleId },
        data: vehicleSnapshotUpdateData(snapshot),
        include: vehicleInclude,
      });
      response.status(200).json(serializeVehicle(updated));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'DVLA refresh failed.';
      sendError(response, message.includes('not configured') ? 503 : 502, message);
    }
    return;
  }

  if (parts[2] === 'mot-history' && parts.length === 3) {
    if (request.method !== 'GET') return sendMethodNotAllowed(response, ['GET']);
    try {
      const hasFreshCache =
        !!vehicle.dvsaLastRefreshedAt && Date.now() - new Date(vehicle.dvsaLastRefreshedAt).getTime() < 7 * 24 * 60 * 60 * 1000;
      if (hasFreshCache && Array.isArray(vehicle.motHistoryCache)) {
        response.status(200).json({
          motHistory: cachedMotHistoryForVehicle(vehicle),
          cached: true,
          refreshedAt: vehicle.dvsaLastRefreshedAt,
        });
        return;
      }

      if (Array.isArray(vehicle.motHistoryCache) && vehicle.motHistoryCache.length > 0) {
        response.status(200).json({
          motHistory: cachedMotHistoryForVehicle(vehicle),
          cached: true,
          refreshedAt: vehicle.dvsaLastRefreshedAt,
        });
        return;
      }

      const snapshot = await buildVehicleLookupSnapshot(vehicle.registration);
      await prisma.vehicle.update({
        where: { id: vehicleId },
        data: vehicleSnapshotUpdateData(snapshot),
      });
      response.status(200).json({
        motHistory: Array.isArray(snapshot.motHistory) ? snapshot.motHistory : [],
        cached: false,
        refreshedAt: new Date(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MOT history request failed.';
      sendError(response, message.includes('not configured') ? 503 : 502, message);
    }
    return;
  }

  if (parts[2] === 'mot-advisories' && parts[3] === 'jobs' && parts.length === 4) {
    if (request.method !== 'POST') return sendMethodNotAllowed(response, ['POST']);
    if (context.user.profile?.tier !== 'PRO') return sendError(response, 403, 'Converting MOT advisories to jobs requires Pro.', { requiresUpgrade: true });

    const raw = readJsonBody(request);
    const advisories = Array.isArray(raw) ? raw : [];
    const existing = await prisma.job.findMany({ where: { userId: context.user.id, vehicleId, source: 'mot_advisory' }, select: { motAdvisoryText: true } });
    const existingText = new Set(existing.map(job => job.motAdvisoryText).filter(Boolean));
    const data = advisories
      .map(item => ({ text: typeof item?.text === 'string' ? item.text : '', type: typeof item?.type === 'string' ? item.type : 'ADVISORY' }))
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
    return;
  }

  sendError(response, 404, 'Route not found.');
}

async function handleJobs(request: VercelRequest, response: VercelResponse, parts: string[]) {
  const context = await getRequestUser(request, response);
  if (!context) return;

  if (parts.length === 1) {
    if (request.method !== 'POST') return sendMethodNotAllowed(response, ['POST']);
    const body = readJsonBody(request);
    const vehicleId = getOptionalString(body, 'vehicleId');
    const title = getOptionalString(body, 'title');
    if (!vehicleId || !title) return sendError(response, 400, 'vehicleId and title are required.');
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId: context.user.id, isActive: true } });
    if (!vehicle) return sendError(response, 404, 'Vehicle not found.');
    const job = await prisma.job.create({
      data: {
        userId: context.user.id,
        vehicleId,
        title,
        description: getOptionalString(body, 'description'),
        category: getOptionalString(body, 'category') ?? 'service',
        priority: validPriority(body.priority),
        dueDate: parseDate(body.dueDate),
        estimatedCost: getOptionalNumber(body, 'estimatedCost'),
      },
    });
    response.status(201).json(job);
    return;
  }

  const id = parts[1];
  const job = await prisma.job.findFirst({ where: { id, userId: context.user.id } });
  if (!job) return sendError(response, 404, 'Job not found.');

  if (request.method === 'PATCH') {
    const body = readJsonBody(request);
    const status = validStatus(body.status);
    const updated = await prisma.job.update({
      where: { id },
      data: {
        title: getOptionalString(body, 'title') ?? undefined,
        description: getOptionalString(body, 'description') ?? undefined,
        category: getOptionalString(body, 'category') ?? undefined,
        priority: validPriority(body.priority) ?? undefined,
        dueDate: body.dueDate === undefined ? undefined : parseDate(body.dueDate),
        estimatedCost: body.estimatedCost === undefined ? undefined : getOptionalNumber(body, 'estimatedCost'),
        actualCost: body.actualCost === undefined ? undefined : getOptionalNumber(body, 'actualCost'),
        completionNotes: getOptionalString(body, 'completionNotes') ?? undefined,
        status: status ?? undefined,
        completedAt: status === 'COMPLETED' ? parseDate(body.completedAt) ?? new Date() : status ? null : undefined,
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

async function handleReminders(request: VercelRequest, response: VercelResponse, parts: string[]) {
  const context = await getRequestUser(request, response);
  if (!context) return;

  if (parts.length === 1) {
    if (request.method !== 'POST') return sendMethodNotAllowed(response, ['POST']);
    const body = readJsonBody(request);
    const vehicleId = getOptionalString(body, 'vehicleId');
    const title = getOptionalString(body, 'title');
    const dueDate = parseDate(body.dueDate);
    if (!title || !dueDate) return sendError(response, 400, 'title and dueDate are required.');
    if (vehicleId) {
      const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId: context.user.id, isActive: true } });
      if (!vehicle) return sendError(response, 404, 'Vehicle not found.');
    }
    const reminder = await prisma.reminder.create({
      data: {
        userId: context.user.id,
        vehicleId,
        title,
        reminderType: getOptionalString(body, 'reminderType') ?? 'service',
        description: getOptionalString(body, 'description'),
        dueDate,
        remindDaysBefore: getOptionalNumber(body, 'remindDaysBefore') ?? 14,
      },
    });
    response.status(201).json(reminder);
    return;
  }

  const id = parts[1];
  const reminder = await prisma.reminder.findFirst({ where: { id, userId: context.user.id } });
  if (!reminder) return sendError(response, 404, 'Reminder not found.');

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

async function ensureOwnedVehicle(userId: string, vehicleId: string) {
  return prisma.vehicle.findFirst({ where: { id: vehicleId, userId, isActive: true } });
}

async function handleMileage(request: VercelRequest, response: VercelResponse, parts: string[]) {
  const context = await getRequestUser(request, response);
  if (!context) return;
  if (parts.length === 1) {
    if (request.method !== 'POST') return sendMethodNotAllowed(response, ['POST']);
    const body = readJsonBody(request);
    const vehicleId = getOptionalString(body, 'vehicleId');
    const mileage = getOptionalNumber(body, 'mileage');
    if (!vehicleId || !mileage) return sendError(response, 400, 'vehicleId and mileage are required.');
    if (!(await ensureOwnedVehicle(context.user.id, vehicleId))) return sendError(response, 404, 'Vehicle not found.');
    const log = await prisma.mileageLog.create({ data: { vehicleId, userId: context.user.id, mileage, recordedAt: parseDate(body.recordedAt) ?? new Date(), notes: getOptionalString(body, 'notes') } });
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { currentMileage: mileage } });
    response.status(201).json(log);
    return;
  }

  const id = parts[1];
  const log = await prisma.mileageLog.findFirst({ where: { id, userId: context.user.id } });
  if (!log) return sendError(response, 404, 'Mileage log not found.');
  if (request.method === 'DELETE') {
    await prisma.mileageLog.delete({ where: { id } });
    const latest = await prisma.mileageLog.findFirst({ where: { vehicleId: log.vehicleId, userId: context.user.id }, orderBy: { recordedAt: 'desc' } });
    await prisma.vehicle.update({ where: { id: log.vehicleId }, data: { currentMileage: latest?.mileage ?? null } });
    response.status(200).json({ success: true });
    return;
  }
  sendMethodNotAllowed(response, ['POST', 'DELETE']);
}

async function handleInsurance(request: VercelRequest, response: VercelResponse, parts: string[]) {
  const context = await getRequestUser(request, response);
  if (!context) return;
  if (parts.length === 1) {
    if (request.method !== 'POST') return sendMethodNotAllowed(response, ['POST']);
    const body = readJsonBody(request);
    const vehicleId = getOptionalString(body, 'vehicleId');
    const provider = getOptionalString(body, 'provider');
    const renewalDate = parseDate(body.renewalDate);
    if (!vehicleId || !provider || !renewalDate) return sendError(response, 400, 'vehicleId, provider and renewalDate are required.');
    if (!(await ensureOwnedVehicle(context.user.id, vehicleId))) return sendError(response, 404, 'Vehicle not found.');
    const policy = await prisma.insurancePolicy.create({ data: { vehicleId, userId: context.user.id, provider, renewalDate, policyNumber: getOptionalString(body, 'policyNumber'), notes: getOptionalString(body, 'notes') } });
    response.status(201).json(policy);
    return;
  }

  const id = parts[1];
  const policy = await prisma.insurancePolicy.findFirst({ where: { id, userId: context.user.id } });
  if (!policy) return sendError(response, 404, 'Insurance policy not found.');
  if (request.method === 'DELETE') {
    await prisma.insurancePolicy.delete({ where: { id } });
    response.status(200).json({ success: true });
    return;
  }
  sendMethodNotAllowed(response, ['POST', 'DELETE']);
}

async function handleRecords(request: VercelRequest, response: VercelResponse, parts: string[]) {
  const context = await getRequestUser(request, response);
  if (!context) return;
  if (parts.length === 1) {
    if (request.method !== 'POST') return sendMethodNotAllowed(response, ['POST']);
    const body = readJsonBody(request);
    const vehicleId = getOptionalString(body, 'vehicleId');
    const title = getOptionalString(body, 'title') ?? getOptionalString(body, 'provider') ?? 'Service record';
    if (!vehicleId || !title) return sendError(response, 400, 'vehicleId and title are required.');
    if (!(await ensureOwnedVehicle(context.user.id, vehicleId))) return sendError(response, 404, 'Vehicle not found.');
    const record = await prisma.serviceRecord.create({
      data: {
        vehicleId,
        userId: context.user.id,
        title,
        description: getOptionalString(body, 'description'),
        provider: getOptionalString(body, 'provider'),
        recordDate: parseDate(body.recordDate) ?? new Date(),
        mileage: getOptionalNumber(body, 'mileage'),
        cost: getOptionalNumber(body, 'cost'),
        recordType: getOptionalString(body, 'recordType') ?? 'service',
      },
    });
    response.status(201).json(record);
    return;
  }

  const id = parts[1];
  const record = await prisma.serviceRecord.findFirst({ where: { id, userId: context.user.id } });
  if (!record) return sendError(response, 404, 'Service record not found.');
  if (request.method === 'DELETE') {
    await prisma.serviceRecord.delete({ where: { id } });
    response.status(200).json({ success: true });
    return;
  }
  sendMethodNotAllowed(response, ['POST', 'DELETE']);
}

async function handleMe(request: VercelRequest, response: VercelResponse) {
  const context = await getRequestUser(request, response);
  if (!context) return;
  if (request.method === 'GET') return response.status(200).json(userPayload(context.user));
  if (request.method === 'DELETE') {
    await prisma.user.delete({ where: { id: context.user.id } });
    return response.status(200).json({ success: true });
  }
  sendMethodNotAllowed(response, ['GET', 'DELETE']);
}

async function handleSubscriptionRefresh(request: VercelRequest, response: VercelResponse) {
  const context = await getRequestUser(request, response);
  if (!context) return;
  if (request.method !== 'POST') return sendMethodNotAllowed(response, ['POST']);

  const entitlement = await prisma.subscriptionEntitlement.findFirst({ where: { userId: context.user.id }, orderBy: { updatedAt: 'desc' } });
  const expiresAt = entitlement?.expiryTime?.toISOString() ?? null;
  const isActive = entitlement?.status === 'ACTIVE' && (!entitlement.expiryTime || entitlement.expiryTime.getTime() > Date.now());
  const tier: 'FREE' | 'PRO' = isActive ? 'PRO' : 'FREE';
  if ((context.user.profile?.tier ?? 'FREE') !== tier) await prisma.profile.upsert({ where: { userId: context.user.id }, update: { tier }, create: { userId: context.user.id, tier } });
  const nextSession = {
    sub: context.user.id,
    email: context.user.email,
    name: context.user.fullName ?? null,
    picture: context.user.pictureUrl ?? null,
    tier,
    subscriptionProductId: isActive ? entitlement?.productId ?? null : null,
    subscriptionStatus: entitlement?.status ?? (tier === 'PRO' ? 'ACTIVE' : 'FREE'),
    subscriptionExpiresAt: isActive ? expiresAt : null,
  };
  response.status(200).json({
    success: tier === 'PRO',
    tier,
    status: nextSession.subscriptionStatus,
    productId: nextSession.subscriptionProductId,
    expiresAt: nextSession.subscriptionExpiresAt,
    token: createSessionToken(nextSession),
    user: { ...userPayload(context.user), tier, subscriptionProductId: nextSession.subscriptionProductId, subscriptionStatus: nextSession.subscriptionStatus, subscriptionExpiresAt: nextSession.subscriptionExpiresAt },
  });
}

async function handleSubscriptionVerify(request: VercelRequest, response: VercelResponse) {
  const context = await getRequestUser(request, response);
  if (!context) return;
  if (request.method !== 'POST') return sendMethodNotAllowed(response, ['POST']);
  if (!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) return sendError(response, 503, 'Google Play verification is not configured yet.');

  try {
    const body = readJsonBody(request);
    const packageName = typeof body.packageName === 'string' ? body.packageName : null;
    const productId = typeof body.productId === 'string' ? body.productId : null;
    const purchaseToken = typeof body.purchaseToken === 'string' ? body.purchaseToken : null;
    if (!packageName || !productId || !purchaseToken) return sendError(response, 400, 'packageName, productId and purchaseToken are required.');
    if (packageName !== getGooglePlayPackageName() || productId !== getGooglePlaySubscriptionProductId()) return sendError(response, 400, 'Purchase does not match Vroova Android subscription configuration.');

    const entitlement = await verifyGooglePlaySubscription({ packageName, productId, purchaseToken });
    await prisma.subscriptionEntitlement.upsert({
      where: { purchaseTokenHash: entitlement.purchaseTokenHash },
      update: { userId: context.user.id, tier: entitlement.tier, status: entitlement.status, productId: entitlement.productId, packageName, expiryTime: entitlement.expiresAt ? new Date(entitlement.expiresAt) : null, autoRenewing: entitlement.autoRenewing, rawProviderPayload: entitlement.raw, lastVerifiedAt: new Date() },
      create: { userId: context.user.id, tier: entitlement.tier, status: entitlement.status, productId: entitlement.productId, purchaseTokenHash: entitlement.purchaseTokenHash, packageName, expiryTime: entitlement.expiresAt ? new Date(entitlement.expiresAt) : null, autoRenewing: entitlement.autoRenewing, rawProviderPayload: entitlement.raw, lastVerifiedAt: new Date() },
    });
    await prisma.profile.upsert({ where: { userId: context.user.id }, update: { tier: entitlement.tier }, create: { userId: context.user.id, tier: entitlement.tier } });
    const nextSession = { sub: context.user.id, email: context.user.email, name: context.user.fullName ?? null, picture: context.user.pictureUrl ?? null, tier: entitlement.tier, subscriptionProductId: entitlement.productId, subscriptionStatus: entitlement.status, subscriptionExpiresAt: entitlement.expiresAt };
    response.status(200).json({
      success: entitlement.active,
      tier: entitlement.tier,
      status: entitlement.status,
      productId: entitlement.productId,
      expiresAt: entitlement.expiresAt,
      autoRenewing: entitlement.autoRenewing,
      needsAcknowledgement: entitlement.needsAcknowledgement,
      isTestPurchase: entitlement.isTestPurchase,
      purchaseTokenHash: entitlement.purchaseTokenHash,
      token: createSessionToken(nextSession),
      user: sessionToUser({ ...nextSession, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }),
    });
  } catch (error) {
    console.error('Google Play verification failed', { message: error instanceof Error ? error.message : 'Unknown Google Play verification error' });
    sendError(response, 502, 'Google Play subscription verification failed.');
  }
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const parts = segments(request);
  const key = routeKey(parts);

  if (key === '/') return response.status(200).json({ ok: true, service: 'vroova-api', version: 'v1' });
  if (key === '/health') return response.status(200).json({ status: 'healthy' });
  if (parts[0] === 'cron') return handleCron(request, response, parts);
  if (key === '/user') return response.status(200).json({ id: 'test-user', email: 'test@vroova.com' });
  if (key === '/auth') return request.method === 'POST' ? response.status(200).json({ success: true }) : sendMethodNotAllowed(response, ['POST']);
  if (key === '/auth/google') return handleGoogleAuth(request, response);
  if (key === '/auth/email') return handleEmailAuth(request, response);
  if (key === '/public/vehicle-check') return handlePublicVehicleCheck(request, response);
  if (key === '/me') return handleMe(request, response);
  if (parts[0] === 'vehicles') return handleVehicles(request, response, parts);
  if (parts[0] === 'jobs') return handleJobs(request, response, parts);
  if (parts[0] === 'reminders') return handleReminders(request, response, parts);
  if (parts[0] === 'mileage') return handleMileage(request, response, parts);
  if (parts[0] === 'insurance') return handleInsurance(request, response, parts);
  if (parts[0] === 'records' || parts[0] === 'service-records') return handleRecords(request, response, parts);
  if (key === '/documents') return sendError(response, 501, 'Documents are stored locally on the Android phone in this app version.');
  if (key === '/subscriptions/google-play/refresh') return handleSubscriptionRefresh(request, response);
  if (key === '/subscriptions/google-play/verify') return handleSubscriptionVerify(request, response);

  sendError(response, 404, 'Route not found.');
}

