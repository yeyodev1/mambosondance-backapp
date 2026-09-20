import { Router } from "express";
import * as adminProductController from "../../controllers/admin-product.controller";
import * as adminContentController from "../../controllers/admin-content.controller";
import * as adminEventController from "../../controllers/admin-event.controller";
import * as adminTeacherController from "../../controllers/admin-teacher.controller";
import * as adminPromoController from "../../controllers/admin-promo.controller";
import * as adminUploadController from "../../controllers/admin-upload.controller";
import * as adminSettingsController from "../../controllers/admin-settings.controller";

// Sin auth aquí: admin.routes.ts ya aplica authMiddleware + adminMiddleware a todo /admin.
const router = Router();

// Productos
router.get("/products", adminProductController.list);
router.post("/products", adminProductController.create);
router.get("/products/:id", adminProductController.get);
router.put("/products/:id", adminProductController.update);
router.delete("/products/:id", adminProductController.remove);

// Contenido de cursos
router.post("/products/:id/modules", adminContentController.createModule);
router.put("/products/:id/reorder", adminContentController.reorder);
router.put("/modules/:id", adminContentController.updateModule);
router.delete("/modules/:id", adminContentController.deleteModule);
router.post("/modules/:id/lessons", adminContentController.createLesson);
router.put("/lessons/:id", adminContentController.updateLesson);
router.delete("/lessons/:id", adminContentController.deleteLesson);
router.post("/lessons/:id/video-upload", adminContentController.videoUpload);
router.post("/lessons/:id/video-sync", adminContentController.videoSync);

// Imágenes (multipart, campo "file")
router.post(
  "/uploads/image",
  adminUploadController.receiveImage,
  adminUploadController.uploadImage,
);

// Eventos
router.get("/events", adminEventController.list);
router.post("/events", adminEventController.create);
router.get("/events/:id", adminEventController.get);
router.put("/events/:id", adminEventController.update);
router.delete("/events/:id", adminEventController.remove);

// Profesores
router.get("/teachers", adminTeacherController.list);
router.post("/teachers", adminTeacherController.create);
router.put("/teachers/:id", adminTeacherController.update);
router.delete("/teachers/:id", adminTeacherController.remove);

// Promos
router.get("/promos", adminPromoController.list);
router.post("/promos", adminPromoController.create);
router.put("/promos/:id", adminPromoController.update);
router.delete("/promos/:id", adminPromoController.remove);

// Ajustes
router.get("/settings", adminSettingsController.get);
router.put("/settings", adminSettingsController.update);

export default router;
