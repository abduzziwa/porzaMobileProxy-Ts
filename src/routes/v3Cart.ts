import express from "express";
import { addToCart, removeFromCart, updateCart, getCart, clearCart } from "../controllers/v3CartController.js";

const router = express.Router();

router.post("/v3/cart/add", addToCart);
router.post("/v3/cart/remove", removeFromCart);
router.post("/v3/cart/update", updateCart);
router.post("/v3/cart/get", getCart);
router.post("/v3/cart/clear", clearCart);

export default router;
