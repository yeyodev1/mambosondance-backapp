import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as orderController from "../controllers/order.controller";

const router = Router();

router.use(authMiddleware);

router.post("/", orderController.create);
router.post("/confirm", orderController.confirm);
// Antes de "/:id" para que "mine" no se lea como un id.
router.get("/mine", orderController.mine);
router.get("/:id", orderController.getOne);

export default router;
