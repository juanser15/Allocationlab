import { Router, type IRouter } from "express";
import healthRouter from "./health";
import universeRouter from "./universe";
import constraintsRouter from "./constraints";
import pricesRouter from "./prices";
import livePricesRouter from "./live-prices";
import runRouter from "./run";
import sessionsRouter from "./sessions";
import reportsRouter from "./reports";

const router: IRouter = Router();

router.use(healthRouter);
router.use(universeRouter);
router.use(constraintsRouter);
router.use(pricesRouter);
router.use(livePricesRouter);
router.use(runRouter);
router.use(sessionsRouter);
router.use(reportsRouter);

export default router;
