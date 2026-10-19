/** Persist all five synthetic objective results and declared local perturbations. */
import {readFileSync,writeFileSync} from 'node:fs';
import {allocateAssets} from '../../../../dist/al03/fixtures/engine.js';
import {syntheticInput} from '../../../../dist/al03/fixtures/artifacts.js';
import {localSensitivity} from '../../../../dist/al03/fixtures/sensitivity.js';
const root='reports/al03',oracles=JSON.parse(readFileSync(root+'/oracle-fixtures.json','utf8')).fixtures;
const results=[],sensitivity=[];
for(const name of ['EQUAL_WEIGHT','MIN_VARIANCE','MEAN_VARIANCE','MAX_SHARPE','ERC']) {
 const o=oracles.find(o=>o.objective===name)??oracles[0],objective=name==='MEAN_VARIANCE'?{type:name,gamma:o.gamma}:name==='MAX_SHARPE'?{type:name,rf_sleeve:o.rf}:{type:name};
 const input=syntheticInput(o.covariance,objective,['MEAN_VARIANCE','MAX_SHARPE'].includes(name)?o.mu:null),result=allocateAssets(input);
 if(result.status!=='VALID')throw Error(name+' '+result.errors.join(';'));
 results.push({label:'SYNTHETIC_DECLARED_ARTIFACT_NOT_FINANCIAL_FORECAST',input,result});sensitivity.push(...localSensitivity(input,result).map(row=>({objective:name,label:'SYNTHETIC',...row})));
}
writeFileSync(root+'/synthetic-objective-results.json',JSON.stringify(results,null,2)+'\n');
const keys=[...new Set(sensitivity.flatMap(r=>Object.keys(r)))],cell=v=>'"'+(v==null?'':typeof v==='object'?JSON.stringify(v):String(v)).replaceAll('"','""')+'"';
writeFileSync(root+'/sensitivity-synthetic.csv',keys.map(cell).join(',')+'\r\n'+sensitivity.map(r=>keys.map(k=>cell(r[k])).join(',')).join('\r\n')+'\r\n');
console.log(JSON.stringify({objectives:results.length,sensitivity:sensitivity.length,status:'PASS'}));
