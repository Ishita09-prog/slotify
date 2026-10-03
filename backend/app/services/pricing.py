import math

from app.config import get_settings


def reservation_quote(price_per_hour: float, ev_surcharge: float, hours: int, is_ev: bool) -> float:
    parking = price_per_hour * hours
    ev = ev_surcharge * hours if is_ev else 0
    return parking + ev + get_settings().reservation_fee


def exit_fee(duration_min: int, price_per_hour: float, prepaid_hours: int = 0) -> tuple[int, float]:
    """First GRACE minutes free, then per started hour, minus hours prepaid with a reservation."""
    if duration_min <= get_settings().grace_minutes:
        return 0, 0.0
    hours = math.ceil(duration_min / 60)
    billable = max(0, hours - prepaid_hours)
    return billable, billable * price_per_hour
