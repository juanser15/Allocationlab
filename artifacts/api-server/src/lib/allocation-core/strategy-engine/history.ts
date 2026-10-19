/** Research-only PIT store adapter. Frozen definition/config snapshots establish
 * identity; dated observations/maps/models supply the admissible information set.
 * Never replaces an old strategy definition with today's definition. */
import type {PointInTime} from '../contracts';
import {canonicalHash,timestamp} from '../validation';
import type {PositionMap,StrategyCovariance,StrategyInput} from './contracts';
import {selectSnapshot,selectPositionMap} from './validation';
import {allocateStrategies} from './engine';
export interface ReturnObservation {date:string;available_at:string;value:number;}
export interface StrategyHistoryStore {
 configuration_snapshots:StrategyInput[];
 return_history:Record<string,ReturnObservation[]>;
 position_history:Record<string,PositionMap[]>;
 covariance_history:StrategyCovariance[];
}
function available(t:unknown,cutoff:number):boolean{const v=timestamp(t);return v!==null&&v<=cutoff;}
function latest<T extends PointInTime>(artifacts:T[],cutoff:string):T|null {
 const t=timestamp(cutoff)!;const eligible=artifacts.filter(a=>available(a.as_of,t)&&available(a.information_cutoff,t)&&available(a.provenance.data_available_at,t)).sort((a,b)=>timestamp(a.as_of)!-timestamp(b.as_of)!);
 const a=eligible.at(-1);if(!a)return null;if(eligible.filter(b=>timestamp(b.as_of)===timestamp(a.as_of)).length!==1)throw Error('Ambiguous historical model');return structuredClone(a);
}
export function historicalInput(store:StrategyHistoryStore,decision:string):StrategyInput{
 const x=selectSnapshot(store.configuration_snapshots,decision);if(!x)throw Error('INSUFFICIENT_DATA: no historical definition/configuration snapshot');
 const t=timestamp(x.information_cutoff)!;
 for(const s of x.streams){const id=s.strategy_instance_id,history=(store.return_history[id]??[]).filter(r=>available(r.date,t)&&available(r.available_at,t)).sort((a,b)=>timestamp(a.date)!-timestamp(b.date)!);
  if(!history.length)throw Error('INSUFFICIENT_DATA: missing eligible history '+id);
  const m=selectPositionMap(store.position_history[id]??[],x.information_cutoff);if(!m)throw Error('INSUFFICIENT_DATA: no historical unit map '+id);
  s.historical_series={...s.historical_series,dates:history.map(r=>r.date),values:history.map(r=>r.value)};s.unit_position_map=m;
  // Hash only the information set actually used; the entire current store hash is not an economic input.
  s.provenance={...s.provenance,data_hash:canonicalHash({identity:s.parameterization_hash,history,map:m})};
 }
 const cov=latest(store.covariance_history,x.information_cutoff);if(!cov)throw Error('INSUFFICIENT_DATA: no PIT strategy covariance artifact');x.risk_model=cov;
 x.provenance={...x.provenance,data_hash:canonicalHash({configuration_snapshot_hash:x.provenance.data_hash,streams:x.streams,risk_model:cov})};return x;
}
export function allocateHistorical(store:StrategyHistoryStore,decision:string){return allocateStrategies(historicalInput(store,decision));}
