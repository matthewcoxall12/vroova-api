import { createHash } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';

type GooglePlayServiceAccount = {
  client_email?: string;
  private_key?: string;
};

type SubscriptionLineItem = {
  productId?: string;
  expiryTime?: string;
  autoRenewingPlan?: {
    autoRenewEnabled?: boolean;
  };
  offerDetails?: {
    basePlanId?: string;
    offerId?: string;
  };
};

type SubscriptionPurchaseV2 = {
  subscriptionState?: string;
  acknowledgementState?: string;
  lineItems?: SubscriptionLineItem[];
  testPurchase?: Record<string, never>;
};

export type GooglePlayEntitlement = {
  active: boolean;
  tier: 'FREE' | 'PRO';
  status:
    | 'ACTIVE'
    | 'GRACE_PERIOD'
    | 'CANCELED_UNTIL_EXPIRY'
    | 'EXPIRED'
    | 'PENDING'
    | 'ON_HOLD'
    | 'PAUSED'
    | 'PRODUCT_MISMATCH'
    | 'UNKNOWN';
  productId: string;
  expiresAt: string | null;
  autoRenewing: boolean | null;
  needsAcknowledgement: boolean;
  isTestPurchase: boolean;
  purchaseTokenHash: string;
  raw: SubscriptionPurchaseV2;
};

const androidPublisherScope = 'https://www.googleapis.com/auth/androidpublisher';

export function getGooglePlayPackageName() {
  return process.env.GOOGLE_PLAY_PACKAGE_NAME ?? 'com.vroovamobile';
}

export function getGooglePlaySubscriptionProductId() {
  return process.env.GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID ?? 'vroova_pro_monthly';
}

function parseServiceAccountJson() {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not configured.');

  const credentials = JSON.parse(raw.replace(/\\n/g, '\n')) as GooglePlayServiceAccount;
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is missing client_email or private_key.');
  }
  return credentials;
}

function purchaseTokenHash(purchaseToken: string) {
  return createHash('sha256').update(purchaseToken).digest('hex');
}

function stateToStatus(state?: string, hasFutureExpiry = false): GooglePlayEntitlement['status'] {
  if (state === 'SUBSCRIPTION_STATE_ACTIVE') return 'ACTIVE';
  if (state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD') return 'GRACE_PERIOD';
  if (state === 'SUBSCRIPTION_STATE_CANCELED' && hasFutureExpiry) return 'CANCELED_UNTIL_EXPIRY';
  if (state === 'SUBSCRIPTION_STATE_EXPIRED') return 'EXPIRED';
  if (state === 'SUBSCRIPTION_STATE_PENDING') return 'PENDING';
  if (state === 'SUBSCRIPTION_STATE_ON_HOLD') return 'ON_HOLD';
  if (state === 'SUBSCRIPTION_STATE_PAUSED') return 'PAUSED';
  return 'UNKNOWN';
}

export async function verifyGooglePlaySubscription({
  packageName,
  productId,
  purchaseToken,
}: {
  packageName: string;
  productId: string;
  purchaseToken: string;
}): Promise<GooglePlayEntitlement> {
  const expectedPackageName = getGooglePlayPackageName();
  const expectedProductId = getGooglePlaySubscriptionProductId();
  if (packageName !== expectedPackageName) {
    throw new Error(`Package mismatch. Expected ${expectedPackageName}.`);
  }
  if (productId !== expectedProductId) {
    throw new Error(`Product mismatch. Expected ${expectedProductId}.`);
  }

  const auth = new GoogleAuth({
    credentials: parseServiceAccountJson(),
    scopes: [androidPublisherScope],
  });
  const client = await auth.getClient();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}` +
    `/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const { data } = await client.request<SubscriptionPurchaseV2>({ method: 'GET', url });

  const matchingLineItem = data.lineItems?.find(item => item.productId === productId);
  if (!matchingLineItem) {
    return {
      active: false,
      tier: 'FREE',
      status: 'PRODUCT_MISMATCH',
      productId,
      expiresAt: null,
      autoRenewing: null,
      needsAcknowledgement: data.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
      isTestPurchase: Boolean(data.testPurchase),
      purchaseTokenHash: purchaseTokenHash(purchaseToken),
      raw: data,
    };
  }

  const expiresAt = matchingLineItem.expiryTime ?? null;
  const hasFutureExpiry = expiresAt ? new Date(expiresAt).getTime() > Date.now() : false;
  const status = stateToStatus(data.subscriptionState, hasFutureExpiry);
  const active = hasFutureExpiry && ['ACTIVE', 'GRACE_PERIOD', 'CANCELED_UNTIL_EXPIRY'].includes(status);

  return {
    active,
    tier: active ? 'PRO' : 'FREE',
    status: active ? status : status === 'UNKNOWN' && !hasFutureExpiry ? 'EXPIRED' : status,
    productId,
    expiresAt,
    autoRenewing: matchingLineItem.autoRenewingPlan?.autoRenewEnabled ?? null,
    needsAcknowledgement: data.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
    isTestPurchase: Boolean(data.testPurchase),
    purchaseTokenHash: purchaseTokenHash(purchaseToken),
    raw: data,
  };
}
