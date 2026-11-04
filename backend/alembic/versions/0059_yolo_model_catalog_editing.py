"""Add editable model catalog metadata and soft deletion.

Revision ID: 0059_yolo_model_catalog_editing
Revises: 0058_yolo_model_management
"""

from alembic import op
import sqlalchemy as sa

revision = "0059_yolo_model_catalog_editing"
down_revision = "0058_yolo_model_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("yolo_model", sa.Column("name", sa.String(128)))
    op.add_column("yolo_model", sa.Column("description", sa.Text()))
    op.add_column("yolo_model", sa.Column("deleted_at", sa.DateTime(timezone=True)))
    for kind, label in (
        ("crack", "裂缝"), ("spalling", "脱落"), ("peeling", "起皮"),
        ("damage", "破损"), ("moisture", "渗漏"), ("hollow", "空鼓"),
    ):
        op.execute(sa.text("UPDATE yolo_model SET name = :name WHERE detection_type = :kind").bindparams(
            name=f"{label}检测 YOLO 模型", kind=kind,
        ))


def downgrade() -> None:
    for column in ("deleted_at", "description", "name"):
        op.drop_column("yolo_model", column)
