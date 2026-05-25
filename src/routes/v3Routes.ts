import express from "express";
import { deviceCheck } from "../controllers/v3DeviceController.js";
import { authLogin, authLogout, getActiveSessions, forgotPassword, getMe } from "../controllers/v3AuthController.js";
import { getVehicle, selectVehicle, removeVehicle } from "../controllers/v3CarController.js";
import { v3Search } from "../controllers/v3SearchController.js";
import { getCategories, getSubCategories } from "../controllers/v3CategoriesController.js";
import { v3Analytics } from "../middleware/v3AnalyticsMiddleware.js";
import { v3Session } from "../middleware/v3SessionMiddleware.js";
import { v3Cache } from "../middleware/v3CacheMiddleware.js";
import v3ProductsRouter from "./v3Products.js";
import v3CartRouter from "./v3Cart.js";
import v3LastSeenRouter from "./v3LastSeen.js";
import v3LikedRouter from "./v3Liked.js";
import v3OrdersRouter from "./v3Orders.js";

const router = express.Router();

router.use(v3Analytics);
router.use(v3Session);
router.use(v3Cache);
router.use("/", v3ProductsRouter);
router.use("/", v3CartRouter);
router.use("/", v3LastSeenRouter);
router.use("/", v3LikedRouter);
router.use("/", v3OrdersRouter);

// ─── Device ──────────────────────────────────────────────
router.post("/v3/device/check", deviceCheck);

// ─── Auth ────────────────────────────────────────────────
router.post("/v3/auth/login", authLogin);
router.post("/v3/auth/logout", authLogout);
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
