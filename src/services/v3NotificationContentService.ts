const MAX_LENGTH = 220;

const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function decodeEntities(input: string): string {
  return input.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (match) => HTML_ENTITIES[match] ?? match);
}

// Converts email HTML (as used by Corenio's outbound emails) into a short,
// notification-safe plain-text body. No DOM/browser dependency — regex only.
export function htmlToNotificationText(html: string): string {
  let text = html;

  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  text = text.replace(/\s+/g, " ").trim();

  if (text.length > MAX_LENGTH) {
    text = text.slice(0, MAX_LENGTH).trimEnd() + "…";
  }

  return text;
}
