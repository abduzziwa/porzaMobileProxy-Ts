import express, { type Request, type Response, type NextFunction } from "express";
import { deviceCheck } from "../controllers/v3DeviceController.js";
import { authLogin, forgotPassword } from "../controllers/v3AuthController.js";
import { getVehicle, selectVehicle, removeVehicle } from "../controllers/v3CarController.js";
import { v3Search } from "../controllers/v3SearchController.js";
import { v3Analytics } from "../middleware/v3AnalyticsMiddleware.js";
import v3Pool from "../db/v3Client.js";

const router = express.Router();

router.use(v3Analytics);

async function validateSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { device_id, user_id } = req.body as { device_id?: string; user_id?: number };

  if (!device_id || !user_id) {
    res.status(400).json({ error: "Missing device_id or user_id" });
    return;
  }

  try {
    const result = await v3Pool.query(
      `SELECT 1 FROM v3_device_sessions WHERE device_id = $1 AND user_id = $2 AND authorised = true`,
      [device_id, user_id]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: "Unauthorised" });
      return;
    }

    next();
  } catch (err) {
    console.error("[validateSession] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ─── Device ──────────────────────────────────────────────
router.post("/v3/device/check", deviceCheck);

// ─── Auth ────────────────────────────────────────────────
router.post("/v3/auth/login", authLogin);
router.post("/v3/auth/forgot-password", forgotPassword);

// ─── Search ──────────────────────────────────────────────
router.post("/v3/search", v3Search);

// ─── Car ─────────────────────────────────────────────────
router.post("/v3/car/get", validateSession, getVehicle);
router.post("/v3/car/select", validateSession, selectVehicle);
router.post("/v3/car/remove", validateSession, removeVehicle);

export default router;
