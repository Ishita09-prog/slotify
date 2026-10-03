"""Pydantic models. API payloads are camelCase (matching the Next.js types) but accept snake_case too."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class SlotStatus(str, Enum):
    available = "available"
    occupied = "occupied"
    reserved = "reserved"
    maintenance = "maintenance"


SlotType = Literal["standard", "ev", "accessible", "compact"]
LotCategory = Literal["mall", "commercial", "transit", "hospital", "office", "recreation", "religious"]
PaymentMethod = Literal["fastag", "upi", "card"]
DemandLevel = Literal["high", "medium", "low"]
ViolationStatus = Literal["detected", "notice_sent", "challan_issued", "resolved"]


class Layout(CamelModel):
    rows: int
    cols: int


class Slot(CamelModel):
    id: str
    row: str
    col: int
    status: SlotStatus
    type: SlotType = "standard"
    vehicle_number: Optional[str] = None
    held_by: Optional[str] = None
    updated_at: int = 0  # epoch ms


class ParkingLot(CamelModel):
    id: str
    name: str
    area: str
    address: str
    lat: float
    lng: float
    category: LotCategory
    layout: Layout
    price_per_hour: float
    ev_surcharge_per_hour: float
    base_occupancy: float
    open_hours: str
    features: list[str]
    owner_id: str
    covered: bool
    city: str = ""


class LotSummary(CamelModel):
    total: int
    available: int
    occupied: int
    reserved: int
    maintenance: int
    occupancy: float


class LotWithStats(ParkingLot, LotSummary):
    distance_km: Optional[float] = None
    eta_min: Optional[int] = None


class BookingCreate(CamelModel):
    lot_id: str
    slot_id: str
    vehicle_number: str = Field(pattern=r"^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$|^\d{2}BH\d{4}[A-Z]{1,2}$")
    start_time: datetime
    duration_hours: int = Field(ge=1, le=24)
    payment_method: PaymentMethod = "fastag"


class Booking(CamelModel):
    id: str
    lot_id: str
    lot_name: str
    slot_id: str
    vehicle_number: str
    start_time: int
    duration_hours: int
    amount: float
    payment_method: PaymentMethod
    status: Literal["confirmed", "active", "completed", "cancelled"]
    created_at: int


class FastagTxn(CamelModel):
    id: str
    kind: Literal["debit", "credit"]
    amount: float
    description: str
    lot_name: Optional[str] = None
    duration_min: Optional[int] = None
    at: int
    balance_after: float


class Wallet(CamelModel):
    vehicle_number: str
    tag_id: str
    bank: str
    balance: float
    txns: list[FastagTxn] = []


class RechargeRequest(CamelModel):
    amount: float = Field(gt=0, le=10000)


class EntryRequest(CamelModel):
    lot_id: str


class ExitRequest(CamelModel):
    lot_id: str
    duration_minutes: Optional[int] = Field(default=None, ge=0, description="Override for demos; otherwise measured from entry")


class ExitReceipt(CamelModel):
    lot_id: str
    lot_name: str
    slot_id: str
    duration_min: int
    billable_hours: int
    prepaid_hours: int
    fee: float
    balance: float


class DetectionEvent(CamelModel):
    id: str
    lot_id: str
    slot_id: str
    from_: SlotStatus = Field(alias="from")
    to: SlotStatus
    camera: str
    confidence: float
    vehicle_number: Optional[str] = None
    at: int


class DetectionIngest(CamelModel):
    """Payload an edge camera (e.g. YOLO on a Jetson) posts when a bay changes state."""
    lot_id: str
    slot_id: str
    status: SlotStatus
    confidence: float = Field(ge=0, le=1)
    camera: str
    vehicle_number: Optional[str] = None


class AddSlotsRequest(CamelModel):
    row: str = Field(pattern=r"^[A-Z]$")
    count: int = Field(ge=1, le=20)
    type: SlotType = "standard"


class SlotIdsRequest(CamelModel):
    slot_ids: list[str]


class SlotStatusRequest(SlotIdsRequest):
    status: SlotStatus


class TrendPoint(CamelModel):
    hour: str
    typical: int
    actual: Optional[int] = None
    forecast: Optional[int] = None
    band: Optional[list[int]] = None


class Factor(CamelModel):
    label: str
    value: Optional[str] = None
    points: float


class PeakHour(CamelModel):
    label: str
    occupancy: int


class Prediction(CamelModel):
    lot_id: str
    current_occupancy: float
    predicted_occupancy: float
    predicted_available: int
    total_slots: int
    confidence: float
    arrival_at: int
    peak_hours: list[PeakHour]
    best_time_to_arrive: str
    trend: list[TrendPoint]
    low: Optional[float] = None
    high: Optional[float] = None
    range_available: Optional[list[int]] = None
    factors: list[Factor] = []
    model_version: Optional[str] = None
    horizon_min: Optional[int] = None


class OwnerAnalytics(CamelModel):
    lot_id: str
    summary: LotSummary
    revenue_today: float
    occupancy: list[dict]
    revenue: list[dict]
    peak: list[dict]


class Violation(CamelModel):
    id: str
    vehicle_number: str
    at: int
    location: str
    lat: float
    lng: float
    type: str
    confidence: float
    fine: int
    status: ViolationStatus
    camera: str
    city: str = ""


class ViolationUpdate(CamelModel):
    status: ViolationStatus


class LegalParking(CamelModel):
    id: str
    vehicle_number: str
    lat: float
    lng: float
    lot_name: str


class Zone(CamelModel):
    id: str
    name: str
    lat: float
    lng: float
    radius: int
    demand: DemandLevel
    occupancy: float
    vehicles_per_hour: int
    avg_search_min: int
    congestion_index: int
