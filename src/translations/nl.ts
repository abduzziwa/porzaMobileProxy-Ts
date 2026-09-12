import type { TranslationSet } from "./types.js";

const nl: TranslationSet = {
  account_created: {
    title: "Welkom bij Porza",
    body: () => "Je account is succesvol aangemaakt.",
  },
  order_created: {
    title: "Bestelling bevestigd",
    body: (p) => `Je bestelling #${p.orderId} is succesvol geplaatst. We houden je op de hoogte van de status.`,
  },
  order_paid: {
    title: "Betaling ontvangen",
    body: (p) => `We hebben je betaling voor bestelling #${p.orderId} ontvangen. Bedankt!`,
  },
  order_cancelled: {
    title: "Bestelling geannuleerd",
    body: (p) => `Je bestelling #${p.orderId} is geannuleerd.`,
  },
  order_expired: {
    title: "Betaling verlopen",
    body: (p) => `De betalingstermijn voor bestelling #${p.orderId} is verlopen. Probeer het opnieuw of neem contact op met support.`,
  },
  order_failed: {
    title: "Betaling mislukt",
    body: (p) => `We konden de betaling voor bestelling #${p.orderId} niet verwerken. Probeer het opnieuw.`,
  },
  new_device_login: {
    title: "Nieuwe inlog gedetecteerd",
    body: () => "Er is zojuist ingelogd op je account vanaf een nieuw apparaat. Als jij dit niet was, neem dan contact op met support.",
  },
  password_reset_requested: {
    title: "Wachtwoord reset aangevraagd",
    body: () => "We hebben een verzoek ontvangen om je wachtwoord opnieuw in te stellen. Als jij dit niet was, neem dan contact op met support.",
  },
};

export default nl;
