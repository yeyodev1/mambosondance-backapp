import { Router } from "express";
import * as productController from "../controllers/product.controller";

const router = Router();

router.get("/", productController.list);
// Antes de /:slug: si no, "categories" se buscaría como un producto.
router.get("/categories", productController.categories);
router.get("/:slug", productController.getBySlug);

export default router;
