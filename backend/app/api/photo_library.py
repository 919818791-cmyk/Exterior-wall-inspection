from __future__ import annotations

import csv
import json
import logging
import re
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from io import StringIO
from tempfile import SpooledTemporaryFile
from typing import Literal
from uuid import UUID
from zipfile import ZIP_STORED, ZipFile
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import case, func, or_, select, union_all
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert

from app.api.dependencies import AuthenticatedUser, ensure_project_write_access, get_current_user
from app.api.projects import _api_base_url
from app.api.photo_library_trials import trial_library_photos
from app.db.session import get_db
from app.enums.status import DefectType, FacadeType, PhotoType
from app.models.tables import AiDetectionResult, Photo, PhotoLibraryClassification, Project, QuickDetectionPhoto, ReviewResult, TrialDetectionResult
from app.schemas.photo_library import (
    LibraryPhotoRead,
    LibraryProjectRead,
    PhotoExportRequest,
    PhotoFacadeUpdateRead,
    PhotoFacadeUpdateRequest,
    PhotoLibraryRead,
    PhotoLibrarySelection,
    PhotoLibrarySummary,
    PhotoResult,
)
from app.services.object_storage import get_object_bytes, signed_object_url

router = APIRouter(tags=["photo-library"])
logger = logging.getLogger(__name__)
BUSINESS_TIMEZONE = ZoneInfo("Asia/Shanghai")
FACADE_LABELS = {
    "tile": "饰面砖", "coating": "涂饰", "plaster": "抹灰",
    "panel": "饰面板", "curtain_wall": "幕墙", "stone": "石材",
}
DEFECT_LABELS = {
    "crack": "裂缝", "spalling": "脱落", "peeling": "起皮",
    "damage": "面板破损", "moisture": "潮湿", "hollow": "空鼓",
}
RESULT_LABELS = {"defects": "检出缺陷", "clear": "未检出缺陷", "pending": "待检测", "failed": "检测失败"}


def _accessible_photos(current_user: AuthenticatedUser):
    statement = select(Photo, Project).join(Project, Project.id == Photo.project_id).where(
        Photo.deleted_at.is_(None), Project.deleted_at.is_(None),
    )
    if current_user.role == "customer":
        statement = statement.where(or_(Project.created_by == current_user.id, Project.is_example.is_(True)))
    return statement


def _effective_defects():
    # A review replaces its AI result, including deletions; manual additions are
    # included once. Only the project's current detection task is authoritative.
    ai = select(
        AiDetectionResult.photo_id.label("photo_id"),
        case((ReviewResult.id.is_not(None), ReviewResult.defect_type), else_=AiDetectionResult.defect_type).label("defect_type"),
    ).join(Project, Project.id == AiDetectionResult.project_id).outerjoin(
        ReviewResult, ReviewResult.ai_result_id == AiDetectionResult.id,
    ).where(
        AiDetectionResult.detection_task_id == Project.current_task_id,
        or_(ReviewResult.id.is_(None), ReviewResult.status != "deleted"),
    )
    manual = select(ReviewResult.photo_id, ReviewResult.defect_type).join(
        Project, Project.id == ReviewResult.project_id,
    ).where(
        ReviewResult.detection_task_id == Project.current_task_id,
        ReviewResult.ai_result_id.is_(None), ReviewResult.status != "deleted",
    )
    return union_all(ai, manual).subquery("library_effective_defects")


def _photo_result(defect_total):
    return case(
        (Photo.status == "failed", "failed"),
        (Photo.status != "detected", "pending"),
        (func.coalesce(defect_total, 0) > 0, "defects"),
        else_="clear",
    )


def _read_photo(photo: Photo, project: Project, counts: dict[str, int], api_base_url: str, facade_type: str | None = None) -> LibraryPhotoRead:
    result = "failed" if photo.status == "failed" else (
        "pending" if photo.status != "detected" else "defects" if counts else "clear"
    )
    preview_url = signed_object_url(api_base_url, photo.storage_bucket, photo.storage_object_key)
    thumbnail_url = signed_object_url(api_base_url, photo.storage_bucket, photo.thumbnail_object_key) or preview_url
    return LibraryPhotoRead(
        id=photo.id, project_id=project.id, project_name=project.name, project_no=project.project_no,
        facade_type=facade_type or project.facade_type, original_filename=photo.original_filename, file_size=photo.file_size,
        image_width=photo.image_width, image_height=photo.image_height, photo_type=photo.photo_type,
        status=photo.status, result=result, defect_counts=counts, preview_url=preview_url,
        thumbnail_url=thumbnail_url, created_at=photo.created_at,
    )


def _defect_counts(db: Session, effective, photo_ids: list[UUID]) -> dict[UUID, dict[str, int]]:
    counts: dict[UUID, dict[str, int]] = defaultdict(dict)
    if photo_ids:
        rows = db.execute(select(effective.c.photo_id, effective.c.defect_type, func.count()).where(
            effective.c.photo_id.in_(photo_ids),
        ).group_by(effective.c.photo_id, effective.c.defect_type))
        for photo_id, defect_type, count in rows:
            counts[photo_id][defect_type] = count
    return counts


def _classifications(db: Session, photo_ids: list[UUID]) -> dict[UUID, str]:
    return dict(db.execute(select(PhotoLibraryClassification.photo_id, PhotoLibraryClassification.facade_type).where(
        PhotoLibraryClassification.photo_id.in_(photo_ids),
    )).all()) if photo_ids else {}


@router.get("/photos/library", response_model=PhotoLibraryRead | PhotoLibrarySelection)
def list_library_photos(
    request: Request,
    search: str = Query(default="", max_length=128),
    project_id: UUID | None = None,
    facade_type: FacadeType | None = None,
    defect_type: DefectType | None = None,
    result: PhotoResult | None = None,
    photo_type: PhotoType | None = None,
    source_type: Literal["professional", "trial"] | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    sort: Literal["newest", "oldest", "filename"] = "newest",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, ge=1, le=200),
    selection_only: bool = False,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> PhotoLibraryRead | PhotoLibrarySelection:
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="开始日期不能晚于结束日期。")
    effective = _effective_defects()
    totals = select(effective.c.photo_id, func.count().label("total")).group_by(effective.c.photo_id).subquery()
    result_column = _photo_result(totals.c.total)
    statement = _accessible_photos(current_user).outerjoin(totals, totals.c.photo_id == Photo.id).outerjoin(
        PhotoLibraryClassification, PhotoLibraryClassification.photo_id == Photo.id,
    )
    if source_type == "trial":
        statement = statement.where(False)
    if search.strip():
        term = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        statement = statement.where(or_(
            Photo.original_filename.ilike(f"%{term}%", escape="\\"),
            Project.name.ilike(f"%{term}%", escape="\\"),
            Project.project_no.ilike(f"%{term}%", escape="\\"),
        ))
    if project_id:
        statement = statement.where(Project.id == project_id)
    if facade_type:
        statement = statement.where(func.coalesce(PhotoLibraryClassification.facade_type, Project.facade_type) == facade_type.value)
    if photo_type:
        statement = statement.where(Photo.photo_type == photo_type.value)
    if date_from:
        statement = statement.where(Photo.created_at >= datetime.combine(date_from, time.min, BUSINESS_TIMEZONE))
    if date_to:
        statement = statement.where(Photo.created_at < datetime.combine(date_to + timedelta(days=1), time.min, BUSINESS_TIMEZONE))

    # Result tabs show counts in the current search/project/material scope.
    summary_rows = db.execute(statement.with_only_columns(result_column, func.count()).group_by(result_column))
    summary_counts = dict(summary_rows.all())
    all_trials = [] if source_type == "professional" else trial_library_photos(db, current_user, _api_base_url(request))
    trials = [item for item, _, _ in all_trials if (
        (not search.strip() or search.strip().casefold() in " ".join([item.original_filename, item.project_name, item.project_no]).casefold())
        and (not project_id or item.project_id == project_id)
        and (not facade_type or item.facade_type == facade_type)
        and (not photo_type or item.photo_type == photo_type)
        and (not date_from or item.created_at.replace(tzinfo=item.created_at.tzinfo or UTC).astimezone(BUSINESS_TIMEZONE).date() >= date_from)
        and (not date_to or item.created_at.replace(tzinfo=item.created_at.tzinfo or UTC).astimezone(BUSINESS_TIMEZONE).date() <= date_to)
    )]
    for item in trials:
        summary_counts[item.result] = summary_counts.get(item.result, 0) + 1
    summary = PhotoLibrarySummary(total=sum(summary_counts.values()), **summary_counts)
    if result:
        statement = statement.where(result_column == result)
    if defect_type:
        statement = statement.where(select(effective.c.photo_id).where(
            effective.c.photo_id == Photo.id, effective.c.defect_type == defect_type.value,
        ).exists())
    trials = [item for item in trials if (not result or item.result == result) and (not defect_type or item.defect_counts.get(defect_type.value))]
    total = (db.scalar(select(func.count()).select_from(statement.with_only_columns(Photo.id).subquery())) or 0) + len(trials)
    if selection_only:
        return PhotoLibrarySelection(
            photo_ids=list(db.scalars(statement.with_only_columns(Photo.id).order_by(Photo.id))) + [item.id for item in trials],
            total=total,
        )
    page = min(page, max(1, (total + page_size - 1) // page_size))
    order = [Photo.created_at.desc(), Photo.id.desc()]
    if sort == "oldest":
        order = [Photo.created_at.asc(), Photo.id.asc()]
    elif sort == "filename":
        order = [Photo.original_filename.asc(), Photo.id.asc()]
    # Only fetch the professional prefix needed to merge this page with trials.
    rows = db.execute(statement.order_by(*order).offset(0 if trials else (page - 1) * page_size).limit(page * page_size if trials else page_size)).all()
    counts = _defect_counts(db, effective, [photo.id for photo, _ in rows])
    classifications = _classifications(db, [photo.id for photo, _ in rows])
    project_rows = db.execute(_accessible_photos(current_user).with_only_columns(Project.id, Project.name).distinct().order_by(Project.name)).all()
    items = [_read_photo(photo, project, counts.get(photo.id, {}), _api_base_url(request), classifications.get(photo.id)) for photo, project in rows]
    if trials:
        items += trials
        items.sort(key=lambda item: (item.original_filename, item.id) if sort == "filename" else (
            item.created_at.replace(tzinfo=item.created_at.tzinfo or UTC), item.id,
        ), reverse=sort == "newest")
        items = items[(page - 1) * page_size:page * page_size]
    projects = {project_id: name for project_id, name in project_rows} if source_type != "trial" else {}
    for item, _, _ in all_trials:
        if item.project_id:
            projects[item.project_id] = item.project_name
    return PhotoLibraryRead(
        items=items,
        projects=[LibraryProjectRead(id=project_id, name=name) for project_id, name in sorted(projects.items(), key=lambda entry: entry[1])],
        summary=summary, total=total, page=page, page_size=page_size,
    )


def _safe_filename(value: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip(" .")
    return name[:120] or "未命名"


def _csv_text(value: str) -> str:
    # Neutralize spreadsheet formulas in user-provided project/file names.
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value


@router.patch("/photos/facade-type", response_model=PhotoFacadeUpdateRead)
def update_photo_facade_type(
    payload: PhotoFacadeUpdateRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> PhotoFacadeUpdateRead:
    ids = list(dict.fromkeys(payload.photo_ids))
    rows = db.execute(_accessible_photos(current_user).where(Photo.id.in_(ids))).all()
    trials = trial_library_photos(db, current_user, "/api", set(ids) - {photo.id for photo, _ in rows})
    if len(rows) + len(trials) != len(ids):
        raise HTTPException(status_code=404, detail="部分照片不存在或无权访问，请刷新列表后重试。")
    # Validate the entire selection before writing anything; examples stay read-only.
    for _, project in rows:
        ensure_project_write_access(project, current_user)
    trial_result_ids = {item.project_id for item, _, _ in trials if item.project_id}
    for result in db.scalars(select(TrialDetectionResult).where(TrialDetectionResult.id.in_(trial_result_ids))):
        if result.is_example:
            raise HTTPException(status_code=403, detail="示例项目为只读项目。")
        if current_user.role != "admin" and result.generated_by != current_user.id:
            raise HTTPException(status_code=404, detail="部分照片不存在或无权访问。")
    pending_ids = [item.id for item, _, _ in trials if item.project_id is None]
    if current_user.role != "admin" and pending_ids:
        owned_pending = set(db.scalars(select(QuickDetectionPhoto.id).where(
            QuickDetectionPhoto.id.in_(pending_ids), QuickDetectionPhoto.uploaded_by == current_user.id,
        )))
        if len(owned_pending) != len(pending_ids):
            raise HTTPException(status_code=404, detail="部分照片不存在或无权访问。")
    now = datetime.now(UTC)
    statement = insert(PhotoLibraryClassification).values([
        {"photo_id": photo_id, "facade_type": payload.facade_type.value, "updated_by": current_user.id,
         "created_at": now, "updated_at": now} for photo_id in ids
    ])
    db.execute(statement.on_conflict_do_update(
        index_elements=[PhotoLibraryClassification.photo_id],
        set_={"facade_type": statement.excluded.facade_type, "updated_by": current_user.id, "updated_at": now},
    ))
    db.commit()
    return PhotoFacadeUpdateRead(updated_count=len(ids), facade_type=payload.facade_type)


@router.post("/photos/export")
def export_library_photos(
    payload: PhotoExportRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> StreamingResponse:
    ids = list(dict.fromkeys(payload.photo_ids))
    rows = db.execute(_accessible_photos(current_user).where(Photo.id.in_(ids)).order_by(Photo.id)).all()
    trials = trial_library_photos(db, current_user, "/api", set(ids) - {photo.id for photo, _ in rows})
    if len(rows) + len(trials) != len(ids):
        raise HTTPException(status_code=404, detail="部分照片不存在或无权访问，请刷新列表后重试。")
    counts = _defect_counts(db, _effective_defects(), ids)
    classifications = _classifications(db, ids)
    export_items = [(_read_photo(photo, project, counts.get(photo.id, {}), "/api", classifications.get(photo.id)), photo.storage_bucket, photo.storage_object_key)
                    for photo, project in rows] + trials
    archive_file = SpooledTemporaryFile(max_size=32 * 1024 * 1024)
    try:
        manifest = []
        csv_file = StringIO(newline="")
        writer = csv.writer(csv_file)
        writer.writerow(["照片编号", "文件名", "检测项目", "项目编号", "墙面类型", "检测结果", "缺陷统计", "照片类型", "上传时间", "导出路径", "检测来源"])
        with ZipFile(archive_file, "w", compression=ZIP_STORED) as archive:
            for item, bucket, key in export_items:
                facade_label = FACADE_LABELS.get(item.facade_type, "未分类")
                folder = f"{facade_label}/{RESULT_LABELS[item.result]}/{_safe_filename(item.project_name)}_{item.project_id.hex[:8] if item.project_id else 'trial'}"
                path = f"{folder}/{item.id}_{_safe_filename(item.original_filename)}"
                content = get_object_bytes(bucket, key)
                archive.writestr(path, content)
                defects = "、".join(f"{DEFECT_LABELS.get(key, key)} {count}处" for key, count in sorted(item.defect_counts.items()))
                writer.writerow([
                    str(item.id), _csv_text(item.original_filename), _csv_text(item.project_name), _csv_text(item.project_no),
                    facade_label, RESULT_LABELS[item.result], defects, item.photo_type,
                    item.created_at.replace(tzinfo=item.created_at.tzinfo or UTC).astimezone(BUSINESS_TIMEZONE).isoformat(), path,
                    "快速体验" if item.source_type == "trial" else "专业检测",
                ])
                manifest.append({
                    "photo_id": str(item.id), "filename": item.original_filename,
                    "source_type": item.source_type,
                    "project_id": str(item.project_id) if item.project_id else None, "project_name": item.project_name,
                    "facade_type": item.facade_type, "result": item.result,
                    "defect_counts": item.defect_counts, "path": path,
                })
            archive.writestr("照片清单.csv", "\ufeff" + csv_file.getvalue())
            archive.writestr("检测结果.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        archive_file.seek(0)
    except Exception as error:
        archive_file.close()
        if isinstance(error, HTTPException):
            raise
        logger.exception("photo_library_export_failed")
        raise HTTPException(status_code=502, detail="照片读取或打包失败，请稍后重试。") from error

    def chunks():
        try:
            while chunk := archive_file.read(1024 * 1024):
                yield chunk
        finally:
            archive_file.close()

    filename = f"inspection-photos-{datetime.now(UTC):%Y%m%d-%H%M%S}.zip"
    return StreamingResponse(chunks(), media_type="application/zip", headers={
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Cache-Control": "no-store",
    })
