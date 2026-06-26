from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column


def utc_now() -> datetime:
    return datetime.now(UTC)


def enum_values(enum_cls: type[StrEnum]) -> tuple[str, ...]:
    return tuple(item.value for item in enum_cls)


def enum_check(column_name: str, enum_cls: type[StrEnum], name: str) -> CheckConstraint:
    values = ", ".join(f"'{value}'" for value in enum_values(enum_cls))
    return CheckConstraint(f"{column_name} IN ({values})", name=name)


class UUIDPrimaryKeyMixin:
    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )


class CreatedAtMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )


class SoftDeleteMixin:
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


def status_column(
    default: StrEnum | str,
    length: int = 32,
    **kwargs: Any,
) -> Mapped[str]:
    value = default.value if isinstance(default, StrEnum) else default
    return mapped_column(String(length), default=value, nullable=False, **kwargs)
