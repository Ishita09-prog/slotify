/* Single source of truth: export the TypeScript city configs for the FastAPI backend.
   Run: npx tsx scripts/export-cities.ts   (writes backend/app/data/cities.json) */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CITY_LIST } from "../src/lib/cities";

const out = resolve(__dirname, "../../backend/app/data/cities.json");
writeFileSync(out, JSON.stringify({ generatedFrom: "frontend/src/lib/cities", cities: CITY_LIST }, null, 1));
console.log(`wrote ${out}: ${CITY_LIST.map((c) => `${c.id} (${c.lots.length} lots)`).join(", ")}`);
