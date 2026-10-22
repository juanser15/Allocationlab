import {
  loadDatasetV2,
  sha256,
  CalendarContractError,
  type DatasetV2,
} from "./calendar-v2";
import { preparedDataset } from "./interactive-calendar";
import {
  readResearchDataset,
  readResearchDatasetCsv,
} from "./research-datasets";
import { canonicalJson } from "./identity";
let reference: DatasetV2 | undefined;
/** Bind an explicit snapshot: changing active data cannot redirect a pending
 * run or its rerun. Missing snapshots fail without substituting another. */
export function loadCoordinatedDataset(id?: string): DatasetV2 {
  if (id === undefined) return preparedDataset();
  const base = (reference ??= loadDatasetV2());
  if (id === "internal" || id === "REFERENCE") return base;
  if (!/^yf_[a-f0-9]{64}$/.test(id))
    throw new CalendarContractError(
      "INVALID_DATASET_ID",
      "Choose an existing research dataset.",
      {},
      422,
    );
  let metadata: ReturnType<typeof readResearchDataset>, csv: string;
  try {
    metadata = readResearchDataset(id);
    csv = readResearchDatasetCsv(id);
  } catch {
    throw new CalendarContractError(
      "DATASET_NOT_AVAILABLE",
      "The exact temporary dataset is unavailable. Restore its saved snapshot or download a new version; no dataset was substituted.",
      {},
      409,
    );
  }
  if (sha256(csv) !== metadata.sha256)
    throw new CalendarContractError(
      "DATASET_HASH_MISMATCH",
      "Research dataset hash verification failed.",
      {},
      500,
    );
  const lines = csv.trim().split(/\r?\n/),
    symbols = lines[0].split(",").slice(1);
  const rows = lines.slice(1).map((line) => {
    const [date, ...values] = line.split(",");
    return {
      date,
      prices: Object.fromEntries(
        symbols.flatMap((ticker, i) =>
          values[i] ? [[ticker, Number(values[i])]] : [],
        ),
      ),
    };
  });
  if (
    !rows.length ||
    rows.some(
      (row, i) =>
        !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
        (i > 0 && row.date <= rows[i - 1].date) ||
        Object.values(row.prices).some((v) => !Number.isFinite(v) || v <= 0),
    )
  )
    throw new CalendarContractError(
      "INVALID_DATASET",
      "Dataset contains invalid dates or prices.",
      {},
      422,
    );
  return {
    ...base,
    rows,
    fixture: {
      ...base.fixture,
      data_csv: `temporary://${id}`,
      data_sha256: metadata.sha256,
      data_provenance: canonicalJson(metadata),
    },
    snapshot: {
      path: `temporary://${id}`,
      sha256: metadata.sha256,
      parsed_data_hash: sha256(canonicalJson(rows)),
      observations: rows.length,
      data_first_observation: rows[0].date,
      data_last_observation: rows.at(-1)!.date,
      source: metadata.source,
      dataset_id: id,
      fetched_at: metadata.fetched_at,
    } as DatasetV2["snapshot"],
  };
}
