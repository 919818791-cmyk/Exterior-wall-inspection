from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedUser, ensure_project_access, get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.enums.status import ProjectStatus
from app.models.tables import AiDetectionResult, DetectionTask, Photo, Project
from app.schemas.projects import (
    DeleteResponse,
    ProjectCreateRequest,
    ProjectDraftCreateRequest,
    ProjectDetailRead,
    ProjectListItem,
    ProjectUpdateRequest,
)
from app.services.object_storage import signed_object_url

router = APIRouter(tags=["projects"])

PROJECT_NO_TIMEZONE = ZoneInfo("Asia/Shanghai")
PROJECT_NO_DAILY_LIMIT = 999


def _project_number_date() -> str:
    return datetime.now(PROJECT_NO_TIMEZONE).strftime("%Y%m%d")


def _now_project_no(db: Session) -> str:
    project_date = _project_number_date()
    prefix = f"PRJ-{project_date}-"

    # Serialize number allocation for the current business date. The lock is
    # transaction-scoped, so concurrent project creation cannot reuse a suffix.
    db.execute(select(func.pg_advisory_xact_lock(int(project_date))))
    existing_numbers = db.scalars(
        select(Project.project_no).where(Project.project_no.like(f"{prefix}___"))
    )
    last_sequence = max(
        (
            int(project_no.removeprefix(prefix))
            for project_no in existing_numbers
            if project_no.removeprefix(prefix).isdigit()
        ),
        default=0,
    )
    next_sequence = last_sequence + 1
    if next_sequence > PROJECT_NO_DAILY_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The daily project number limit has been reached.",
        )
    return f"{prefix}{next_sequence:03d}"


def _generated_project_name(project_no: str) -> str:
    timestamp = project_no.removeprefix("PRJ-").split("-", maxsplit=1)[0][:14]
    return f"未命名项目-{timestamp}"


def _get_project_or_404(db: Session, project_id: UUID) -> Project:
    project = db.get(Project, project_id)
    if project is None or project.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    return project


def _ensure_project_editable(project: Project) -> None:
    if project.status != ProjectStatus.DRAFT.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only draft projects can be edited.",
        )


def _count_photos(db: Session, project_id: UUID) -> int:
    return db.scalar(
        select(func.count())
        .select_from(Photo)
        .where(Photo.project_id == project_id, Photo.deleted_at.is_(None))
    ) or 0


def _api_base_url(request: Request) -> str:
    headers = getattr(request, "headers", {})
    request_url = getattr(request, "url", None)
    scheme = headers.get("x-forwarded-proto") or getattr(request_url, "scheme", "http")
    host = headers.get("x-forwarded-host") or headers.get("host") or getattr(request_url, "netloc", "testserver")
    prefix = get_settings().api_prefix.strip("/")
    return f"{scheme}://{host}/{prefix}" if prefix else f"{scheme}://{host}"


def _project_list_item(
    db: Session,
    project: Project,
    *,
    photo_count: int | None = None,
    total_defects: int | None = None,
    by_defect_type: dict[str, int] | None = None,
) -> ProjectListItem:
    return ProjectListItem(
        id=project.id,
        project_no=project.project_no,
        name=project.name,
        client_name=project.client_name,
        province=project.province,
        city=project.city,
        district=project.district,
        address=project.address,
        longitude=project.longitude,
        latitude=project.latitude,
        status=project.status,
        current_report_id=project.current_report_id,
        photo_count=_count_photos(db, project.id) if photo_count is None else photo_count,
        total_defects=(
            db.scalar(
                select(func.count())
                .select_from(AiDetectionResult)
                .where(
                    AiDetectionResult.project_id == project.id,
                    AiDetectionResult.detection_task_id == project.current_task_id,
                )
            ) or 0
        ) if total_defects is None else total_defects,
        by_defect_type=by_defect_type or {},
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def _project_detail(db: Session, project: Project) -> ProjectDetailRead:
    current_task = db.get(DetectionTask, project.current_task_id) if project.current_task_id else None
    return ProjectDetailRead(
        **_project_list_item(db, project).model_dump(),
        current_task_id=project.current_task_id,
        current_task_status=current_task.status if current_task else None,
        started_at=project.started_at,
        completed_at=project.completed_at,
    )


def _apply_update(model: object, payload: ProjectUpdateRequest) -> None:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(model, field, value)


def _create_project_record(
    db: Session,
    payload: ProjectCreateRequest,
    current_user: AuthenticatedUser,
    *,
    client_draft_key: str | None = None,
) -> Project:
    project_no = _now_project_no(db)
    project_name = payload.name.strip() if payload.name and payload.name.strip() else None
    project = Project(
        project_no=project_no,
        client_draft_key=client_draft_key,
        name=project_name or _generated_project_name(project_no),
        client_name=payload.client_name,
        province=payload.province,
        city=payload.city,
        district=payload.district,
        address=payload.address,
        longitude=payload.longitude,
        latitude=payload.latitude,
        status=ProjectStatus.DRAFT.value,
        created_by=current_user.id,
    )
    db.add(project)
    db.flush()

    return project


def _find_project_by_draft_key(
    db: Session,
    current_user: AuthenticatedUser,
    client_draft_key: str,
) -> Project | None:
    return db.scalar(
        select(Project).where(
            Project.created_by == current_user.id,
            Project.client_draft_key == client_draft_key,
            Project.deleted_at.is_(None),
        )
    )


@router.get("/projects", response_model=list[ProjectListItem])
def list_projects(
    request: Request,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> list[ProjectListItem]:
    criteria = [Project.deleted_at.is_(None)]
    if current_user.role == "customer":
        criteria.append(Project.created_by == current_user.id)
    projects = list(
        db.scalars(
            select(Project)
            .where(*criteria)
            .order_by(Project.updated_at.desc(), Project.created_at.desc())
        )
    )
    if not projects:
        return []

    project_ids = [project.id for project in projects]
    photo_counts = dict(
        db.execute(
            select(Photo.project_id, func.count())
            .where(
                Photo.project_id.in_(project_ids),
                Photo.deleted_at.is_(None),
            )
            .group_by(Photo.project_id)
        ).all()
    )
    current_task_ids = [project.current_task_id for project in projects if project.current_task_id]
    defect_counts: dict[UUID, dict[str, int]] = {}
    for task_id, defect_type, count in db.execute(
            select(AiDetectionResult.detection_task_id, AiDetectionResult.defect_type, func.count())
            .where(AiDetectionResult.detection_task_id.in_(current_task_ids))
            .group_by(AiDetectionResult.detection_task_id, AiDetectionResult.defect_type)
        ).all() if current_task_ids else []:
        defect_counts.setdefault(task_id, {})[defect_type] = int(count)
    first_photos: dict[UUID, Photo] = {}
    for photo in db.scalars(
        select(Photo)
        .where(
            Photo.project_id.in_(project_ids),
            Photo.deleted_at.is_(None),
        )
        .order_by(Photo.project_id.asc(), Photo.created_at.asc())
    ):
        first_photos.setdefault(photo.project_id, photo)

    items: list[ProjectListItem] = []
    for project in projects:
        first_photo = first_photos.get(project.id)
        first_photo_url = None
        # Prefer the lightweight thumbnail. Falling back to the original keeps
        # legacy/local data usable until its thumbnail backfill has run.
        if first_photo is not None:
            first_photo_url = signed_object_url(
                _api_base_url(request),
                first_photo.storage_bucket,
                first_photo.thumbnail_object_key or first_photo.storage_object_key,
            )
        items.append(
            _project_list_item(
                db,
                project,
                photo_count=int(photo_counts.get(project.id, 0)),
                total_defects=sum(defect_counts.get(project.current_task_id, {}).values()),
                by_defect_type=defect_counts.get(project.current_task_id, {}),
            ).model_copy(update={"first_photo_url": first_photo_url})
        )
    return items


@router.post(
    "/projects",
    response_model=ProjectDetailRead,
    status_code=status.HTTP_201_CREATED,
)
def create_project(
    payload: ProjectCreateRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ProjectDetailRead:
    project = _create_project_record(db, payload, current_user)
    db.commit()
    db.refresh(project)
    return _project_detail(db, project)


@router.post(
    "/projects/drafts",
    response_model=ProjectDetailRead,
    status_code=status.HTTP_201_CREATED,
)
def create_project_draft(
    payload: ProjectDraftCreateRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ProjectDetailRead:
    existing_project = _find_project_by_draft_key(
        db,
        current_user,
        payload.client_draft_key,
    )
    if existing_project is not None:
        return _project_detail(db, existing_project)

    try:
        project = _create_project_record(
            db,
            payload,
            current_user,
            client_draft_key=payload.client_draft_key,
        )
        db.commit()
    except IntegrityError:
        # A concurrent retry may win the unique-key race. Resolve it to the
        # already-created draft instead of leaking a duplicate or a 500.
        db.rollback()
        existing_project = _find_project_by_draft_key(
            db,
            current_user,
            payload.client_draft_key,
        )
        if existing_project is None:
            raise
        return _project_detail(db, existing_project)

    db.refresh(project)
    return _project_detail(db, project)


@router.get("/projects/{project_id}", response_model=ProjectDetailRead)
def get_project(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ProjectDetailRead:
    project = _get_project_or_404(db, project_id)
    ensure_project_access(project, current_user)
    return _project_detail(db, project)


@router.put("/projects/{project_id}", response_model=ProjectDetailRead)
def update_project(
    project_id: UUID,
    payload: ProjectUpdateRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ProjectDetailRead:
    project = _get_project_or_404(db, project_id)
    ensure_project_access(project, current_user)
    if "name" in payload.model_fields_set:
        project_name = payload.name.strip() if payload.name and payload.name.strip() else None
        payload = payload.model_copy(
            update={"name": project_name or _generated_project_name(project.project_no)}
        )
    _apply_update(project, payload)
    db.commit()
    db.refresh(project)
    return _project_detail(db, project)


@router.delete("/projects/{project_id}", response_model=DeleteResponse)
def delete_project(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> DeleteResponse:
    project = _get_project_or_404(db, project_id)
    ensure_project_access(project, current_user)
    _ensure_project_editable(project)
    deleted_at = datetime.now(UTC)
    project.deleted_at = deleted_at

    db.commit()
    return DeleteResponse()
