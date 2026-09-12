import en from "./en.js";
import nl from "./nl.js";
import de from "./de.js";
import type { NotificationEvent, Lang, TranslationSet } from "./types.js";

export type { NotificationEvent, Lang };

const TRANSLATIONS: Record<Lang, TranslationSet> = { en, nl, de };
const SUPPORTED_LANGUAGES: Lang[] = ["en", "nl", "de"];

// Pure local lookup — no translation API, no network call. Adding a
// language means adding one file (copy this module's shape) and listing it
// here; adding an event means adding it to types.ts and every language file
// (TypeScript will point at whichever ones are now missing it).
export function translate(
  event: NotificationEvent,
  language: string | null,
  params: Record<string, string> = {}
): { title: string; body: string } {
  const lang: Lang = SUPPORTED_LANGUAGES.includes(language as Lang) ? (language as Lang) : "en";
  const entry = TRANSLATIONS[lang][event];
  return { title: entry.title, body: entry.body(params) };
}
