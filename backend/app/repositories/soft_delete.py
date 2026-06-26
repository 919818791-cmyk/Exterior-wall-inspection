from __future__ import annotations

from typing import TypeVar

from sqlalchemy import Select

ModelT = TypeVar("ModelT")


def without_deleted(statement: Select[tuple[ModelT]], model: type[ModelT]) -> Select[tuple[ModelT]]:
    """Apply the default list-query rule for models that support soft delete."""
    deleted_at = getattr(model, "deleted_at", None)
    if deleted_at is None:
        return statement
    return statement.where(deleted_at.is_(None))
