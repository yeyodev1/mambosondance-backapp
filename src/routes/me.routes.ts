import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as meController from "../controllers/me.controller";

const router = Router();

router.use(authMiddleware);

router.get("/courses", meController.courses);
router.get("/courses/:slug", meController.course);
router.get("/tickets", meController.tickets);
router.get("/loyalty", meController.loyalty);

export default router;
