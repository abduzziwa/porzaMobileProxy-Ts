import express from "express";
import { searchProducts, getProductsData, getProductsFilters } from "../controllers/v3ProductsController.js";

const router = express.Router();

// ─── Products ─────────────────────────────────────────────
router.post("/v3/products", searchProducts);
router.post("/v3/products/data", getProductsData);
router.post("/v3/products/filters", getProductsFilters);

export default router;
