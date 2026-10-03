/* Parity test: browser inference must match the Python training pipeline. Run: npx tsx scripts/parity.ts <cases.json> */
import { readFileSync } from "node:fs";
import { featureVector, forecastWith, loadModel } from "../src/lib/ml/forecast";
import { CITY_LIST } from "../src/lib/cities";

(async () => {
  const cases = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const model = await loadModel();
  const lots = CITY_LIST.flatMap((c) => c.lots);
  let worst = 0;
  for (const c of cases) {
    const lot = lots.find((l) => l.id === c.lot)!;
    const x = featureVector(model, lot, c.t0, c.occ, c.h, c.rain);
    const dx = Math.max(...x.map((v, i) => Math.abs(v - c.x[i])));
    const f = forecastWith(model, lot, c.t0, c.occ, c.h, c.rain);
    const d = Math.abs(f.occupancy - Math.min(1, Math.max(0, c.point)));
    worst = Math.max(worst, d, dx);
    console.log(c.lot, "features Δ", dx.toExponential(2), "pred", f.occupancy.toFixed(4), "py", c.point.toFixed(4), "factors", f.factors.slice(0, 3));
  }
  if (worst > 1e-6) { console.error("PARITY FAIL", worst); process.exit(1); }
  console.log("PARITY OK");
})();
