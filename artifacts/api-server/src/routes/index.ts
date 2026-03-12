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
import entityMentionsRouter from "./entity_mentions";
import relationshipEvidenceRouter from "./relationship_evidence";
import webIngestRouter from "./web_ingest";
import systemLogRouter from "./system_log";
import dossierRouter from "./dossier";

const router: IRouter = Router();

router.use(healthRouter);
router.use(casesRouter);
router.use(entitiesRouter);
router.use(entityMentionsRouter);
router.use(documentsRouter);
router.use(webIngestRouter);
router.use(relationshipsRouter);
router.use(relationshipEvidenceRouter);
router.use(timelineRouter);
router.use(eventsRouter);
router.use(notesRouter);
router.use(moneyFlowsRouter);
router.use(systemLogRouter);
router.use(dossierRouter);

export default router;
