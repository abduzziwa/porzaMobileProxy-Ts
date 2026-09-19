import type { Request, Response } from "express";
import v3Pool from "../db/v3Client.js";
import { searchVehicleByPlate } from "../services/v3CoreniService.js";
import dotenv from "dotenv";

dotenv.config();

const SERVER_URL = process.env.SERVER_URL ?? "";

interface SelectedVehicle {
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

function transformVehicle(v: Record<string, unknown>): SelectedVehicle {
  const model = v.model as Record<string, unknown>;
  const manufacturer = (v.manufacturer as string) ?? "";
  const slug = manufacturer.toLowerCase().trim().replace(/\s+/g, "-");

  return {
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
    logoUrl: `${SERVER_URL}/public/carlogos/thumb/${slug}.png`,
  };
}

export async function getVehicle(req: Request, res: Response): Promise<Response> {
  const { device_id, user_id = null } = req.body as { device_id: string; user_id?: number | null };

  try {
    const result = user_id != null
      ? await v3Pool.query<{ selected_car: SelectedVehicle | null }>(
          `SELECT selected_car FROM v3_device_vehicles WHERE device_id = $1 AND user_id = $2`,
          [device_id, user_id]
        )
      : await v3Pool.query<{ selected_car: SelectedVehicle | null }>(
          `SELECT selected_car FROM v3_device_vehicles WHERE device_id = $1 AND user_id IS NULL`,
          [device_id]
        );

    const car = result.rows[0]?.selected_car ?? null;
    return res.json({ success: true, carFound: !!car, data: car });
  } catch (err) {
    console.error("[getVehicle] Error:", (err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function selectVehicle(req: Request, res: Response): Promise<Response> {
  const { device_id, user_id = null, licencePlate, licence_plate, country } = req.body as {
    device_id: string;
    user_id?: number | null;
    licencePlate?: string;
    licence_plate?: string;
    country?: string;
  };

  const plate = licencePlate ?? licence_plate;
  if (!plate) return res.status(400).json({ error: "Missing licencePlate" });

  try {
    const vehicles = await searchVehicleByPlate(plate.trim().toUpperCase(), country ?? "nl", req.corenioToken);

    console.log("[selectVehicle] Corenio response:", JSON.stringify(vehicles));
    const keys = Object.keys(vehicles);

    if (keys.length === 0) {
      return res.json({ success: true, carFound: false, data: null });
    }

    const vehicle = transformVehicle(vehicles[keys[0]]);

    if (user_id != null) {
      await v3Pool.query(
        `INSERT INTO v3_device_vehicles (device_id, user_id, selected_car, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (device_id, user_id) DO UPDATE SET
           selected_car = EXCLUDED.selected_car,
           updated_at   = NOW()`,
        [device_id, user_id, JSON.stringify(vehicle)]
      );
    } else {
      await v3Pool.query(
        `INSERT INTO v3_device_vehicles (device_id, user_id, selected_car, updated_at)
         VALUES ($1, NULL, $2, NOW())
         ON CONFLICT (device_id) WHERE user_id IS NULL DO UPDATE SET
           selected_car = EXCLUDED.selected_car,
           updated_at   = NOW()`,
        [device_id, JSON.stringify(vehicle)]
      );
    }

    return res.json({ success: true, carFound: true, data: vehicle });
  } catch (err) {
    console.error("[selectVehicle] Error:", (err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function removeVehicle(req: Request, res: Response): Promise<Response> {
  const { device_id, user_id = null } = req.body as { device_id: string; user_id?: number | null };

  try {
    if (user_id != null) {
      await v3Pool.query(
        `UPDATE v3_device_vehicles SET selected_car = NULL, updated_at = NOW()
         WHERE device_id = $1 AND user_id = $2`,
        [device_id, user_id]
      );
    } else {
      await v3Pool.query(
        `UPDATE v3_device_vehicles SET selected_car = NULL, updated_at = NOW()
         WHERE device_id = $1 AND user_id IS NULL`,
        [device_id]
      );
    }
    return res.json({ success: true, carFound: false, data: null });
  } catch (err) {
    console.error("[removeVehicle] Error:", (err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ error: "Internal server error" });
  }
}
