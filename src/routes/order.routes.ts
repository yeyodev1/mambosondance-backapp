import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { optionalAuth } from "../middlewares/optionalAuth.middleware";
import * as orderController from "../controllers/order.controller";

const router = Router();

// Comprar no exige cuenta: crear, confirmar y "encontrar mi compra" son públicas.
router.post("/", optionalAuth, orderController.create);
router.post("/confirm", optionalAuth, orderController.confirm);
router.post("/find", orderController.find);

// Antes de "/:id" para que "mine" no se lea como un id.
router.get("/mine", authMiddleware, orderController.mine);
router.get("/:id", authMiddleware, orderController.getOne);

export default router;
