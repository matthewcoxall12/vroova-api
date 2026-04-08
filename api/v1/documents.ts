import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRequestUser } from '../_lib/authUser.js';
import { sendError, sendMethodNotAllowed } from '../_lib/http.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const context = await getRequestUser(request, response);
  if (!context) return;
  if (request.method !== 'POST') {
    sendMethodNotAllowed(response, ['POST']);
    return;
  }

  sendError(
    response,
    501,
    'Document upload needs production object storage before it can be enabled. Use S3-compatible storage or Vercel Blob, then wire /v1/documents to store the file and save metadata.',
  );
}
