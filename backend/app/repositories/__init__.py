"""Repository layer package reserved for data-access code."""
from app.repositories.soft_delete import without_deleted

__all__ = ["without_deleted"]
