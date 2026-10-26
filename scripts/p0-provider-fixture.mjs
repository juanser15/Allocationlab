// TEST ONLY: provider-wire responses built from committed historical observations.
// This is not evidence of a live Yahoo download. Never loaded by production.
import {readFileSync}from'node:fs';
const original=globalThis.fetch;
const lines=readFileSync(new URL('../reports/cl02/adjusted-closes.csv',import.meta.url),'utf8').trim().split(/\r?\n/),symbols=lines.shift().split(',').slice(1),rows=lines.map(l=>l.split(','));
globalThis.fetch=async(input,options)=>{
 const u=new URL(String(input));if(u.hostname!=='query1.finance.yahoo.com')return original(input,options);
 const ticker=decodeURIComponent(u.pathname.split('/').at(-1)),index=symbols.indexOf(ticker),start=Number(u.searchParams.get('period1')),end=Number(u.searchParams.get('period2'));
 if(index<0)return new Response(JSON.stringify({chart:{error:{code:'Not Found'}}}),{status:404});
 const selected=rows.filter(r=>Date.parse(r[0])/1000>=start&&Date.parse(r[0])/1000<end);
 return new Response(JSON.stringify({chart:{result:[{meta:{currency:'USD'},timestamp:selected.map(r=>Date.parse(r[0])/1000),indicators:{adjclose:[{adjclose:selected.map(r=>r[index+1]?Number(r[index+1]):null)}]}}],error:null}}),{headers:{'content-type':'application/json'}});
};
