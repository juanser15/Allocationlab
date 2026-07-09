import { Router, type IRouter } from "express";
import healthRouter from "./health";
import universeRouter from "./universe";
import constraintsRouter from "./constraints";
import pricesRouter from "./prices";
import livePricesRouter from "./live-prices";
import runRouter from "./run";
import sessionsRouter from "./sessions";
import reportsRouter from "./reports";
import etfRouter from "./etf";
import backtestRouter from "./backtest";
import decisionLogRouter from "./decision-log";
import archiveRouter from "./archive";
import committeeRouter from "./committee";
import riskModelRouter from "./riskModel";

const router: IRouter = Router();

router.use(healthRouter);
router.use(universeRouter);
router.use(constraintsRouter);
router.use(pricesRouter);
router.use(livePricesRouter);
router.use(runRouter);
router.use(sessionsRouter);
router.use(reportsRouter);
router.use(etfRouter);
router.use(backtestRouter);
router.use(decisionLogRouter);
router.use(archiveRouter);
router.use(committeeRouter);
router.use(riskModelRouter);

export default router;
