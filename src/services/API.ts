import { corenioHeaders } from "./v3CoreniService.js";

export async function API(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "POST",
  body: Record<string, unknown> = {},
  userToken?: string | null,
): Promise<Record<string, unknown>> {
  const baseUrl = "https://api.corenio.com/api/v1.0";

  console.log(`[Corenio] -> ${method} ${endpoint}`);

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      accept: "*/*",
      "Content-Type": "application/json",
      ...corenioHeaders(userToken),
    },
    body: method !== "GET" ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[Corenio] <- ${response.status} ${method} ${endpoint}`, errorBody);
    throw new Error(`API error: ${response.status} ${response.statusText} — ${errorBody}`);
  }

  console.log(`[Corenio] <- ${response.status} ${method} ${endpoint}`);
  return (await response.json()) as Record<string, unknown>;
}
