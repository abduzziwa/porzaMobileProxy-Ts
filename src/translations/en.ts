import type { TranslationSet } from "./types.js";

const en: TranslationSet = {
  account_created: {
    title: "Welcome to Porza",
    body: () => "Your account has been created successfully.",
  },
  order_created: {
    title: "Order Confirmed",
    body: (p) => `Your order #${p.orderId} has been placed successfully. We'll keep you updated on its status.`,
  },
  order_paid: {
    title: "Payment Received",
    body: (p) => `We've received your payment for order #${p.orderId}. Thank you!`,
  },
  order_cancelled: {
    title: "Order Cancelled",
    body: (p) => `Your order #${p.orderId} has been cancelled.`,
  },
  order_expired: {
    title: "Payment Expired",
    body: (p) => `The payment window for order #${p.orderId} has expired. Please try again or contact support.`,
  },
  order_failed: {
    title: "Payment Failed",
    body: (p) => `We couldn't process payment for order #${p.orderId}. Please try again.`,
  },
  new_device_login: {
    title: "New Login Detected",
    body: () => "Your account was just accessed from a new device. If this wasn't you, please contact support.",
  },
  password_reset_requested: {
    title: "Password Reset Requested",
    body: () => "We received a request to reset your password. If this wasn't you, please contact support.",
  },
};

export default en;
