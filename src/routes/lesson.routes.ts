import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { optionalAuth } from "../middlewares/optionalAuth.middleware";
import * as lessonController from "../controllers/lesson.controller";

const router = Router();

// Sesión opcional: una lección de muestra se reproduce sin cuenta.
router.get("/:id/playback", optionalAuth, lessonController.playback);
router.post("/:id/complete", authMiddleware, lessonController.complete);

export default router;
