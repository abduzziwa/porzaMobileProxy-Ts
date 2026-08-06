import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getMessaging, type MulticastMessage } from "firebase-admin/messaging";

// Errors that mean the token itself is permanently dead — safe to mark invalid.
// Anything else (network, quota, internal, unavailable) is treated as transient.
const PERMANENTLY_INVALID_ERROR_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

export function isPermanentlyInvalidTokenError(errorCode: string): boolean {
  return PERMANENTLY_INVALID_ERROR_CODES.has(errorCode);
}

let app: App | undefined;

function getFirebaseApp(): App {
  if (app) return app;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase credentials are not configured");
  }

  const existing = getApps();
  app = existing.length > 0 ? existing[0] : initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });

  return app;
}

export interface SendPushNotificationsParams {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface SendPushNotificationsResult {
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
  perToken: Array<{ token: string; success: boolean }>;
}

export async function sendPushNotifications({
  tokens,
  title,
  body,
  data,
}: SendPushNotificationsParams): Promise<SendPushNotificationsResult> {
  const dedupedTokens = Array.from(new Set(tokens));

  if (dedupedTokens.length === 0) {
    return { successCount: 0, failureCount: 0, invalidTokens: [], perToken: [] };
  }

  const messaging = getMessaging(getFirebaseApp());

  const message: MulticastMessage = {
    tokens: dedupedTokens,
    notification: { title, body },
    data: data ?? {},
  };

  const response = await messaging.sendEachForMulticast(message);

  const invalidTokens: string[] = [];
  const perToken: Array<{ token: string; success: boolean }> = [];
  response.responses.forEach((result, index) => {
    perToken.push({ token: dedupedTokens[index], success: result.success });
    if (!result.success && result.error && isPermanentlyInvalidTokenError(result.error.code)) {
      invalidTokens.push(dedupedTokens[index]);
    }
  });

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    invalidTokens,
    perToken,
  };
}
