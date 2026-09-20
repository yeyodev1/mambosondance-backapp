import { Router } from "express";
import * as teacherController from "../controllers/teacher.controller";

const router = Router();

router.get("/", teacherController.list);

export default router;
