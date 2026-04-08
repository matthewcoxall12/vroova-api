# Vroova API

Vercel serverless API for the Vroova Android app.

## Routes

- `GET /v1`
- `GET /v1/health`
- `POST /v1/auth`
- `GET /v1/user`
- `POST /v1/auth/google`
- `GET /v1/me`
- `DELETE /v1/me`
- `GET /v1/vehicles`
- `POST /v1/vehicles`
- `POST /v1/vehicles/lookup`
- `GET /v1/vehicles/:id`
- `POST /v1/vehicles/:id/refresh`
- `GET /v1/vehicles/:id/mot-history`
- `POST /v1/vehicles/:id/mot-advisories/jobs`
- `POST /v1/jobs`
- `PATCH /v1/jobs/:id`
- `DELETE /v1/jobs/:id`
- `POST /v1/reminders`
- `PATCH /v1/reminders/:id`
- `DELETE /v1/reminders/:id`
- `POST /v1/mileage`
- `POST /v1/insurance`
- `POST /v1/records`
- `POST /v1/subscriptions/google-play/verify`
- `POST /v1/subscriptions/google-play/refresh`

## Required Environment Variables

Set these in Vercel Project Settings:

```text
GOOGLE_WEB_CLIENT_ID
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
GOOGLE_PLAY_PACKAGE_NAME
GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID
VROOVA_JWT_SECRET
DVLA_API_KEY
DVSA_CLIENT_ID
DVSA_CLIENT_SECRET
DVSA_API_KEY
DVSA_SCOPE_URL
DVSA_TOKEN_URL
DATABASE_URL
DIRECT_URL
```

Do not store real secrets in this repository.

`VROOVA_JWT_SECRET` signs Vroova app session tokens after Google sign-in. Use a long random value of at least 32 characters in production.

`GOOGLE_PLAY_PACKAGE_NAME` should be `com.vroovamobile`.

`GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID` should be `vroova_pro_monthly`.

`DATABASE_URL` must point to the production PostgreSQL connection used by the app at runtime.

`DIRECT_URL` should point to the direct Supabase PostgreSQL connection used by Prisma migrations.

The Vercel build runs the migration automatically:

```text
npm run db:migrate && npm run typecheck
```

If you need to run the migration manually from a shell that already has the Vercel/Supabase env vars available:

```powershell
npm run db:migrate
```

Vercel runs `prisma generate` during install via `postinstall`.

## Local Development

```powershell
npm install
npm run dev
```

## Production Deployment

Deploy this repository to Vercel and attach the domain:

```text
api.vroova.com
```

The root production API check should return JSON:

```text
https://api.vroova.com/v1
```
