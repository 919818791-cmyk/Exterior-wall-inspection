"""Explicit photo reviews, immutable AI baselines and versioned quality evaluations."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = "0064_recognition_quality"
down_revision = "0063_yolo_version_runtime"
branch_labels = None
depends_on = None


def reference(name, table, *, nullable=False, ondelete="CASCADE"):
    return sa.Column(name, pg.UUID(as_uuid=True), sa.ForeignKey(f"{table}.id", ondelete=ondelete), nullable=nullable)


def identity():
    return [sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False)]


def upgrade():
    op.add_column("inspection_report", sa.Column("quality_revision", sa.Integer(), server_default="0", nullable=False))
    op.add_column("inspection_report", sa.Column("quality_completed_revision", sa.Integer(), nullable=True))
    op.add_column("annotation_photo_edit", sa.Column("review_state", sa.String(16), server_default="pending", nullable=False))
    op.add_column("annotation_photo_edit", sa.Column("exclusion_reason", sa.String(500), nullable=True))
    op.add_column("annotation_photo_edit", reference("reviewed_by", "user_account", nullable=True, ondelete="RESTRICT"))
    op.add_column("annotation_photo_edit", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint("annotation_review_state", "annotation_photo_edit", "review_state IN ('pending', 'reviewed', 'excluded')")
    op.create_table("quality_baseline", *identity(),
        reference("detection_task_id", "detection_task"),
        sa.Column("data_json", pg.JSONB(), nullable=False),
        sa.UniqueConstraint("detection_task_id"))
    op.create_table("quality_evaluation", *identity(),
        reference("project_id", "project"), reference("detection_task_id", "detection_task"),
        reference("report_id", "inspection_report"), reference("baseline_id", "quality_baseline"),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("input_revision", sa.Integer(), nullable=False),
        sa.Column("rule_version", sa.String(64), nullable=False),
        sa.Column("summary_json", pg.JSONB(), nullable=False),
        sa.Column("photos_json", pg.JSONB(), nullable=False),
        reference("created_by", "user_account", ondelete="RESTRICT"),
        sa.UniqueConstraint("project_id", "version", name="uq_quality_evaluation_project_version"),
        sa.UniqueConstraint("report_id", "input_revision", "rule_version", name="uq_quality_evaluation_input"))
    op.create_index("idx_quality_evaluation_task", "quality_evaluation", ["detection_task_id"])


def downgrade():
    op.drop_table("quality_evaluation")
    op.drop_table("quality_baseline")
    op.drop_constraint(op.f("ck_annotation_photo_edit_annotation_review_state"), "annotation_photo_edit", type_="check")
    for name in ("reviewed_at", "reviewed_by", "exclusion_reason", "review_state"):
        op.drop_column("annotation_photo_edit", name)
    op.drop_column("inspection_report", "quality_completed_revision")
    op.drop_column("inspection_report", "quality_revision")
