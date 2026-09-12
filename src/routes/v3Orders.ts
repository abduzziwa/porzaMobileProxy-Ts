import express from "express";
import { createOrder, getProxyOrderList, getProxyOrderDetail, getGuestOrderDetail, getSavedAddress, getShippingOptions, getOrderPublicKey, requestPaymentLink, getPaymentStatus, getOrderPdf, getGuestOrderPdf } from "../controllers/v3OrdersController.js";

const router = express.Router();

router.post("/v3/orders/create", createOrder);
// Aliases: the real app still calls the pre-"proxy-" paths in some builds —
// route them to the same live-Corenio-backed handlers, never back to the
// old DB-only versions.
router.post("/v3/orders/list", getProxyOrderList);
router.post("/v3/orders/detail", getProxyOrderDetail);
router.post("/v3/orders/proxy-list", getProxyOrderList);
router.post("/v3/orders/proxy-detail", getProxyOrderDetail);
router.post("/v3/orders/guest-detail", getGuestOrderDetail);
router.post("/v3/orders/pay", requestPaymentLink);
router.post("/v3/orders/payment-status", getPaymentStatus);
router.post("/v3/orders/pdf", getOrderPdf);
router.post("/v3/orders/guest-pdf", getGuestOrderPdf);
router.post("/v3/address/get", getSavedAddress);
router.post("/v3/shipping/options", getShippingOptions);
router.post("/v3/order/getPublicKey", getOrderPublicKey);

export default router;
