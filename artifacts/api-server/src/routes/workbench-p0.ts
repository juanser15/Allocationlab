import {Router} from 'express';
import {P0Service} from '../lib/workbench/p0-service';
import {p0Capabilities,p0Bounds,planP0,parseP0} from '../lib/workbench/p0-calendar';
import {CalendarContractError,boundaryV2} from '../lib/workbench/calendar-v2';
import {safeError} from './workbench';
/** Scoped injection seam for source-only HTTP tests; production uses the existing
 * durable service, pinned dataset loader and worker unchanged. */
export type P0RouteService = Pick<P0Service, 'submit' | 'list' | 'get' | 'rerun'> & {
 store: Pick<P0Service['store'], 'reviews' | 'review'>;
};
export interface P0RouteDependencies {
 service?: () => Promise<P0RouteService>;
 capabilities?: typeof p0Capabilities;
 bounds?: typeof p0Bounds;
 plan?: typeof planP0;
}
export function createP0Router(dependencies: P0RouteDependencies = {}) {
const router=Router();let instance:Promise<P0Service>|undefined;
const service=dependencies.service??(()=>instance??=P0Service.open());
const capabilities=dependencies.capabilities??p0Capabilities;
const bounds=dependencies.bounds??p0Bounds;
const plan=dependencies.plan??planP0;
router.use('/workbench/p0',(req,res,next)=>{res.setHeader('Cache-Control','no-store');if(Object.keys(req.query).length){res.status(400).json({...boundaryV2,error:{code:'INVALID_QUERY',message:'Unexpected query fields.'}});return;}next();});
router.get('/workbench/p0/capabilities',async(req,res)=>{try{res.json(await capabilities());}catch(e){safeError(req,res,e)}});
router.post('/workbench/p0/dataset-capabilities',async(req,res)=>{try{if(!req.body||Object.keys(req.body).join()!=='dataset_id'||typeof req.body.dataset_id!=='string')throw new CalendarContractError('DATASET_UNAVAILABLE','Supply exactly one saved dataset_id.',{},409);res.json(await capabilities(req.body.dataset_id));}catch(e){safeError(req,res,e)}});
router.post('/workbench/p0/bounds',async(req,res)=>{try{res.json(await bounds(req.body));}catch(e){safeError(req,res,e)}});
router.post('/workbench/p0/plan',async(req,res)=>{try{res.json(await plan(req.body));}catch(e){safeError(req,res,e)}});
router.post('/workbench/p0/runs',async(req,res)=>{try{const request=parseP0(req.body);const r=await(await service()).submit(request);res.status(r.status==='BLOCKED'?429:r.execution_requested||r.status==='RUNNING'?202:200).json(r);}catch(e){safeError(req,res,e)}});
router.get('/workbench/p0/runs',async(req,res)=>{try{res.json(await(await service()).list());}catch(e){safeError(req,res,e)}});
router.get('/workbench/p0/runs/:runId/reviews',async(req,res)=>{try{res.json(await(await service()).store.reviews(String(req.params.runId)));}catch(e){safeError(req,res,e)}});
router.post('/workbench/p0/runs/:runId/reviews',async(req,res)=>{try{res.status(201).json(await(await service()).store.review(String(req.params.runId),req.body));}catch(e){safeError(req,res,e)}});
router.get('/workbench/p0/runs/:runId',async(req,res)=>{try{res.json(await(await service()).get(String(req.params.runId)));}catch(e){safeError(req,res,e)}});
router.post('/workbench/p0/runs/:runId/rerun',async(req,res)=>{try{if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length)throw new CalendarContractError('INVALID_RERUN','Rerun takes an empty object.');const r=await(await service()).rerun(String(req.params.runId));res.status(r.status==='BLOCKED'?429:202).json(r);}catch(e){safeError(req,res,e)}});
return router;
}
export default createP0Router();
