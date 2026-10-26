import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {ingestYahoo,inspectDatasetCsv,PersistentDatasetStore,pool} from '../artifacts/api-server/dist/p0-test-support.mjs';
after(()=>pool.end());
const request={tickers:['SPY','GLD'],start:'2020-01-01',end:'2020-01-31'};
const wire=(prices,days=[2,3,6])=>new Response(JSON.stringify({chart:{result:[{meta:{currency:'USD'},timestamp:days.map(d=>Date.parse(`2020-01-${String(d).padStart(2,'0')}`)/1000),indicators:{adjclose:[{adjclose:prices}]}}]}}));
test('QA preserves missing cells, exact union/common calendar and explicit gaps',()=>{
 const qa=inspectDatasetCsv('date,SPY,GLD\n2020-01-02,100,\n2020-01-03,101,200\n2020-01-20,102,201\n');
 assert.equal(qa.union_calendar_observations,3);assert.equal(qa.complete_case_observations,2);assert.equal(qa.per_ticker[1].missing,1);assert.equal(qa.large_gaps.length,2);assert.match(qa.warnings.join(' '),/no forward fill/);
 for(const csv of ['date,SPY\n2020-01-01,0\n','date,SPY\n2020-01-01,NaN\n','date,SPY\n2020-01-01,1\n2020-01-01,1\n'])assert.throws(()=>inspectDatasetCsv(csv),e=>e.code==='INVALID_DATASET_PAYLOAD');
});
test('Yahoo uses fixed host/adjusted close, keeps missing/invalid evidence and does not fill',async()=>{
 const record=await ingestYahoo(request,async(url,options)=>{assert.equal(url.hostname,'query1.finance.yahoo.com');assert.equal(options.redirect,'error');return wire(url.pathname.endsWith('SPY')?[100,null,102]:[200,-1,202]);});
 assert.equal(record.csv,'date,GLD,SPY\n2020-01-02,200,100\n2020-01-03,,\n2020-01-06,202,102\n');assert.equal(record.metadata.qa.invalid_nonpositive_prices,1);assert.equal(record.metadata.missing_values,2);assert.equal(record.metadata.pit_status,'VINTAGE_UNVERIFIED');assert.match(record.metadata.raw_source_hash,/^[a-f0-9]{64}$/);
});
test('A failed optional symbol remains visible and never substitutes raw close',async()=>{
 const r=await ingestYahoo(request,async url=>url.pathname.endsWith('SPY')?wire([100,101,102]):new Response(JSON.stringify({chart:{result:[{meta:{currency:'USD'},timestamp:[1],indicators:{quote:[{close:[200]}]}}]}})));
 assert.deepEqual(r.metadata.qa.successful_tickers,['SPY']);assert.equal(r.metadata.qa.failed_tickers[0].error,'SOURCE_ADJUSTED_CLOSE_UNAVAILABLE');assert.equal(r.metadata.qa.per_ticker[0].missing,3);
});
test('Identical duplicates counted; conflicting duplicates reject affected symbol',async()=>{
 const same=await ingestYahoo({...request,tickers:['SPY']},async()=>wire([100,100,101],[2,2,3]));assert.equal(same.metadata.qa.duplicate_dates,1);
 await assert.rejects(()=>ingestYahoo({...request,tickers:['SPY']},async()=>wire([100,999,101],[2,2,3])),e=>e.code==='YAHOO_DATA_FETCH_FAILED'&&e.details.failed_tickers[0].error==='SOURCE_CONFLICTING_DUPLICATE');
});
test('Unknown fields, arbitrary paths, invalid dates and non-daily sources never fetch',async()=>{
 let calls=0;const transport=async()=>{calls++;return wire([1,2,3]);};
 for(const patch of [{url:'https://elsewhere.test'},{tickers:['../../secret']},{start:'2020-02-30'},{frequency:'WEEKLY'},{price_field:'CLOSE'}])await assert.rejects(()=>ingestYahoo({...request,...patch},transport),e=>e.code==='INVALID_DATASET_REQUEST');assert.equal(calls,0);
});
test('Unavailable PostgreSQL fails closed, safely and without internal dataset fallback',async()=>{
 const store=new PersistentDatasetStore({connect:async()=>{throw new Error('secret postgres://private-path')}});
 await assert.rejects(()=>store.workspace(),e=>e.code==='DATASET_UNAVAILABLE'&&!e.message.includes('secret')&&!e.message.includes('private-path'));
});

test('Post-initialization database outage preserves DATASET_UNAVAILABLE for explicit reads',async()=>{
 const fake={connect:async()=>({query:async()=>({rows:[],rowCount:0}),release:()=>{}}),query:async()=>{throw new Error('secret database connection lost')}};
 const store=new PersistentDatasetStore(fake);await store.initialize();
 for(const op of [()=>store.read('yf_'+'a'.repeat(32)),()=>store.workspace(),()=>store.list()])await assert.rejects(op,e=>e.code==='DATASET_UNAVAILABLE'&&e.statusCode===503&&!e.message.includes('secret'));
});
