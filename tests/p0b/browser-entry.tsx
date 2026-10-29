import { createRoot } from "react-dom/client";
import { TradingBlotterPanel } from "../../artifacts/allocation-lab/src/research/trading-blotter";
import { fixtureRecord } from "./fixture";
const record = fixtureRecord();
if (new URLSearchParams(location.search).has("large")) {
  record.run_id = "rr_large_blotter";
  record.latest_attempt.attempt = {
    run_id: record.run_id,
    execution_attempt_id: "ea_large_blotter",
  };
  record.attempt_history[0].attempt = { ...record.latest_attempt.attempt };
}
createRoot(document.getElementById("root")!).render(
  <main style={{ padding: 16, maxWidth: 1400, margin: "auto", minWidth: 0 }}>
    <p style={{ fontSize: 12 }}>
      SOURCE-ONLY SYNTHETIC UI TEST · NOT EMPIRICAL RESEARCH
    </p>
    <TradingBlotterPanel record={record} />
  </main>,
);
