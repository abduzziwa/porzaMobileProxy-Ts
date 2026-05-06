import express from "express";
import { toggleLiked, getLiked, checkLiked } from "../controllers/v3LikedController.js";

const router = express.Router();

router.post("/v3/liked/toggle", toggleLiked);
router.post("/v3/liked/get", getLiked);
router.post("/v3/liked/check", checkLiked);

export default router;
