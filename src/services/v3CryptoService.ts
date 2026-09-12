import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");

// Lazy + memoized: importing this module must never have a side effect that
// can throw (e.g. in a test file that imports a controller for an unrelated
// pure function, with no real key material available — CI has no .pem
// files, correctly gitignored). Reading only happens the first time a
// function below is actually called, and only once per process.
let publicKeyCache: string | undefined;
let privateKeyCache: string | undefined;

function loadPublicKey(): string {
  if (publicKeyCache === undefined) {
    publicKeyCache = fs.readFileSync(
      path.resolve(projectRoot, process.env.RSA_PUBLIC_KEY_PATH || "./public.pem"),
      "utf8"
    );
  }
  return publicKeyCache;
}

function loadPrivateKey(): string {
  if (privateKeyCache === undefined) {
    privateKeyCache = fs.readFileSync(
      path.resolve(projectRoot, process.env.RSA_PRIVATE_KEY_PATH || "./private.pem"),
      "utf8"
    );
  }
  return privateKeyCache;
}

export function getPublicKey(): string {
  return loadPublicKey();
}

// Decrypt proxy_key sent by the app (encrypted with our public key)
export function decryptProxyKey(proxyKey: string): { email: string; password: string } {
  const decrypted = crypto.privateDecrypt(
    { key: loadPrivateKey(), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
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
    { key: loadPrivateKey(), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
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

// Hybrid encrypt-to-self — mirrors decryptData's envelope exactly (RSA-OAEP
// wraps a fresh AES-256-GCM key), using our OWN public key so our own
// private key can read it back later via decryptData. For data we capture
// server-side (e.g. the address collected at signup) that needs to land in
// the same encrypted_data columns/shape the app's own client-encrypted
// payloads already use, so existing decrypt call sites (getSavedAddress)
// work on either source unmodified.
export function encryptData(data: unknown): string {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  const tg = cipher.getAuthTag();

  const ek = crypto.publicEncrypt(
    { key: loadPublicKey(), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    aesKey
  );

  const envelope = {
    ek: ek.toString("base64"),
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tg: tg.toString("base64"),
  };

  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
}
