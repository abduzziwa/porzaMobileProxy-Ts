import express from "express";
import { deviceCheck, registerPushToken, removePushToken, updateDeviceLanguage } from "../controllers/v3DeviceController.js";
import { authLogin, authSignup, authLogout, getActiveSessions, forgotPassword, getMe, deleteAccount, reactivateAccount } from "../controllers/v3AuthController.js";
import { getVehicle, selectVehicle, removeVehicle } from "../controllers/v3CarController.js";
import { v3Search } from "../controllers/v3SearchController.js";
import { getCategories, getSubCategories } from "../controllers/v3CategoriesController.js";
import { getPrivacyPolicy } from "../controllers/v3LegalController.js";
import { v3Analytics } from "../middleware/v3AnalyticsMiddleware.js";
import { v3Session } from "../middleware/v3SessionMiddleware.js";
import { v3ImageTransform } from "../middleware/v3ImageTransformMiddleware.js";
import { v3Cache } from "../middleware/v3CacheMiddleware.js";
import v3ProductsRouter from "./v3Products.js";
import v3CartRouter from "./v3Cart.js";
import v3LastSeenRouter from "./v3LastSeen.js";
import v3LikedRouter from "./v3Liked.js";
import v3OrdersRouter from "./v3Orders.js";
import v3NotificationsRouter from "./v3Notifications.js";

const router = express.Router();

router.use(v3Analytics);
router.use(v3Session);
router.use(v3ImageTransform);
router.use(v3Cache);
router.use("/", v3ProductsRouter);
router.use("/", v3CartRouter);
router.use("/", v3LastSeenRouter);
router.use("/", v3LikedRouter);
router.use("/", v3OrdersRouter);
router.use("/", v3NotificationsRouter);

// ─── Device ──────────────────────────────────────────────
router.post("/v3/device/check", deviceCheck);
router.post("/v3/device/push-token", registerPushToken);
router.delete("/v3/device/push-token", removePushToken);
router.post("/v3/device/language", updateDeviceLanguage);

// ─── Legal ───────────────────────────────────────────────
// GET, not POST — needs to open directly in a browser/webview from a link/
// button, same as every other privacy-policy link on the internet.
router.get("/v3/legal/privacy-policy", getPrivacyPolicy);

// ─── Auth ────────────────────────────────────────────────
router.post("/v3/auth/login", authLogin);
router.post("/v3/auth/signup", authSignup);
router.post("/v3/auth/logout", authLogout);
// Not in EXEMPT_PATHS or GUEST_OK_PATHS on purpose — v3Session's default
// path (full authorised-session check) is exactly the security bar this
// needs: only a currently logged-in account can delete itself.
router.post("/v3/auth/delete-account", deleteAccount);
// EXEMPT (see v3SessionMiddleware) — a deleted account has no valid session
// left to check; this re-verifies identity via credentials instead, the
// same way login itself does.
router.post("/v3/auth/reactivate-account", reactivateAccount);
router.post("/v3/auth/sessions", getActiveSessions);
router.post("/v3/auth/me", getMe);
router.post("/v3/auth/forgot-password", forgotPassword);

// ─── Search ──────────────────────────────────────────────
router.post("/v3/search", v3Search);

// ─── Categories ──────────────────────────────────────────
router.post("/v3/categories", getCategories);
router.post("/v3/categories/sub", getSubCategories);

// ─── Car ─────────────────────────────────────────────────
router.post("/v3/car/get", getVehicle);
router.post("/v3/car/select", selectVehicle);
router.post("/v3/car/remove", removeVehicle);

export default router;
