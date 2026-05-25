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

// Hybrid decrypt — RSA-OAEP unwraps the AES key, AES-256-GCM decrypts the payload
// Envelope: Base64( JSON { ek, iv, ct, tg } )
export function decryptData<T = Record<string, unknown>>(encrypted: string): T {
  const envelope = JSON.parse(Buffer.from(encrypted, "base64").toString("utf8")) as {
    ek: string;
    iv: string;
    ct: string;
    tg: string;
  };

  const aesKey = crypto.privateDecrypt(
    { key: PRIVATE_KEY, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(envelope.ek, "base64")
  );

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    aesKey,
    Buffer.from(envelope.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(envelope.tg, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.ct, "base64")),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(decrypted) as T;
}
