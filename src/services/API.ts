export async function API(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "POST",
  body: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const apiKey = process.env.API_KEY;
  const baseUrl = "https://api.corenio.com/api/v1.0";

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      accept: "*/*",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: method !== "GET" ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as Record<string, unknown>;
}
