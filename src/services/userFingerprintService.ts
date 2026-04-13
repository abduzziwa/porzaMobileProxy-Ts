// import pgClient from "./db.js";
// import crypto from "crypto";
// import dotenv from "dotenv";

// dotenv.config();

// const SECRET_BASE = process.env.ENCRYPTION_KEY || "porza1app";
// const ENCRYPTION_KEY = crypto.createHash("sha256").update(SECRET_BASE).digest();
// const IV_LENGTH = 16;

// /**
//  * Deterministic encryption — same input always produces same output.
//  * IV is derived from key + text so matching across rows is possible.
//  */
// function encrypt(text: string): string {
//   // Derive IV deterministically from key + text (no randomness)
//   const iv = crypto
//     .createHash("md5")
//     .update(ENCRYPTION_KEY)
//     .update(text)
//     .digest();
//   const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
//   let encrypted = cipher.update(text);
//   encrypted = Buffer.concat([encrypted, cipher.final()]);
//   return iv.toString("hex") + ":" + encrypted.toString("hex");
// }

// /**
//  * Decryption — unchanged, still works with stored IV prefix.
//  */
// function decrypt(text: string): string {
//   try {
//     const [ivPart, encryptedPart] = text.split(":");
//     const iv = Buffer.from(ivPart, "hex");
//     const encryptedText = Buffer.from(encryptedPart, "hex");
//     const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
//     let decrypted = decipher.update(encryptedText);
//     decrypted = Buffer.concat([decrypted, decipher.final()]);
//     return decrypted.toString();
//   } catch {
//     return "Decryption Error";
//   }
// }

// interface UpsertParams {
//   udi?: string;
//   ene?: string;
//   cid?: string;
//   address?: object;
//   isLoggedIn?: boolean;
//   isLive?: boolean;
//   selectedCar?: string;
//   isInit?: boolean;
// }

// export async function update_or_insert_in_column(params: UpsertParams) {
//   const { udi, ene, cid, address, isLoggedIn, isLive, selectedCar, isInit = false } = params;

//   const encEmail = ene ? encrypt(ene) : null;
//   const encAddress = address ? encrypt(JSON.stringify(address)) : null;

//   if (isInit) {
//     if (!udi) throw new Error("udi required for Init");
//     const query = `
//       INSERT INTO app_user_state (unique_device_id, encrypted_email, cart_id, encrypted_address, is_logged_in, is_live, selected_car)
//       VALUES ($1, $2, $3, $4, $5, $6, $7)
//       ON CONFLICT (unique_device_id) DO UPDATE SET last_updated_at = NOW() RETURNING *;
//     `;
//     const res = await pgClient.query(query, [udi, encEmail, cid, encAddress, isLoggedIn ?? false, isLive ?? false, selectedCar]);
//     return res.rows[0];
//   } else {
//     const query = `
//       UPDATE app_user_state SET
//         encrypted_email = COALESCE($1, encrypted_email),
//         cart_id = COALESCE($2, cart_id),
//         encrypted_address = COALESCE($3, encrypted_address),
//         is_logged_in = COALESCE($4, is_logged_in),
//         is_live = COALESCE($5, is_live),
//         selected_car = COALESCE($6, selected_car),
//         last_updated_at = NOW()
//       WHERE unique_device_id = $7 OR encrypted_email = $1 OR cart_id = $2
//       RETURNING *;
//     `;
//     const res = await pgClient.query(query, [encEmail, cid, encAddress, isLoggedIn, isLive, selectedCar, udi]);
//     return res.rows[0];
//   }
// }

// export async function get_user_data(searchId: string) {
//   const query = `
//     SELECT * FROM app_user_state
//     WHERE unique_device_id = $1 OR cart_id = $1 OR encrypted_email = $1
//   `;
//   const res = await pgClient.query(query, [searchId]);
//   if (res.rows.length === 0) return null;
//   const row = res.rows[0];
//   return {
//     ...row,
//     email: row.encrypted_email ? decrypt(row.encrypted_email) : null,
//     address: row.encrypted_address ? JSON.parse(decrypt(row.encrypted_address)) : null,
//   };
// }

// schoool
import pgClient from "./db.js";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const SECRET_BASE = process.env.ENCRYPTION_KEY || "porza1app";
const ENCRYPTION_KEY = crypto.createHash("sha256").update(SECRET_BASE).digest();
const IV_LENGTH = 16;

/**
 * Deterministic encryption — same input always produces same output.
 * IV is derived from key + text so matching across rows is possible.
 */
export function encrypt(text: string): string {
  // Derive IV deterministically from key + text (no randomness)
  const iv = crypto
    .createHash("md5")
    .update(ENCRYPTION_KEY)
    .update(text)
    .digest();
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

/**
 * Decryption — unchanged, still works with stored IV prefix.
 */
export function decrypt(text: string): string {
  try {
    const [ivPart, encryptedPart] = text.split(":");
    const iv = Buffer.from(ivPart, "hex");
    const encryptedText = Buffer.from(encryptedPart, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch {
    return "Decryption Error";
  }
}

interface UpsertParams {
  udi?: string;
  ene?: string;
  cid?: string;
  address?: object;
  isLoggedIn?: boolean;
  isLive?: boolean;
  selectedCar?: string;
  isInit?: boolean;
  pwd?: string; // raw password — will be encrypted and stored in pass_wd column
}

export async function update_or_insert_in_column(params: UpsertParams) {
  const { udi, ene, cid, address, isLoggedIn, isLive, selectedCar, isInit = false, pwd } = params;

  const encEmail = ene ? encrypt(ene) : null;
  const encAddress = address ? encrypt(JSON.stringify(address)) : null;
  const encPassword = pwd ? encrypt(pwd) : null;

  if (isInit) {
    if (!udi) throw new Error("udi required for Init");
    const query = `
      INSERT INTO app_user_state (unique_device_id, encrypted_email, cart_id, encrypted_address, is_logged_in, is_live, selected_car)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (unique_device_id) DO UPDATE SET last_updated_at = NOW() RETURNING *;
    `;
    const res = await pgClient.query(query, [udi, encEmail, cid, encAddress, isLoggedIn ?? false, isLive ?? false, selectedCar]);
    return res.rows[0];
  } else {
    const query = `
      UPDATE app_user_state SET
        encrypted_email = COALESCE($1, encrypted_email),
        cart_id = COALESCE($2, cart_id),
        encrypted_address = COALESCE($3, encrypted_address),
        is_logged_in = COALESCE($4, is_logged_in),
        is_live = COALESCE($5, is_live),
        selected_car = COALESCE($6, selected_car),
        pass_wd = COALESCE($8, pass_wd),
        last_updated_at = NOW()
      WHERE unique_device_id = $7 OR encrypted_email = $1 OR cart_id = $2
      RETURNING *;
    `;
    const res = await pgClient.query(query, [encEmail, cid, encAddress, isLoggedIn, isLive, selectedCar, udi, encPassword]);
    return res.rows[0];
  }
}

export async function get_user_data(searchId: string) {
  const query = `
    SELECT * FROM app_user_state
    WHERE unique_device_id = $1 OR cart_id = $1 OR encrypted_email = $1
  `;
  const res = await pgClient.query(query, [searchId]);
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    ...row,
    email: row.encrypted_email ? decrypt(row.encrypted_email) : null,
    address: row.encrypted_address ? JSON.parse(decrypt(row.encrypted_address)) : null,
  };
}