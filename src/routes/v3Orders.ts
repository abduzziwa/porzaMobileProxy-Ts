import express from "express";
import { createOrder, getOrders, getOrderDetail, getProxyOrderList, getProxyOrderDetail, getSavedAddress, getShippingOptions, getOrderPublicKey } from "../controllers/v3OrdersController.js";

const router = express.Router();

router.post("/v3/orders/create", createOrder);
router.post("/v3/orders/list", getOrders);
router.post("/v3/orders/detail", getOrderDetail);
router.post("/v3/orders/proxy-list", getProxyOrderList);
router.post("/v3/orders/proxy-detail", getProxyOrderDetail);
router.post("/v3/address/get", getSavedAddress);
router.post("/v3/shipping/options", getShippingOptions);
router.post("/v3/order/getPublicKey", getOrderPublicKey);

export default router;
