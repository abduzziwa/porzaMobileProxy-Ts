import type { TranslationSet } from "./types.js";

const de: TranslationSet = {
  account_created: {
    title: "Willkommen bei Porza",
    body: () => "Dein Konto wurde erfolgreich erstellt.",
  },
  order_created: {
    title: "Bestellung bestätigt",
    body: (p) => `Deine Bestellung #${p.orderId} wurde erfolgreich aufgegeben. Wir halten dich über den Status auf dem Laufenden.`,
  },
  order_paid: {
    title: "Zahlung erhalten",
    body: (p) => `Wir haben deine Zahlung für Bestellung #${p.orderId} erhalten. Vielen Dank!`,
  },
  order_cancelled: {
    title: "Bestellung storniert",
    body: (p) => `Deine Bestellung #${p.orderId} wurde storniert.`,
  },
  order_expired: {
    title: "Zahlung abgelaufen",
    body: (p) => `Das Zahlungsfenster für Bestellung #${p.orderId} ist abgelaufen. Bitte versuche es erneut oder kontaktiere den Support.`,
  },
  order_failed: {
    title: "Zahlung fehlgeschlagen",
    body: (p) => `Wir konnten die Zahlung für Bestellung #${p.orderId} nicht verarbeiten. Bitte versuche es erneut.`,
  },
  new_device_login: {
    title: "Neue Anmeldung erkannt",
    body: () => "Auf dein Konto wurde gerade von einem neuen Gerät aus zugegriffen. Falls du das nicht warst, kontaktiere bitte den Support.",
  },
  password_reset_requested: {
    title: "Passwort-Zurücksetzung angefordert",
    body: () => "Wir haben eine Anfrage zum Zurücksetzen deines Passworts erhalten. Falls du das nicht warst, kontaktiere bitte den Support.",
  },
  account_deletion_requested: {
    title: "Kontolöschung angefordert",
    body: () => "Wir haben eine Anfrage zur Löschung deines Kontos erhalten. Falls du das nicht warst, kontaktiere bitte sofort den Support.",
  },
  account_reactivated: {
    title: "Konto reaktiviert",
    body: () => "Deine Anfrage zur Kontolöschung wurde storniert und dein Konto ist wieder aktiv. Willkommen zurück!",
  },
};

export default de;
