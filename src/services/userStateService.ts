import pkg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pkg.Pool({
  host: process.env.PG_HOST,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DB,
  port: Number(process.env.PG_PORT || 5432),
});

export interface SelectedVehicle {
  id: number;
  ktype: number;
  manufacturer: string;
  shortName: string;
  model: string;
  modelGroup: string;
  constructionStart: string;
  constructionEnd: string | null;
  powerHp: number;
  powerKw: number;
  fuelType: string;
  impulsionType: string;
  constructionType: string;
  cylinderAmount: number;
  cylinderCapacityCcm: number;
  logoUrl: string;
}

export interface UserState {
  selectedVehicle: SelectedVehicle | null;
}

const EMPTY_STATE: UserState = { selectedVehicle: null };

export async function getUserState(uniqueDeviceId: string): Promise<UserState> {
  try {
    const result = await pool.query<{ state: UserState }>(
      `SELECT state FROM user_state WHERE user_id = $1`,
      [uniqueDeviceId],
    );
    return result.rows[0]?.state ?? EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

export async function saveUserState(
  uniqueDeviceId: string,
  state: UserState,
): Promise<void> {
  await pool.query(
    `INSERT INTO user_state (user_id, state)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (user_id)
     DO UPDATE SET state = EXCLUDED.state`,
    [uniqueDeviceId, JSON.stringify(state)],
  );
}

export async function setSelectedVehicle(
  uniqueDeviceId: string,
  vehicle: SelectedVehicle | null,
): Promise<void> {
  const current = await getUserState(uniqueDeviceId);
  await saveUserState(uniqueDeviceId, { ...current, selectedVehicle: vehicle });
}
