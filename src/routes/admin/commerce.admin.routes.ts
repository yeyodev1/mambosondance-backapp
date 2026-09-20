import { Router } from "express";
import * as adminAccessController from "../../controllers/admin-access.controller";
import * as adminDashboardController from "../../controllers/admin-dashboard.controller";
import * as adminLoyaltyController from "../../controllers/admin-loyalty.controller";
import * as adminOrderController from "../../controllers/admin-order.controller";
import * as adminTicketController from "../../controllers/admin-ticket.controller";
import * as adminUserController from "../../controllers/admin-user.controller";

// Sin authMiddleware ni adminMiddleware: el gate único vive en admin.routes.ts.
const router = Router();

router.get("/dashboard", adminDashboardController.summary);

router.get("/orders", adminOrderController.list);
router.get("/orders/:id", adminOrderController.getOne);
router.patch("/orders/:id", adminOrderController.updateFulfillment);

router.get("/users", adminUserController.list);
router.get("/users/:id", adminUserController.getOne);

router.post("/access", adminAccessController.grant);
router.get("/access", adminAccessController.list);
router.patch("/access/:id", adminAccessController.patch);
router.post("/access/:id/revoke", adminAccessController.revoke);

router.get("/tickets", adminTicketController.list);
// Antes de "/tickets/:id/..." para que "verify" no se lea como un id.
router.get("/tickets/verify/:code", adminTicketController.verify);
router.post("/tickets/:id/check-in", adminTicketController.checkIn);
router.post("/tickets/:id/void", adminTicketController.voidTicket);

router.post("/loyalty/stamp", adminLoyaltyController.stamp);
router.post("/loyalty/redeem", adminLoyaltyController.redeem);
router.delete("/loyalty/stamp/:stampId", adminLoyaltyController.removeStamp);

export default router;
