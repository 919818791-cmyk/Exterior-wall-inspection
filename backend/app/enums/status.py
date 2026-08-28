from enum import StrEnum


class UserRole(StrEnum):
    CUSTOMER = "customer"
    REVIEWER = "reviewer"
    ADMIN = "admin"


class UserStatus(StrEnum):
    ACTIVE = "active"
    DISABLED = "disabled"


class ProjectStatus(StrEnum):
    DRAFT = "draft"
    QUEUED = "queued"
    DETECTING = "detecting"
    PENDING_REVIEW = "pending_review"
    REVIEWED = "reviewed"
    COMPLETED = "completed"


class DroneType(StrEnum):
    DJI_MAVIC_3_ENTERPRISE = "dji_mavic_3_enterprise"
    DJI_MAVIC_3_THERMAL = "dji_mavic_3_thermal"
    DJI_MATRICE_4E = "dji_matrice_4e"
    DJI_MATRICE_4T = "dji_matrice_4t"
    DJI_MATRICE_30 = "dji_matrice_30"
    DJI_MATRICE_30T = "dji_matrice_30t"
    DJI_MATRICE_300_RTK = "dji_matrice_300_rtk"
    DJI_MATRICE_350_RTK = "dji_matrice_350_rtk"
    DJI_MATRICE_400 = "dji_matrice_400"
    DJI_PHANTOM_4_RTK = "dji_phantom_4_rtk"
    AUTEL_EVO_MAX_4T = "autel_evo_max_4t"
    OTHER_PROFESSIONAL = "other_professional"


class FacadeType(StrEnum):
    TILE = "tile"
    COATING = "coating"
    STONE = "stone"


class DetectionTaskStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELED = "canceled"


class InspectionReportStatus(StrEnum):
    DRAFT = "draft"
    GENERATED = "generated"
    PUSHED = "pushed"
    REVOKED = "revoked"


class ReviewResultStatus(StrEnum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    MODIFIED = "modified"
    DELETED = "deleted"
    ADDED = "added"


class AiResultStatus(StrEnum):
    PENDING = "pending"


class DefectType(StrEnum):
    CRACK = "crack"
    SPALLING = "spalling"
    MOISTURE = "moisture"
    HOLLOW = "hollow"

    @classmethod
    def _missing_(cls, value: object) -> "DefectType | None":
        if isinstance(value, str) and value.strip().lower() == "missing":
            return cls.SPALLING
        return None


class PhotoType(StrEnum):
    VISIBLE = "visible"
    THERMAL = "thermal"
    DJI = "dji"
    OTHER = "other"


class PhotoStatus(StrEnum):
    UPLOADED = "uploaded"
    DETECTING = "detecting"
    DETECTED = "detected"
    FAILED = "failed"


class PhotoPrecheckStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    PASSED = "passed"
    REJECTED = "rejected"
    ERROR = "error"


class UploadMode(StrEnum):
    DJI = "dji"
    VISIBLE = "visible"
    THERMAL = "thermal"
    MIXED = "mixed"


class RecommendationOrientation(StrEnum):
    EAST = "east"
    SOUTH = "south"
    WEST = "west"
    NORTH = "north"
    SOUTHEAST = "southeast"
    SOUTHWEST = "southwest"
    NORTHEAST = "northeast"
    NORTHWEST = "northwest"


class ReviewOperationType(StrEnum):
    CONFIRM = "confirm"
    MODIFY = "modify"
    DELETE = "delete"
    ADD = "add"
    GENERATE_REPORT = "generate_report"
    PUSH_REPORT = "push_report"


class ReportPushMethod(StrEnum):
    PLATFORM = "platform"
    EMAIL = "email"
    MANUAL = "manual"


class ReportPushStatus(StrEnum):
    SUCCESS = "success"
    FAILED = "failed"
