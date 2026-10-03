"""Seed Firestore with the Coimbatore pilot data.

    FIREBASE_CREDENTIALS=./service-account.json python -m app.seed
"""
import sys

from app.config import get_settings
from app.data import mock


def main():
    path = get_settings().firebase_credentials
    if not path:
        sys.exit("Set FIREBASE_CREDENTIALS to a service-account JSON path first.")
    import firebase_admin
    from firebase_admin import credentials, firestore

    firebase_admin.initialize_app(credentials.Certificate(path))
    db = firestore.client()
    batch, n = db.batch(), 0

    def put(ref, data):
        nonlocal batch, n
        batch.set(ref, data)
        n += 1
        if n % 400 == 0:
            batch.commit()
            batch = db.batch()

    for lot in mock.LOTS:
        lot_ref = db.collection("parking_lots").document(lot.id)
        put(lot_ref, {**lot.model_dump(exclude={"id"}, mode="json"), "location": firestore.GeoPoint(lot.lat, lot.lng)})
        for s in mock.generate_slots(lot):
            put(lot_ref.collection("slots").document(s.id), {**s.model_dump(exclude={"id"}, mode="json"), "updated_at": firestore.SERVER_TIMESTAMP})
    for v in mock.seed_violations():
        put(db.collection("violations").document(v.id), v.model_dump(mode="json"))
    for z in [z for c in mock.CITIES for z in mock.city_zones(c)]:
        put(db.collection("zones").document(z.id), z.model_dump(mode="json"))
    put(db.collection("fastag_wallets").document(mock.DEMO_VEHICLE),
        {"vehicle_number": mock.DEMO_VEHICLE, "balance": get_settings().starting_balance, "bank": "Kovai Co-op Bank FASTag"})
    batch.commit()
    print(f"Seeded {n} documents.")


if __name__ == "__main__":
    main()
