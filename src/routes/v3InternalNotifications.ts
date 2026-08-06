import express from "express";
import { emailCopyNotification } from "../controllers/v3InternalNotificationsController.js";
import { v3InternalAuthMiddleware } from "../middleware/v3InternalAuthMiddleware.js";

const router = express.Router();

// Deliberately NOT mounted under v3Routes: this is a service-to-service route called
// by Corenio, not the app, so it must never pass through v3Analytics/v3Session/
// v3ImageTransform/v3Cache or any end-user authentication.
router.post("/v1/internal/notifications/email-copy", v3InternalAuthMiddleware, emailCopyNotification);

export default router;
