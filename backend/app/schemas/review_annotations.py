from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.phase7 import ReportDetailRead


class ApiSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class AnnotationBBox(ApiSchema):
    model_config = ConfigDict(allow_inf_nan=False)
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class AnnotationBox(ApiSchema):
    id: str = Field(min_length=1, max_length=128)
    source_annotation_id: str | None = Field(default=None, max_length=128)
    defect_no: str | None = Field(default=None, max_length=64)
    defect_type: str = Field(min_length=1, max_length=32)
    bbox: AnnotationBBox
    confidence: float | None = Field(default=None, ge=0, le=1)


class AnnotationPhotoEditRequest(ApiSchema):
    photo_key: str = Field(min_length=1, max_length=512)
    annotations: list[AnnotationBox] = Field(max_length=1000)
    review_state: Literal["pending", "reviewed", "excluded"] = "pending"
    exclusion_reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_review(self):
        if self.review_state == "excluded" and not (self.exclusion_reason or "").strip():
            raise ValueError("无法评估时必须填写原因。")
        if len({item.id for item in self.annotations}) != len(self.annotations):
            raise ValueError("同一照片的标注 ID 不能重复。")
        return self


class AnnotationPhotoEditRead(ApiSchema):
    id: UUID
    source_type: Literal["formal"]
    result_id: UUID
    photo_key: str
    annotations: list[AnnotationBox]
    edited_by: UUID
    created_at: datetime
    updated_at: datetime
    review_state: Literal["pending", "reviewed", "excluded"] = "pending"
    exclusion_reason: str | None = None
    reviewed_by: UUID | None = None
    reviewed_at: datetime | None = None


class ReviewAnnotationDetail(ApiSchema):
    result: ReportDetailRead
    edits: list[AnnotationPhotoEditRead]
    generate_building_model: bool = False
    has_building_model: bool = False
    has_building_model_images: bool = False
