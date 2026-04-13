import type { Request, Response } from "express";
import { API } from "../services/API.js";
import pgClient from "../services/db.js";

const BASE_URL = process.env.SERVER_URL ?? "";

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

// ── Save vehicle to app_user_state ────────────────────────────
async function saveVehicle(uniqueDeviceId: string, vehicle: SelectedVehicle | null): Promise<void> {
  await pgClient.query(
    `UPDATE app_user_state
     SET selected_car = $2,
         last_updated_at = NOW()
     WHERE unique_device_id = $1`,
    [uniqueDeviceId, vehicle ? JSON.stringify(vehicle) : null]
  );
}

// ── POST /v2/car/select ───────────────────────────────────────
export async function selectCar(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, licencePlate } = req.body as Record<string, string>;

    if (!uniqueDeviceId) return res.status(400).json({ success: false, error: "Missing uniqueDeviceId" });
    if (!licencePlate) return res.status(400).json({ success: false, error: "Missing licencePlate" });

    const result = await API("/vehicles/search", "POST", {
      filters: { licenseplates: [licencePlate.trim().toUpperCase()] },
      language: "en",
      page: 1,
      limit: 10,
    });

    if (!result.success || !result.vehicles) {
      return res.status(200).json({ success: false, carFound: false, data: null });
    }

    const vehicles = result.vehicles as Record<string, Record<string, unknown>>;
    const keys = Object.keys(vehicles);

    if (keys.length === 0) {
      return res.status(200).json({ success: false, carFound: false, data: null });
    }

    const v = vehicles[keys[0]];
    const model = v.model as Record<string, unknown>;
    const manufacturer = (v.manufacturer as string) ?? "";
    const slug = manufacturer.toLowerCase().trim().replace(/\s+/g, "-");
    const logoUrl = `${BASE_URL}/public/carlogos/thumb/${slug}.png`;

    const vehicle: SelectedVehicle = {
      id: v.id as number,
      ktype: v.ktype as number,
      manufacturer,
      shortName: (v.short_name as string) ?? "",
      model: (model.model as string) ?? "",
      modelGroup: (model.model_group as string) ?? "",
      constructionStart: (v.construction_start as string) ?? "",
      constructionEnd: (v.construction_end as string | null) ?? null,
      powerHp: (v.power_hp as number) ?? 0,
      powerKw: (v.power_kw as number) ?? 0,
      fuelType: (v.fueltype as string) ?? "",
      impulsionType: (v.impulsion_type as string) ?? "",
      constructionType: (v.construction_type as string) ?? "",
      cylinderAmount: (v.cylinder_amount as number) ?? 0,
      cylinderCapacityCcm: (v.cylinder_capacity_ccm as number) ?? 0,
      logoUrl,
    };

    await saveVehicle(uniqueDeviceId, vehicle);
    console.log(`[selectCar] Saved vehicle ktype=${vehicle.ktype} for ${uniqueDeviceId}`);

    return res.status(200).json({ success: true, carFound: true, data: vehicle });
  } catch (err) {
    console.error("[selectCar] Error:", (err as Error).message);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}

// ── POST /v2/car/remove ───────────────────────────────────────
export async function removeSelectedCar(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId } = req.body as Record<string, string>;
    if (!uniqueDeviceId) return res.status(400).json({ success: false, error: "Missing uniqueDeviceId" });

    await saveVehicle(uniqueDeviceId, null);
    console.log(`[removeSelectedCar] Cleared vehicle for ${uniqueDeviceId}`);

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}

// ── POST /v2/car/get ──────────────────────────────────────────
export async function getSelectedCar(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId } = req.body as Record<string, string>;
    if (!uniqueDeviceId) return res.status(400).json({ success: false, error: "Missing uniqueDeviceId" });

    const result = await pgClient.query<{ selected_car: SelectedVehicle | null }>(
      `SELECT selected_car FROM app_user_state WHERE unique_device_id = $1`,
      [uniqueDeviceId]
    );

    const vehicle = result.rows[0]?.selected_car ?? null;

    return res.status(200).json({
      success: true,
      carFound: !!vehicle,
      data: vehicle,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}