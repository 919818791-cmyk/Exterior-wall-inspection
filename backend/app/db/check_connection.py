from __future__ import annotations

from sqlalchemy import text

from app.db.session import engine


def main() -> None:
    with engine.connect() as connection:
        value = connection.execute(text("select 1")).scalar_one()
    print(f"database connection ok: {value}")


if __name__ == "__main__":
    main()
