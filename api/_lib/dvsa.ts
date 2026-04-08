import { normaliseRegistration } from './http.js';

type DvsaTokenResponse = {
  access_token: string;
  expires_in: number;
};

export type MotDefect = {
  text: string;
  type: string;
  dangerous?: boolean;
};

export type MotTest = {
  completedDate: string;
  testResult: string;
  expiryDate?: string;
  odometerValue?: number;
  odometerUnit?: string;
  motTestNumber?: string;
  defects?: MotDefect[];
  rfrAndComments?: MotDefect[];
};

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 300_000) return cachedToken.token;

  const clientId = process.env.DVSA_CLIENT_ID;
  const clientSecret = process.env.DVSA_CLIENT_SECRET;
  const tokenUrl = process.env.DVSA_TOKEN_URL;
  const scope = process.env.DVSA_SCOPE_URL ?? 'https://tapi.dvsa.gov.uk/.default';
  if (!clientId || !clientSecret || !tokenUrl) throw new Error('DVSA OAuth credentials are not configured.');

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    }).toString(),
  });

  if (!response.ok) throw new Error(`DVSA token request failed with status ${response.status}.`);

  const data = (await response.json()) as DvsaTokenResponse;
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

export async function fetchMotHistory(registration: string) {
  const apiKey = process.env.DVSA_API_KEY;
  if (!apiKey) throw new Error('DVSA_API_KEY is not configured.');

  const token = await getAccessToken();
  const cleanRegistration = normaliseRegistration(registration);
  const response = await fetch(
    `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(cleanRegistration)}`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'x-api-key': apiKey,
      },
    },
  );

  if (response.status === 404) return { motTests: [] as MotTest[], vehicleInfo: null };
  if (!response.ok) throw new Error(`DVSA MOT history request failed with status ${response.status}.`);

  const data = (await response.json()) as { motTests?: MotTest[] };
  const motTests = (data.motTests ?? []).map(test => ({
    ...test,
    defects: test.defects ?? test.rfrAndComments ?? [],
  }));
  return { motHistory: motTests, motTests, advisories: extractAdvisories(motTests), vehicleInfo: data };
}

export function extractAdvisories(motTests: MotTest[]) {
  return motTests.flatMap(test =>
    (test.defects ?? test.rfrAndComments ?? [])
      .filter(defect => ['ADVISORY', 'MINOR', 'PRS', 'MAJOR', 'DANGEROUS', 'FAIL'].includes(defect.type?.toUpperCase()))
      .map(defect => ({
        text: defect.text,
        type: defect.type,
        dangerous: defect.dangerous ?? false,
        testDate: test.completedDate,
      })),
  );
}
