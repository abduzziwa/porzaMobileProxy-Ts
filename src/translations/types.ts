// One entry per event we ever push a notification for. Adding a new
// notification event means adding its key here and to every language file
// below — TypeScript enforces every language stays complete (a language file
// typed as TranslationSet can't skip an event).
export type NotificationEvent =
  | "account_created"
  | "order_created"
  | "order_paid"
  | "order_cancelled"
  | "order_expired"
  | "order_failed"
  | "new_device_login"
  | "password_reset_requested"
  | "account_deletion_requested"
  | "account_reactivated";

export type Lang = "en" | "nl" | "de";

export interface TranslationEntry {
  title: string;
  // A function, not a plain string, so the only per-event variable data we
  // currently need (orderId) can be interpolated without any templating
  // engine — params are just whatever the caller passed to notifyUser().
  body: (params: Record<string, string>) => string;
}

export type TranslationSet = Record<NotificationEvent, TranslationEntry>;
