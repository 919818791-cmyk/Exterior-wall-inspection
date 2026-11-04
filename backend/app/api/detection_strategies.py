from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedUser, require_roles
from app.db.session import get_db
from app.enums.status import UserRole
from app.schemas.detection_strategies import DetectionStrategyRead, DetectionStrategyUpdate
from app.services.detection_strategies import read_strategies, save_strategies

admin = require_roles(UserRole.ADMIN)
router = APIRouter(prefix="/detection-strategies", tags=["detection-strategies"], dependencies=[Depends(admin)])


@router.get("", response_model=list[DetectionStrategyRead])
def list_strategies(db: Session = Depends(get_db)):
    return read_strategies(db)


@router.put("", response_model=list[DetectionStrategyRead])
def update_strategies(payload: DetectionStrategyUpdate, db: Session = Depends(get_db), user: AuthenticatedUser = Depends(admin)):
    save_strategies(db, payload.items, user.id)
    return read_strategies(db)
