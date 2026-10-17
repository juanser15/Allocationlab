export type Artifact = Record<string, unknown>;
export interface Decision {
  id: string; label: string; scope: string; source: string; date: string; cutoff: string;
  status: string; reason: string | null; mode: string; objective: Artifact;
  context: Artifact; mandate: Artifact; sleeve: Artifact | null; allocation: Artifact | null;
  signal_status: string; signal_gate: Artifact | null; robustness_gate: Artifact | null;
  controller: Artifact | null; target: Artifact | null; route: Artifact | null;
  stages: Artifact[]; bank: Artifact | null; realized: Artifact | null; integration?: Artifact;
}
export interface Presentation {
  schema_version: string; read_only: true; live: false; scope: string; chart_sampling: string;
  default_decision_id: string; decisions: Decision[]; asset_history: Artifact[];
  factors: Artifact[]; campaigns: Artifact[]; tables: Record<string, Artifact[]>;
  charts: Record<string, Artifact[]>; certifications: Artifact[]; blockers: Artifact[];
  sources: Record<string, { sha256: string; bytes: number }>;
}
export const object = (x: unknown): Artifact => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Artifact : {};
export const array = (x: unknown): unknown[] => Array.isArray(x) ? x : [];
export function at(x: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((v, key) => object(v)[key], x);
}
export function scalar(x: unknown): string {
  if (x === null || x === undefined || x === '') return 'Unavailable';
  if (Array.isArray(x)) return x.map(scalar).join(', ');
  if (typeof x === 'object') return JSON.stringify(x);
  return String(x);
}
export function numeric(x: unknown): number | null {
  if (x === null || x === undefined || x === '' || typeof x === 'boolean') return null;
  const n = Number(x); return Number.isFinite(n) ? n : null;
}
export function fmt(x: unknown, percent = false, digits = 3): string {
  const n = numeric(x); return n === null ? 'Unavailable' : percent ? `${(n * 100).toFixed(2)}%` : n.toFixed(digits);
}
export function parse(x: unknown): unknown {
  if (typeof x !== 'string') return x;
  try { return JSON.parse(x); } catch { return x; }
}
export function validatePresentation(value: unknown): asserts value is Presentation {
  const v = object(value);
  if (v.schema_version !== 'ui01-presentation-1.0.0' || v.read_only !== true || v.live !== false || !Array.isArray(v.decisions) || !v.decisions.length) throw new Error('Invalid read-only presentation schema');
  const ids = new Set<string>();
  for (const d of v.decisions) {
    const x = object(d);
    if (typeof x.id !== 'string' || ids.has(x.id) || !['HISTORICAL_RESEARCH','SYNTHETIC'].includes(String(x.scope)) || typeof x.date !== 'string' || typeof x.cutoff !== 'string' || x.cutoff >= x.date) throw new Error('Invalid identity, scope or decision cutoff');
    ids.add(x.id);
  }
  if (!ids.has(String(v.default_decision_id))) throw new Error('Missing default decision');
}
export async function loadPresentation(): Promise<Presentation> {
  const base = `${import.meta.env.BASE_URL}ui01/`;
  const responses = await Promise.all([fetch(`${base}manifest.json`), fetch(`${base}data.json`)]);
  if (responses.some(r => !r.ok)) throw new Error('Frozen artifact presentation is unavailable');
  const manifest: unknown = await responses[0].json(); const bytes = await responses[1].arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2,'0')).join('');
  if (digest !== object(manifest).sha256) throw new Error('Artifact presentation hash mismatch');
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes)); validatePresentation(value); return value;
}
