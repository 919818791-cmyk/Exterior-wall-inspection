from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.enums.status import FacadeType, PhotoStatus, PhotoType

PhotoResult = Literal["defects", "clear", "pending", "failed"]


class LibraryPhotoRead(BaseModel):
    id: UUID
    source_type: Literal["professional", "trial"] = "professional"
    project_id: UUID | None
    project_name: str
    project_no: str
    facade_type: FacadeType | None
    original_filename: str
    file_size: int | None
    image_width: int | None
    image_height: int | None
    photo_type: PhotoType
    status: PhotoStatus
    result: PhotoResult
    defect_counts: dict[str, int]
    preview_url: str | None
    thumbnail_url: str | None
    created_at: datetime


class LibraryProjectRead(BaseModel):
    id: UUID
    name: str


class PhotoLibrarySummary(BaseModel):
    total: int = 0
    defects: int = 0
    clear: int = 0
    pending: int = 0
    failed: int = 0


class PhotoLibraryRead(BaseModel):
    items: list[LibraryPhotoRead]
    projects: list[LibraryProjectRead]
    summary: PhotoLibrarySummary
    total: int
    page: int
    page_size: int


class PhotoExportRequest(BaseModel):
    photo_ids: list[UUID] = Field(min_length=1)


class PhotoFacadeUpdateRequest(PhotoExportRequest):
    facade_type: FacadeType


class PhotoFacadeUpdateRead(BaseModel):
    updated_count: int
    facade_type: FacadeType


class PhotoLibrarySelection(BaseModel):
    photo_ids: list[UUID]
    total: int
