# Slotify Firestore schema

Field names are snake_case in Firestore; the API and frontend use camelCase.
Timestamps written by the backend are epoch milliseconds, except `updated_at` on slots,
which is a server timestamp so `onSnapshot` ordering is trustworthy.

```
parking_lots/{lotId}
│   name, area, address          string
│   location                     geopoint
│   lat, lng                     number   (duplicated for easy client maths)
│   category                     "mall" | "commercial" | "transit" | "hospital" | "office"
│   layout                       { rows: number, cols: number }
│   price_per_hour               number   (₹)
│   ev_surcharge_per_hour        number   (₹)
│   base_occupancy               number   0–1, prior used by the predictor
│   open_hours                   string
│   features                     string[]
│   owner_id                     string   → users/{uid}
│   covered                      bool
│
└── slots/{slotId}               e.g. "B4"
        row                      string   "B"
        col                      number   4
        status                   "available" | "occupied" | "reserved" | "maintenance"
        type                     "standard" | "ev" | "accessible" | "compact"
        vehicle_number           string | null
        held_by                  string | null  (vehicle holding a reservation / session)
        updated_at               timestamp

bookings/{bookingId}             e.g. "SLT-3F9A1C2B"
        lot_id, lot_name, slot_id
        vehicle_number, user_id
        start_time               number (ms)
        duration_hours           number
        amount                   number (₹, incl. ₹10 reservation fee)
        payment_method           "fastag" | "upi" | "card"
        status                   "confirmed" | "active" | "completed" | "cancelled"
        created_at               number (ms)

fastag_wallets/{vehicleNumber}   e.g. "TN38AB1234"
│       tag_id, bank, user_id
│       balance                  number (₹)
└── transactions/{txnId}
        kind                     "debit" | "credit"
        amount, balance_after    number
        description, lot_name
        duration_min             number | null
        at                       number (ms)

sessions/{vehicleNumber}         active gate sessions (entry → exit)
        lot_id, slot_id, entry_at, prepaid_hours, booking_id

detections/{eventId}             AI camera events (optional archive, TTL 7 days)
        lot_id, slot_id, from, to, camera, confidence, vehicle_number, at

violations/{violationId}         ANPR illegal-parking cases
        vehicle_number, at, location, lat, lng
        type, fine, confidence, camera
        status                   "detected" | "notice_sent" | "challan_issued" | "resolved"

zones/{zoneId}                   congestion analytics
        name, lat, lng, radius
        demand                   "high" | "medium" | "low"
        occupancy                number 0–1
        vehicles_per_hour, avg_search_min, congestion_index

users/{uid}
        name, phone, role        "driver" | "owner" | "police"
        vehicles                 string[]
```

## Data flow

1. Edge camera (or the built-in simulator) → `POST /api/detections`
2. FastAPI updates memory and mirrors `parking_lots/{lot}/slots/{slot}` to Firestore
3. Every dashboard holds an `onSnapshot` listener on `parking_lots/{lot}/slots` and re-renders

## Seeding

```
cd backend
FIREBASE_CREDENTIALS=./service-account.json python -m app.seed
```
