import { Router } from "express";
import * as promoController from "../controllers/promo.controller";

const router = Router();

router.get("/", promoController.list);

export default router;
