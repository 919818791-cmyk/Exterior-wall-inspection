from __future__ import annotations

import secrets

from sqlalchemy import select

from app.api.dependencies import DEMO_USERS
from app.core.config import get_settings
from app.core.security import hash_password, verify_password
from app.db.session import SessionLocal
from app.enums.status import UserStatus
from app.models.tables import UserAccount


def main() -> None:
    settings = get_settings()
    if settings.app_env.lower() != "production":
        print("Production account hardening skipped outside production.")
        return
    if settings.auth_seed_demo_users:
        raise SystemExit("Refusing to harden accounts while AUTH_SEED_DEMO_USERS=true.")

    demo_by_id = {account["id"]: account for account in DEMO_USERS}
    disabled = 0

    with SessionLocal() as db:
        accounts = list(
            db.scalars(select(UserAccount).where(UserAccount.id.in_(demo_by_id)))
        )
        for account in accounts:
            documented = demo_by_id[account.id]
            if documented["role"] == "admin":
                continue

            if account.status != UserStatus.DISABLED.value:
                account.status = UserStatus.DISABLED.value
                disabled += 1
            if verify_password(documented["password"], account.password_hash):
                account.password_hash = hash_password(secrets.token_urlsafe(24))

        db.commit()

    print("Admin accounts were left unchanged.")
    print(f"Disabled documented non-admin demo accounts: {disabled}")


if __name__ == "__main__":
    main()
