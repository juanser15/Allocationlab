import { Router } from "express";
import { persistentDatasetStore as store, PERSISTENT_DATA_BOUNDARY } from "../lib/workbench/persistent-datasets";
import { boundaryV2, CalendarContractError } from "../lib/workbench/calendar-v2";
import { safeError } from "./workbench";
const router = Router();
const workspace = async () => { const {active_dataset,...state}=await store.workspace(); return {...boundaryV2,...PERSISTENT_DATA_BOUNDARY,workspace:state,active_dataset}; };
// Historical run reads remain available. The ephemeral workspace contract can
// no longer accept new financial submissions or reactivate browser snapshots.
router.use((req,res,next)=>{
 if(req.method==='POST' && /^\/workbench\/(coordinated|interactive)\/(data(?:\/|$)|runs(?:\/|$)|plan\/?$|bounds\/?$)/i.test(req.path)){
  res.status(410).json({...boundaryV2,...PERSISTENT_DATA_BOUNDARY,error:{code:'PERSISTENT_DATASET_REQUIRED',message:'Use the persistent dataset workspace for new research. Historical results have not been migrated.'}});return;
 }
 next();
});
router.use('/workbench/library',(req,res,next)=>{res.setHeader('Cache-Control','no-store');if(Object.keys(req.query).length){res.status(400).json({...boundaryV2,...PERSISTENT_DATA_BOUNDARY,error:{code:'INVALID_QUERY',message:'Unexpected query fields.'}});return;}next();});
router.get('/workbench/library',async(req,res)=>{try{res.json({...boundaryV2,...PERSISTENT_DATA_BOUNDARY,datasets:await store.list()});}catch(e){safeError(req,res,e)}});
router.get('/workbench/library/workspace',async(req,res)=>{try{res.json(await workspace());}catch(e){safeError(req,res,e)}});
router.put('/workbench/library/workspace',async(req,res)=>{try{if(!req.body||Object.keys(req.body).join()!=='dataset_id'||typeof req.body.dataset_id!=='string')throw new CalendarContractError('INVALID_DATASET_REQUEST','Supply exactly one saved dataset_id.');await store.activate(req.body.dataset_id);res.json(await workspace());}catch(e){safeError(req,res,e)}});
router.post('/workbench/library/fetch',async(req,res)=>{try{res.status(201).json({...boundaryV2,...PERSISTENT_DATA_BOUNDARY,draft:await store.fetchYahoo(req.body)});}catch(e){safeError(req,res,e)}});
router.post('/workbench/library/save',async(req,res)=>{try{res.status(201).json({...boundaryV2,...PERSISTENT_DATA_BOUNDARY,dataset:await store.saveDraft(req.body)});}catch(e){safeError(req,res,e)}});
router.get('/workbench/library/datasets/:id',async(req,res)=>{try{res.json({...boundaryV2,...PERSISTENT_DATA_BOUNDARY,dataset:(await store.read(String(req.params.id))).metadata});}catch(e){safeError(req,res,e)}});
router.get('/workbench/library/datasets/:id/csv',async(req,res)=>{try{const record=await store.read(String(req.params.id));res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${record.metadata.dataset_id}.csv"`);res.send(record.csv);}catch(e){safeError(req,res,e)}});
export default router;
