from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedUser, ensure_project_access, get_current_user, require_roles
from app.db.session import get_db
from app.enums.status import ProjectStatus, UserRole
from app.models.tables import Building, DetectionTask, Facade, Photo, Project
from app.schemas.projects import (
    BuildingCreateRequest,
    BuildingRead,
    BuildingUpdateRequest,
    DeleteResponse,
    FacadeCreateRequest,
    FacadeRead,
    FacadeUpdateRequest,
    ProjectCreateRequest,
    ProjectDetailRead,
    ProjectListItem,
    ProjectUpdateRequest,
)

router = APIRouter(tags=["projects"], dependencies=[Depends(require_roles(UserRole.ADMIN))])

def _now_project_no() -> str:
    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S%f")
    return f"PRJ-{timestamp}-{uuid4().hex[:6].upper()}"


def _get_project_or_404(db: Session, project_id: UUID) -> Project:
    project = db.get(Project, project_id)
    if project is None or project.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    return project


def _get_building_or_404(db: Session, building_id: UUID) -> Building:
    building = db.scalar(
        select(Building).where(Building.id == building_id, Building.deleted_at.is_(None))
    )
    if building is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Building not found.")
    return building


def _get_facade_or_404(db: Session, facade_id: UUID) -> Facade:
    facade = db.scalar(select(Facade).where(Facade.id == facade_id, Facade.deleted_at.is_(None)))
    if facade is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Facade not found.")
    return facade


def _ensure_project_editable(project: Project) -> None:
    if project.status != ProjectStatus.DRAFT.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only draft projects can be edited.",
        )


def _count_buildings(db: Session, project_id: UUID) -> int:
    return db.scalar(
        select(func.count())
        .select_from(Building)
        .where(Building.project_id == project_id, Building.deleted_at.is_(None))
    ) or 0


def _count_photos(db: Session, project_id: UUID) -> int:
    return db.scalar(
        select(func.count())
        .select_from(Photo)
        .where(Photo.project_id == project_id, Photo.deleted_at.is_(None))
    ) or 0


def _list_active_facades(db: Session, building_id: UUID) -> list[Facade]:
    return list(
        db.scalars(
            select(Facade)
            .where(Facade.building_id == building_id, Facade.deleted_at.is_(None))
            .order_by(Facade.sort_order.asc(), Facade.created_at.asc())
        )
    )


def _to_facade_read(facade: Facade) -> FacadeRead:
    return FacadeRead.model_validate(facade)


def _to_building_read(db: Session, building: Building) -> BuildingRead:
    facades = [_to_facade_read(facade) for facade in _list_active_facades(db, building.id)]
    return BuildingRead(
        id=building.id,
        project_id=building.project_id,
        name=building.name,
        building_no=building.building_no,
        floors=building.floors,
        height=building.height,
        structure_type=building.structure_type,
        usage_type=building.usage_type,
        built_year=building.built_year,
        remark=building.remark,
        sort_order=building.sort_order,
        facade_count=len(facades),
        facades=facades,
        created_at=building.created_at,
        updated_at=building.updated_at,
    )


def _project_list_item(db: Session, project: Project) -> ProjectListItem:
    return ProjectListItem(
        id=project.id,
        project_no=project.project_no,
        name=project.name,
        client_name=project.client_name,
        contact_name=project.contact_name,
        contact_phone=project.contact_phone,
        province=project.province,
        city=project.city,
        district=project.district,
        address=project.address,
        longitude=project.longitude,
        latitude=project.latitude,
        status=project.status,
        building_count=_count_buildings(db, project.id),
        photo_count=_count_photos(db, project.id),
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def _project_detail(db: Session, project: Project) -> ProjectDetailRead:
    buildings = list(
        db.scalars(
            select(Building)
            .where(Building.project_id == project.id, Building.deleted_at.is_(None))
            .order_by(Building.sort_order.asc(), Building.created_at.asc())
        )
    )
    current_task = db.get(DetectionTask, project.current_task_id) if project.current_task_id else None
    return ProjectDetailRead(
        **_project_list_item(db, project).model_dump(),
        current_task_id=project.current_task_id,
        current_report_id=project.current_report_id,
        current_task_status=current_task.status if current_task else None,
        started_at=project.started_at,
        completed_at=project.completed_at,
        buildings=[_to_building_read(db, building) for building in buildings],
    )


def _create_building(
    db: Session,
    project: Project,
    payload: BuildingCreateRequest,
    sort_order: int,
) -> Building:
    data = payload.model_dump(exclude={"facades"})
    building = Building(
        project_id=project.id,
        name=data["name"],
        building_no=data.get("building_no"),
        floors=data.get("floors"),
        height=data.get("height"),
        structure_type=data.get("structure_type"),
        usage_type=data.get("usage_type"),
        built_year=data.get("built_year"),
        remark=data.get("remark"),
        sort_order=data.get("sort_order") if data.get("sort_order") is not None else sort_order,
    )
    db.add(building)
    db.flush()

    for facade_index, facade_payload in enumerate(payload.facades):
        _create_facade(db, project, building, facade_payload, facade_index)

    return building


def _create_facade(
    db: Session,
    project: Project,
    building: Building,
    payload: FacadeCreateRequest,
    sort_order: int,
) -> Facade:
    data = payload.model_dump()
    facade = Facade(
        project_id=project.id,
        building_id=building.id,
        name=data["name"],
        area=data.get("area"),
        floors_range=data.get("floors_range"),
        description=data.get("description"),
        sort_order=data.get("sort_order") if data.get("sort_order") is not None else sort_order,
    )
    db.add(facade)
    db.flush()
    return facade


def _apply_update(model: object, payload: ProjectUpdateRequest | BuildingUpdateRequest | FacadeUpdateRequest) -> None:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(model, field, value)


@router.get("/projects", response_model=list[ProjectListItem])
def list_projects(
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
    return [_project_list_item(db, project) for project in projects]


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
    project = Project(
        project_no=_now_project_no(),
        name=payload.name,
        client_name=payload.client_name,
        contact_name=payload.contact_name,
        contact_phone=payload.contact_phone,
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

    for index, building_payload in enumerate(payload.buildings):
        _create_building(db, project, building_payload, index)

    db.commit()
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
    _ensure_project_editable(project)
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

    buildings = list(db.scalars(select(Building).where(Building.project_id == project.id)))
    facades = list(db.scalars(select(Facade).where(Facade.project_id == project.id)))
    for building in buildings:
        building.deleted_at = deleted_at
    for facade in facades:
        facade.deleted_at = deleted_at

    db.commit()
    return DeleteResponse()


@router.post(
    "/projects/{project_id}/buildings",
    response_model=BuildingRead,
    status_code=status.HTTP_201_CREATED,
)
def create_building(
    project_id: UUID,
    payload: BuildingCreateRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> BuildingRead:
    project = _get_project_or_404(db, project_id)
    ensure_project_access(project, current_user)
    _ensure_project_editable(project)
    sort_order = _count_buildings(db, project.id)
    building = _create_building(db, project, payload, sort_order)
    project.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(building)
    return _to_building_read(db, building)


@router.put("/buildings/{building_id}", response_model=BuildingRead)
def update_building(
    building_id: UUID,
    payload: BuildingUpdateRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> BuildingRead:
    building = _get_building_or_404(db, building_id)
    project = _get_project_or_404(db, building.project_id)
    ensure_project_access(project, current_user)
    _ensure_project_editable(project)
    _apply_update(building, payload)
    project.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(building)
    return _to_building_read(db, building)


@router.delete("/buildings/{building_id}", response_model=DeleteResponse)
def delete_building(
    building_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> DeleteResponse:
    building = _get_building_or_404(db, building_id)
    project = _get_project_or_404(db, building.project_id)
    ensure_project_access(project, current_user)
    _ensure_project_editable(project)
    deleted_at = datetime.now(UTC)
    building.deleted_at = deleted_at
    facades = list(db.scalars(select(Facade).where(Facade.building_id == building.id)))
    for facade in facades:
        facade.deleted_at = deleted_at
    project.updated_at = deleted_at
    db.commit()
    return DeleteResponse()


@router.post(
    "/buildings/{building_id}/facades",
    response_model=FacadeRead,
    status_code=status.HTTP_201_CREATED,
)
def create_facade(
    building_id: UUID,
    payload: FacadeCreateRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> FacadeRead:
    building = _get_building_or_404(db, building_id)
    project = _get_project_or_404(db, building.project_id)
    ensure_project_access(project, current_user)
    _ensure_project_editable(project)
    sort_order = len(_list_active_facades(db, building.id))
    facade = _create_facade(db, project, building, payload, sort_order)
    project.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(facade)
    return _to_facade_read(facade)


@router.put("/facades/{facade_id}", response_model=FacadeRead)
def update_facade(
    facade_id: UUID,
    payload: FacadeUpdateRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> FacadeRead:
    facade = _get_facade_or_404(db, facade_id)
    project = _get_project_or_404(db, facade.project_id)
    ensure_project_access(project, current_user)
    _ensure_project_editable(project)
    _apply_update(facade, payload)
    project.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(facade)
    return _to_facade_read(facade)


@router.delete("/facades/{facade_id}", response_model=DeleteResponse)
def delete_facade(
    facade_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> DeleteResponse:
    facade = _get_facade_or_404(db, facade_id)
    project = _get_project_or_404(db, facade.project_id)
    ensure_project_access(project, current_user)
    _ensure_project_editable(project)
    deleted_at = datetime.now(UTC)
    facade.deleted_at = deleted_at
    project.updated_at = deleted_at
    db.commit()
    return DeleteResponse()
