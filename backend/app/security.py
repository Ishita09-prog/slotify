"""Role-based access control.

Prototype: the bearer token is `demo:<role>:<user-id>` so the API can be exercised without an IdP.
Production: replace `current_user` with OIDC JWT validation (issuer, audience, expiry, signature via JWKS);
the permission checks below stay exactly the same.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, Header, HTTPException

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "command": {"command.view", "incident.approve", "incident.approve_enforcement", "incident.assign", "incident.resolve",
                "scenario.run", "health.chaos", "report.generate", "audit.view", "audit.verify", "slots.manage"},
    "police": {"command.view", "incident.approve_enforcement", "incident.assign", "incident.resolve", "report.generate", "challan.issue"},
    "operator": {"slots.manage"},
    "citizen": set(),
}


@dataclass
class User:
    id: str
    role: str

    def can(self, permission: str) -> bool:
        return permission in ROLE_PERMISSIONS.get(self.role, set())


def current_user(authorization: Optional[str] = Header(None)) -> Optional[User]:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    parts = authorization.split(" ", 1)[1].split(":")
    if len(parts) != 3 or parts[0] != "demo" or parts[1] not in ROLE_PERMISSIONS:
        raise HTTPException(401, "Invalid token")
    return User(id=parts[2], role=parts[1])


def require(permission: str):
    def dep(user: Optional[User] = Depends(current_user)) -> User:
        if user is None:
            raise HTTPException(401, "Sign in required")
        if not user.can(permission):
            raise HTTPException(403, f"Role '{user.role}' lacks permission '{permission}'")
        return user

    return dep
