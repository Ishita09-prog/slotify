# Slotify: smart parking command platform

**South Chennai pilot** (Velachery · T. Nagar · Adyar · OMR corridor) on a multi-city platform.
**Coimbatore** runs on the same code from its own city config.

Slotify reads every parking bay through edge AI cameras. Drivers book a space instead of circling, and lot operators fill more bays. Traffic police see illegal parking as it happens. A city **Command Centre** watches every zone, forecasts saturation, raises incidents with AI recommendations, and acts only after a named official approves.

> **Data honesty:** all occupancy, camera, ANPR, weather and field-unit data in this prototype is **simulated**, and every screen is labelled. The forecaster is a real trained model, but its training history is also simulated (see *AI* below). Lot locations are approximate public places.

---

## What's in the box

| Surface | Route | Highlights |
|---|---|---|
| **Command Centre** | `/command` | Live GIS: zone → locality → lot drill-down, demand heat, layers. Also KPI strip, incident queue, AI insights, live detection stream, network status |
| | `/command/incidents` | Detect → AI assess → **human approval** → dispatch → on scene → resolve. Includes a risk score breakdown, forecast with 80% interval and per-input explanation, RBAC-locked actions, unit ETA, notifications, impact vs. "no action" forecast, and a PDF incident report |
| | `/command/forecast` | Model card, hold-out metrics vs baselines, error by horizon, **what-if simulator**, live forecasts and anomaly watch for every lot |
| | `/command/health` | Service status, edge camera nodes (fault injection), failure-mode matrix, API-outage drill |
| | `/command/audit` | SHA-256 **hash-chained ledger**, verify chain, **tamper demo**, JSON export |
| | `/command/reports` | Shift KPIs (mean time to approve and to resolve, occupancy avoided), incident register, signed-off **situation report PDF** |
| | `/command/architecture` | Layered architecture, scale, security and privacy, DR, provenance, prototype vs production |
| Sign-in | `/login` | Four demo identities with role permissions (Command Officer, Traffic Police Inspector, Parking Operator, Citizen) |
| Driver | `/user`, `/user/lots/[id]`, `/user/predict`, `/user/wallet`, `/user/bookings` | Map search, bay picker, FASTag wallet, ML predictions with range and "why", bookings. A camera outage shows estimates and pauses bookings |
| Operator | `/owner`, `/owner/live`, `/owner/slots` | Occupancy and revenue, live bays and camera feed, capacity and maintenance |
| Police | `/police`, `/police/map`, `/police/congestion` | ANPR violations and e-challan workflow, **Command Centre dispatch inbox**, map, congestion by locality |

A city switcher (top bar) moves every screen between **South Chennai** and **Coimbatore**.

## South Chennai coverage (4 zones, 31 localities, 21 lots)

- **T. Nagar** (Traffic South-West): Pondy Bazaar, Ranganathan St, Usman Rd, Panagal Park, T. Nagar Bus Terminus, Mambalam Station, GN Chetty Rd
- **Velachery** (Traffic South): Phoenix MarketCity, Velachery MRTS, Vijayanagar Bus Terminus, 100 Ft Bypass Rd, Gurunanak College Jn, Taramani Link Rd, Velachery–Tambaram Rd (Pallikaranai)
- **Adyar** (Traffic South-East): Adyar Signal / LB Rd, Gandhi Nagar, Kasturba Nagar, Besant Nagar (Elliot's Beach), Thiruvanmiyur, Kotturpuram, Adyar Depot
- **OMR Corridor** (Traffic OMR): Madhya Kailash Jn, Tidel Park, SRP Tools Jn, Kandanchavadi, Perungudi, Thoraipakkam (Radial Rd Jn), Karapakkam, Sholinganallur Jn, Navalur, Siruseri SIPCOT

Each city is one file in `frontend/src/lib/cities/`. Adding a city means adding a config, with no component changes.

---

## Quick start

```bash
# Frontend (fully functional on its own: on-device simulator + on-device model)
cd frontend
npm install
npm run dev                      # http://localhost:3000  → "Open the Command Centre"

# Backend (optional)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload    # http://localhost:8000/docs
pytest                           # 15 tests: API, ML parity, audit chain, RBAC

# Connect them
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > frontend/.env.local

# Retrain the model (≈40 s) and re-check browser/server parity
pip install scikit-learn numpy
python ml/train.py
python ml/parity_cases.py > /tmp/cases.json && (cd frontend && npx tsx scripts/parity.ts /tmp/cases.json)

# Static build for hosting (plain files in frontend/out: drag onto https://app.netlify.com/drop, S3, any CDN)
cd frontend && npm run export

# After editing a city config, export it for the backend
cd frontend && npx tsx scripts/export-cities.ts
```

---

## AI: what it does and why

| | |
|---|---|
| **Problem** | Will there be a bay when I arrive? Will this zone saturate in the next hour? Is this crowd normal? |
| **Model** | Gradient-boosted trees (scikit-learn `HistGradientBoostingRegressor`): one mean model plus 10th and 90th percentile models, giving a **calibrated 80% interval** |
| **Inputs (20)** | Occupancy now, the lot's historical profile at this hour and at the arrival hour, deviation from usual, horizon, time, weekday, weekend, **TN holiday**, **festival season**, **rain forecast**, lot type, lot's usual demand |
| **Output** | Occupancy 15–180 min ahead, interval, confidence, and **per-input contributions** (exact tree-path attribution) |
| **Hold-out (last 60 days, time split)** | MAE **2.9 pts** vs 3.1 for the v1 heuristic (which is given the simulator's *exact* curves) vs 7.9 for "same as now". On **holidays, rain and festival days: 3.4 vs 5.1** (33% lower error). Interval coverage **79%** (target 80%) |
| **Anomaly detector** | Flags readings outside a 30-min-old forecast's band by more than 5 pts on 2 consecutive checks. Hold-out: **95% of events caught**, median delay 15 min, **0.15 false alerts per lot per week** |
| **Where it acts** | Driver predictions, risk scores, saturation and anomaly incidents, and reroute targets. Reroutes use the **upper** bound so the system never over-promises space |
| **Governance** | The model only recommends. Every action needs a named official's approval, and the model version and interval are written to the audit trail |
| **Honesty** | The training history is simulated: 365 days × 30 lots, with effects the model cannot see (daily bias, unannounced events, AR(1) noise). Retrain on the real detections archive before go-live; the pipeline is the same |

The same `model.json` runs **in the browser** (`frontend/src/lib/ml/forecast.ts`, so it keeps working through outages) and **on the server** (`backend/app/services/forecast.py`). A parity test checks they agree exactly.

## Trust and safety by design

- **Human in the loop:** recommendations → approve / reject (with reason) → escalation after the SLA (90 s in the demo) to the Deputy Commissioner.
- **RBAC:** enforcement actions (tow, e-challan, warden) can be approved by police or command; policy actions (reroute, VMS, pricing) need the Command Officer. This is enforced in the UI and on the API (`app/security.py`).
- **Audit:** an append-only SHA-256 chain records every login, drill, detection, AI output, decision, dispatch and report. Verification pinpoints the first tampered entry.
- **Provenance:** every figure names its source and model version. Estimates are always marked `~` or "ESTIMATED".
- **Failure handling:** a camera node going offline switches that lot to model estimates and pauses its bookings, and a vendor ticket opens automatically. An API outage puts the browser in edge mode with queued writes, and PDF reports still generate.

## Architecture

```
Citizens · Operators · Police · Command officers · Auditors
        │
Next.js PWA (citizen) · Operator/Police dashboards · Command Centre (GIS)
        │                      ← on-device model + simulator = offline / degraded mode
API gateway (OIDC + MFA, RBAC per request, rate limits, mTLS to edge)
        │
FastAPI modules: ingest · booking & FASTag · incident engine · notifications · audit ledger
        │
AI: forecast service (GBM ×3) · anomaly detection · analytics & PDF reporting
        │
PostgreSQL/PostGIS · time-series store · Firestore/Redis fan-out · WORM object store
        │
Edge camera nodes (on-device YOLO) · ANPR · NETC FASTag · weather & holiday calendar · e-challan
```

It is a modular monolith plus workers rather than microservices. That is easy to run per city and can be split only where load demands. See `/command/architecture` for the full rationale.

## Five-minute demo script

1. **Landing → Open the Command Centre** → sign in as **R. Meenakshi (Command Officer)**. Point out the SIMULATED DATA badge, IST clock and service status.
2. **Situation:** city KPIs. Click **T. Nagar** on the map to drill into its localities, then click **Pondy Bazaar Smart Bays** for live bays, the 60-min forecast and *why*.
3. **Drills → Festival rush · T. Nagar.** Within ~10 s, the cameras push T. Nagar lots to 95% and the engine raises **"T. Nagar: parking saturated"** (it correlates the earlier anomaly alert). An **illegal parking cluster** appears at Pondy Bazaar.
4. **Incidents:** open the saturation incident. Walk through the risk score (every point explained), the forecast interval and "why", and the recommended actions (reroute to lots with predicted free bays, VMS message, warden).
5. **Approve & dispatch.** The warden is notified and acknowledges, and moves on the map. VMS boards light up. Occupancy falls; the incident becomes **ready to close**. Close it with a note.
6. **Impact panel:** at detection vs. "forecast without action" vs. now.
7. **Sign out → sign in as Insp. A. Karthik (Police)** and open the cluster incident. Police can approve tow and e-challans, but policy actions are **locked**. Show the dispatch inbox on `/police`.
8. **Drills → Camera node failure · Velachery MRTS.** The node goes offline and the lot shows a grey dashed estimate. An incident opens recommending a vendor ticket. In the citizen app, bookings for that lot are paused.
9. **AI & forecasts:** model card, hold-out metrics, then the **what-if** simulator (turn on rain at Elliot's Beach and watch demand drop).
10. **Audit trail → Verify chain** (intact), then **Edit an entry → Verify** (broken at #N), then Undo. **Reports → Generate PDF.**

Tip: **Drills → New demo session** clears incidents for a fresh run. Refreshing the page keeps the session.

## Folder structure

```
slotify/
├── frontend/                    Next.js 15 · TypeScript · Tailwind · Leaflet · Recharts · jsPDF
│   ├── scripts/                 parity.ts (ML parity), export-cities.ts (configs → backend)
│   └── src/
│       ├── app/command/         situation · incidents · forecast · health · audit · reports · architecture
│       ├── app/login/           role sign-in
│       ├── app/{user,owner,police}/
│       ├── components/command/  shell, GIS map, charts, insights, incident queue, drill console
│       └── lib/
│           ├── cities/          chennai-south.ts · coimbatore.ts · types (one file per city)
│           ├── command/         store (engine loop, approvals, audit), engine (detectors), rbac, audit, report, scenarios
│           ├── ml/              forecast.ts + model.json (trained)
│           └── sim/             demand profiles shared with the training pipeline
├── backend/                     FastAPI
│   ├── app/routers/             lots · bookings · fastag · predictions (ML) · owner · police · command (cities, model card, audit)
│   ├── app/services/            forecast.py (ML inference), audit.py (hash chain), repository, detector, pricing
│   ├── app/security.py          RBAC (demo bearer tokens → swap for OIDC JWT)
│   ├── app/data/cities.json     exported from the frontend configs
│   └── tests/                   test_api.py · test_ml.py
├── ml/                          train.py (history generator + training + evaluation), parity_cases.py, model_card.json
└── firebase/                    Firestore schema, rules, indexes
```

## Known limits of the prototype

- Command Centre state (incidents, ledger) lives in the browser tab (sessionStorage). With the backend connected, the audit API is available for server-side persistence.
- Sign-in uses demo identities. The API accepts `Bearer demo:<role>:<user>` tokens in place of OIDC.
- Map tiles come from CARTO / OpenStreetMap and need internet access.
