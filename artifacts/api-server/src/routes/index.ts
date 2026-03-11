import { Router, type IRouter } from "express";
import healthRouter from "./health";
import casesRouter from "./cases";
import entitiesRouter from "./entities";
import documentsRouter from "./documents";
import relationshipsRouter from "./relationships";
import timelineRouter from "./timeline";
import eventsRouter from "./events";
import notesRouter from "./notes";
import moneyFlowsRouter from "./money_flows";

const router: IRouter = Router();

router.use(healthRouter);
router.use(casesRouter);
router.use(entitiesRouter);
router.use(documentsRouter);
router.use(relationshipsRouter);
router.use(timelineRouter);
router.use(eventsRouter);
router.use(notesRouter);
router.use(moneyFlowsRouter);

export default router;
