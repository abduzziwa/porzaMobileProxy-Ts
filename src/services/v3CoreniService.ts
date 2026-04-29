import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.CORENIO_BASE_URL || "https://api.corenio.com";
const API_KEY = process.env.CORENIO_API_KEY || process.env.API_KEY || "";


const corenioClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  },
});

export interface CorenioLoginResult {
  token: string;
  user_id: number;
}

export interface CorenioRefreshResult {
  token: string;
  expires_in: number;
}

export async function corenioLogin(username: string, password: string): Promise<CorenioLoginResult> {
  const res = await corenioClient.post<CorenioLoginResult>("/api/v1.0/users/auth/login", { username, password });
  if (!res.data || !(res.data as unknown as Record<string, unknown>).token) {
    throw Object.assign(new Error("invalid_credentials"), { isInvalidCredentials: true });
  }
  return res.data;
}

export async function corenioRefresh(token: string): Promise<CorenioRefreshResult> {
  const res = await corenioClient.post<CorenioRefreshResult>(
    "/api/v1.0/users/auth/refresh",
    {},
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data;
}

export async function corenioLogout(token: string): Promise<void> {
  await corenioClient.post(
    "/api/v1.0/users/auth/logout",
    {},
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

export async function corenioWhoami(token: string): Promise<{ user_id: number; email: string; firstname: string; lastname: string }> {
  const res = await corenioClient.post<{ user_id: number; email: string; firstname: string; lastname: string }>(
    "/api/v1.0/users/auth/whoami",
    {},
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data;
}

export async function corenioForgotPassword(email: string): Promise<void> {
  await corenioClient.post("/api/v1.0/users/auth/forgot-password", { email });
}

export interface RawCategory {
  id: number;
  name: string;
  seo_path: string;
  image?: { url_thumb?: string };
}

export async function fetchCategoriesByParent(parentId: number, language: string): Promise<RawCategory[]> {
  const res = await corenioClient.post<Record<string, unknown>>("/api/v1.0/categories/byParent", {
    parent_id: parentId,
    language,
    page: 1,
    limit: 100,
  });
  return Object.values(res.data).filter(
    (item): item is RawCategory =>
      typeof item === "object" && item !== null && !!(item as RawCategory).id
  );
}
