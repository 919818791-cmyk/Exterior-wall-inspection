from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.phase7 import ReportDetailRead


class ApiSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class AnnotationBBox(ApiSchema):
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class AnnotationBox(ApiSchema):
    id: str = Field(min_length=1, max_length=128)
    source_annotation_id: str | None = Field(default=None, max_length=128)
    defect_type: str = Field(min_length=1, max_length=32)
    bbox: AnnotationBBox
    confidence: float | None = Field(default=None, ge=0, le=1)


class AnnotationPhotoEditRequest(ApiSchema):
    photo_key: str = Field(min_length=1, max_length=512)
    annotations: list[AnnotationBox] = Field(max_length=1000)


class AnnotationPhotoEditRead(ApiSchema):
    id: UUID
    source_type: Literal["formal"]
    result_id: UUID
    photo_key: str
    annotations: list[AnnotationBox]
    edited_by: UUID
    created_at: datetime
    updated_at: datetime


class ReviewAnnotationDetail(ApiSchema):
    result: ReportDetailRead
    edits: list[AnnotationPhotoEditRead]
