/** Mechanical copy of certified candidate enumeration. Its month-start campaign
 * validator is deliberately separated from the new anchored calendar contract.
 * Candidate policy definitions, axes, IDs, order and budgets are unchanged. */
import {canonical,hash,candidateId,type Campaign,type Candidate,type CandidateSpec} from "../capital/spec";
const setPath = (obj: any, path: string, value: unknown) => {
  const parts = path.split(".");
  if (parts.some(p => ["__proto__", "constructor", "prototype"].includes(p))) throw new Error("Unsafe candidate axis");
  let target = obj; for (const part of parts.slice(0, -1)) target = target[part] ??= {};
  target[parts.at(-1)!] = structuredClone(value);
};
export function generateInteractiveCandidates(c: Campaign): { candidates: Candidate[]; cartesianSize: number } {
  // Model enumeration has no calendar side effects. The versioned planner owns date validation.
  if (c.search_method !== "grid") throw new Error("Only the certified fixed grid is supported");
  const templates = c.candidate_space.map(t => {
    const axes = Object.entries(t.axes ?? {}).sort(([a], [b]) => a.localeCompare(b));
    if (axes.some(([, a]) => !Array.isArray(a) || !a.length || new Set(a.map(canonical)).size !== a.length)) throw new Error("Empty/duplicate axis values");
    const size = axes.reduce((s, [, a]) => s * a.length, 1);
    if (!Number.isSafeInteger(size)) throw new Error("Search product exceeds safe integer range");
    return { t, axes, size };
  });
  const total = templates.reduce((s, t) => s + t.size, 0), budget = c.candidate_budget ?? 200;
  if (!total) throw new Error("Empty candidate space");
  if (c.search_method === "grid" && total > budget && !c.grid_reduction) throw new Error(`Grid product ${total} > budget ${budget}; explicit grid_reduction.indices or random search required`);
  const at = (index: number): Candidate => {
    const found = templates.find(t => { if (index < t.size) return true; index -= t.size; return false; })!;
    const spec = structuredClone({ ...found.t.base,
      rebalance_frequency: found.t.base.rebalance_frequency ?? c.rebalance_frequency,
      recalibration_frequency: found.t.base.recalibration_frequency ?? c.recalibration_frequency }) as CandidateSpec;
    for (const [path, values] of [...found.axes].reverse()) { setPath(spec, path, values[index % values.length]); index = Math.floor(index / values.length); }
    return { candidate_id: candidateId(spec), spec };
  };
  let indices: number[];
  if (c.search_method === "grid") indices = c.grid_reduction ? c.grid_reduction.indices : Array.from({ length: total }, (_, i) => i);
  else {
    let seed = parseInt(hash(c.random_seed).slice(0, 8), 16) >>> 0;
    const random = () => { seed += 0x6D2B79F5; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const selected = new Set<number>();
    while (selected.size < Math.min(total, budget)) selected.add(Math.floor(random() * total));
    indices = [...selected];
  }
  if (indices.length > budget || new Set(indices).size !== indices.length || indices.some(i => !Number.isSafeInteger(i) || i < 0 || i >= total)) throw new Error("Invalid explicit grid reduction");
  const unique = new Map(indices.map(i => { const x = at(i); return [x.candidate_id, x]; }));
  return { candidates: [...unique.values()].sort((a, b) => a.candidate_id.localeCompare(b.candidate_id)), cartesianSize: total };
}
