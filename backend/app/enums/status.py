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
    DETECTING = "detecting"
    PENDING_REVIEW = "pending_review"
    REVIEWED = "reviewed"
    COMPLETED = "completed"


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
    HOLLOWING = "hollowing"
    LEAKAGE = "leakage"
    CORROSION = "corrosion"


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
