"""Slotify API — run with: uvicorn app.main:app --reload"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import bookings, command, fastag, lots, owner, police, predictions
from app.services import detector
from app.services.repository import repo

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    task = asyncio.create_task(detector.run(settings.detection_interval)) if settings.detection_interval > 0 else None
    yield
    if task:
        task.cancel()


app = FastAPI(
    title="Slotify API",
    version="2.0.0",
    description="Multi-city smart parking platform (South Chennai, Coimbatore): live bay status, reservations, FASTag billing, ML forecasts, enforcement, RBAC and a hash-chained audit ledger.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (lots, bookings, fastag, predictions, owner, police, command):
    app.include_router(r.router)


@app.get("/health", tags=["meta"])
def health():
    from app.services.forecast import card

    return {"status": "ok", "lots": len(repo.lots), "cities": sorted({l.city for l in repo.lots.values()}),
            "model": card()["version"], "firestore": repo.mirror is not None}
