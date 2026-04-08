# Vroova API

Minimal Vercel serverless API for the Vroova Android app.

## Routes

- `GET /v1`
- `GET /v1/health`
- `POST /v1/auth`
- `GET /v1/user`

## Required Environment Variables

Set these in Vercel Project Settings:

```text
GOOGLE_WEB_CLIENT_ID
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
```

Do not store real secrets in this repository.

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

