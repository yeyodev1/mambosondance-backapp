import { Router } from "express";
import * as eventController from "../controllers/event.controller";

const router = Router();

router.get("/", eventController.list);
router.get("/:slug", eventController.getBySlug);

export default router;
