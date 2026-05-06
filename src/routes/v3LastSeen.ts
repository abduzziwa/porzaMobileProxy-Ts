import express from "express";
import { addLastSeen, getLastSeen } from "../controllers/v3LastSeenController.js";

const router = express.Router();

router.post("/v3/last-seen/add", addLastSeen);
router.post("/v3/last-seen/get", getLastSeen);

export default router;
