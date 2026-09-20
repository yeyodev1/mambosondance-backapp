import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";
import catalogAdminRoutes from "./admin/catalog.admin.routes";
import commerceAdminRoutes from "./admin/commerce.admin.routes";

const router = Router();

// Todo /api/admin exige sesión de administración; los sub-routers no repiten el gate.
router.use(authMiddleware, adminMiddleware);

router.use(catalogAdminRoutes);
router.use(commerceAdminRoutes);

export default router;
