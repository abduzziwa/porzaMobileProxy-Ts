import express from "express";
import {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  getNotificationDetail,
} from "../controllers/v3NotificationsController.js";

const router = express.Router();

// Mounted under v3Routes — inherits v3Session, which validates user_id against
// an authorised device session before any of these run. Not in GUEST_OK_PATHS:
// guests get 401 here by design, notification history is authenticated-only.
router.post("/v3/notifications/list", listNotifications);
router.post("/v3/notifications/unread-count", getUnreadCount);
router.post("/v3/notifications/read", markNotificationRead);
router.post("/v3/notifications/read-all", markAllNotificationsRead);
router.post("/v3/notifications/detail", getNotificationDetail);

export default router;
