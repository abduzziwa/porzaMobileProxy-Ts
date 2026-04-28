import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");

const PUBLIC_KEY = fs.readFileSync(
  path.resolve(projectRoot, process.env.RSA_PUBLIC_KEY_PATH || "./public.pem"),
  "utf8"
);

const PRIVATE_KEY = fs.readFileSync(
  path.resolve(projectRoot, process.env.RSA_PRIVATE_KEY_PATH || "./private.pem"),
  "utf8"
);

export function getPublicKey(): string {
  return PUBLIC_KEY;
}

// Decrypt proxy_key sent by the app (encrypted with our public key)
export function decryptProxyKey(proxyKey: string): { email: string; password: string } {
  const decrypted = crypto.privateDecrypt(
    { key: PRIVATE_KEY, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(proxyKey, "base64")
  ).toString("utf8");
  return JSON.parse(decrypted) as { email: string; password: string };
}
