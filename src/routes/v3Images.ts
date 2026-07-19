import express from "express";
import { proxyImage } from "../controllers/v3ImageProxyController.js";

const router = express.Router();

// Deliberately NOT mounted under v3Routes: this must be a plain, unauthenticated
// GET (an <Image> component can't attach a device_id/user_id session body), so
// it must never pass through v3Session/v3Analytics/v3Cache.
router.get("/v3/images/proxy", proxyImage);

export default router;
