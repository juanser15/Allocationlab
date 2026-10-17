import type { ReactNode } from 'react';
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, BarChart, Bar, ReferenceLine } from 'recharts';
import { array, at, fmt, numeric, object, scalar, type Artifact } from './data';
export function Status({ value }: { value: unknown }) {
  const label=scalar(value); const tone=['PASS','VALID','COMPLETE','ELIGIBLE_ACTIVE','PROMOTED'].includes(label)?'good':/FAIL|INFEASIBLE|INVALID|NUMERICAL/.test(label)?'bad':/BLOCK|INACTIVE|INSUFFICIENT|NOT_|RESEARCH|SYNTHETIC|HOLD/.test(label)?'caution':'neutral';
  return <span className={`cl-status ${tone}`}>{label.replaceAll('_',' ')}</span>;
}
export function Panel({ title, note, children, className='' }: { title:string;note?:string;children:ReactNode;className?:string }) {
  return <section className={`cl-panel ${className}`}><div className="cl-panel-title"><h2>{title}</h2>{note&&<p>{note}</p>}</div>{children}</section>;
}
export function Metrics({ items }: {items:{label:string;value:unknown;percent?:boolean;note?:string}[]}) {
  return <dl className="cl-metrics">{items.map(i=><div key={i.label}><dt>{i.label}</dt><dd>{fmt(i.value,i.percent)}</dd>{i.note&&<small>{i.note}</small>}</div>)}</dl>;
}
export function Facts({ items }: {items:[string,unknown][]}) {
  return <dl className="cl-facts">{items.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{scalar(v)}</dd></div>)}</dl>;
}
export interface Column {key:string;label:string;render?:(value:unknown,row:Artifact)=>ReactNode}
export function Table({ rows, columns, caption }: {rows:Artifact[];columns:Column[];caption?:string}) {
  return <div className="cl-table-scroll" tabIndex={0} role="region" aria-label={caption||'Research data table'}><table><caption>{caption}</caption><thead><tr>{columns.map(c=><th key={c.key} scope="col">{c.label}</th>)}</tr></thead><tbody>{rows.length?rows.map((r,i)=><tr key={i}>{columns.map(c=><td key={c.key}>{c.render?c.render(at(r,c.key),r):scalar(at(r,c.key))}</td>)}</tr>):<tr><td colSpan={columns.length}>Unavailable for this artifact. No values inferred.</td></tr>}</tbody></table></div>;
}
export function JsonDetails({ title, value }: {title:string;value:unknown}) {
  return <details className="cl-details"><summary>{title}</summary><pre>{JSON.stringify(value,null,2) ?? 'Unavailable'}</pre></details>;
}
export function Weights({ weights, title, units }: {weights:unknown;title:string;units:string}) {
  return <Panel title={title} note={units}><Table rows={Object.entries(object(weights)).map(([instrument,weight])=>({instrument,weight}))} columns={[{key:'instrument',label:'Instrument / instance'},{key:'weight',label:'Weight / exposure',render:v=>fmt(v,true)}]}/></Panel>;
}
export function Plot({ data, x='date', lines, title, percent=false }: {data:Artifact[];x?:string;lines:{key:string;label:string;color?:string}[];title:string;percent?:boolean}) {
  if (!data.length) return <p className="cl-empty">Unavailable — no observed history for {title}.</p>;
  return <div className="cl-chart" role="img" aria-label={title}><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{top:10,right:18,left:0,bottom:5}}><CartesianGrid stroke="#e3e8ed" vertical={false}/><XAxis dataKey={x} minTickGap={65} tick={{fontSize:11}} tickFormatter={v=>String(v).slice(0,10)}/><YAxis width={53} tick={{fontSize:11}} tickFormatter={v=>percent?`${(Number(v)*100).toFixed(0)}%`:Number(v).toFixed(2)}/><Tooltip formatter={v=>fmt(v,percent)}/><Legend wrapperStyle={{fontSize:11}}/>{lines.map((l,i)=><Line key={l.key} name={l.label} dataKey={l.key} stroke={l.color||['#147d84','#253e5b','#8799a9','#b97736'][i%4]} strokeWidth={1.8} dot={false} connectNulls={false} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer></div>;
}
export function Bars({data,title,percent=false}: {data:{name:string;value:unknown;reference?:unknown}[];title:string;percent?:boolean}) {
  return <><div className="cl-chart cl-bars" role="img" aria-label={title}><ResponsiveContainer width="100%" height="100%"><BarChart data={data.map(d=>({...d,value:numeric(d.value),reference:numeric(d.reference)}))} margin={{left:0,right:15,bottom:10}}><CartesianGrid stroke="#e3e8ed" vertical={false}/><XAxis dataKey="name" tick={{fontSize:10}} interval={0}/><YAxis width={50} tick={{fontSize:11}} tickFormatter={v=>percent?`${(v*100).toFixed(0)}%`:Number(v).toFixed(2)}/><Tooltip formatter={v=>fmt(v,percent)}/><ReferenceLine y={0} stroke="#a2afb9"/><Bar name="Value" dataKey="value" fill="#147d84" isAnimationActive={false}/>{data.some(d=>d.reference!==undefined)&&<Bar name="Reference" dataKey="reference" fill="#a4b3c0" isAnimationActive={false}/>}</BarChart></ResponsiveContainer></div><div className="cl-chart-values">{data.map(d=><span key={d.name}>{d.name}: <strong>{fmt(d.value,percent)}</strong></span>)}</div></>;
}
export function Heatmap({ axis, matrix, title }: {axis:unknown;matrix:unknown;title:string}) {
  const ids=array(axis).map(scalar), values=array(matrix);
  return <div className="cl-table-scroll"><table className="cl-heatmap"><caption>{title}</caption><thead><tr><th>Strategy</th>{ids.map(id=><th key={id}>{id}</th>)}</tr></thead><tbody>{ids.map((id,i)=><tr key={id}><th>{id}</th>{ids.map((_,j)=>{const v=numeric(array(values[i])[j]);return <td key={j} style={{background:v===null?'#f3f5f7':v>=0?`rgba(20,125,132,${0.07+v*0.55})`:`rgba(151,111,67,${0.07+Math.abs(v)*0.5})`}}>{fmt(v,false,2)}</td>})}</tr>)}</tbody></table></div>;
}
