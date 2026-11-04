"""Give YOLO models independent identities and multiple detection capabilities.

Revision ID: 0061_yolo_multi_detection_types
Revises: 0060_photo_library_facades
"""
from uuid import NAMESPACE_URL, uuid5

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0061_yolo_multi_detection_types"
down_revision = "0060_photo_library_facades"
branch_labels = None
depends_on = None

KINDS = ("crack", "spalling", "peeling", "damage", "moisture", "hollow")


def upgrade() -> None:
    op.add_column("yolo_model", sa.Column("id", postgresql.UUID(as_uuid=True)))
    op.add_column("yolo_model_version", sa.Column("model_id", postgresql.UUID(as_uuid=True)))
    for kind in KINDS:
        # Stable backfill IDs also work when Alembic renders an offline SQL script.
        identifier = uuid5(NAMESPACE_URL, f"building-exterior/yolo-model/{kind}")
        for table, column in (("yolo_model", "id"), ("yolo_model_version", "model_id")):
            op.execute(sa.text(f"UPDATE {table} SET {column} = :identifier WHERE detection_type = :kind").bindparams(
                sa.bindparam("identifier", identifier, type_=postgresql.UUID(as_uuid=True)),
                sa.bindparam("kind", kind, type_=sa.String()),
            ))
    op.alter_column("yolo_model", "id", nullable=False)
    op.alter_column("yolo_model_version", "model_id", nullable=False)
    op.drop_constraint(op.f("fk_yolo_model_version_detection_type_yolo_model"), "yolo_model_version", type_="foreignkey")
    op.drop_constraint("uq_yolo_model_version_label", "yolo_model_version", type_="unique")
    op.drop_index("uq_yolo_model_active_version", table_name="yolo_model_version")
    op.drop_constraint(op.f("pk_yolo_model"), "yolo_model", type_="primary")
    op.drop_constraint(op.f("ck_yolo_model_detection_type"), "yolo_model", type_="check")
    op.drop_column("yolo_model", "detection_type")
    op.create_primary_key(op.f("pk_yolo_model"), "yolo_model", ["id"])
    op.create_foreign_key(op.f("fk_yolo_model_version_model_id_yolo_model"), "yolo_model_version", "yolo_model", ["model_id"], ["id"], ondelete="RESTRICT")
    op.drop_column("yolo_model_version", "detection_type")
    op.create_unique_constraint("uq_yolo_model_version_label", "yolo_model_version", ["model_id", "version"])
    op.create_index("uq_yolo_model_active_version", "yolo_model_version", ["model_id"], unique=True, postgresql_where=sa.text("is_active"))
    capabilities = op.create_table(
        "yolo_model_detection_type",
        sa.Column("model_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("yolo_model.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("detection_type", sa.String(32), primary_key=True),
        sa.CheckConstraint("detection_type IN ('crack', 'spalling', 'peeling', 'damage', 'moisture', 'hollow')", name="detection_type"),
    )
    models = sa.table("yolo_model", sa.column("id", postgresql.UUID(as_uuid=True)))
    for kind in KINDS:
        identifier = uuid5(NAMESPACE_URL, f"building-exterior/yolo-model/{kind}")
        op.execute(capabilities.insert().from_select(
            ["model_id", "detection_type"],
            sa.select(models.c.id, sa.literal(kind)).where(models.c.id == identifier),
        ))


def downgrade() -> None:
    # Refuse a lossy downgrade: the old schema cannot represent overlapping or
    # multi-type models, including deleted models whose weights are retained.
    op.execute(sa.text("""
        DO $$ BEGIN
            IF EXISTS (
                SELECT m.id FROM yolo_model m LEFT JOIN yolo_model_detection_type t ON t.model_id = m.id
                GROUP BY m.id HAVING count(t.detection_type) <> 1
            ) OR EXISTS (
                SELECT detection_type FROM yolo_model_detection_type
                GROUP BY detection_type HAVING count(*) > 1
            ) THEN
                RAISE EXCEPTION 'Cannot downgrade YOLO models with multiple or overlapping detection types';
            END IF;
        END $$;
    """))
    op.add_column("yolo_model", sa.Column("detection_type", sa.String(32)))
    op.add_column("yolo_model_version", sa.Column("detection_type", sa.String(32)))
    op.execute(sa.text("UPDATE yolo_model m SET detection_type = t.detection_type FROM yolo_model_detection_type t WHERE t.model_id = m.id"))
    op.execute(sa.text("UPDATE yolo_model_version v SET detection_type = m.detection_type FROM yolo_model m WHERE v.model_id = m.id"))
    op.alter_column("yolo_model", "detection_type", nullable=False)
    op.alter_column("yolo_model_version", "detection_type", nullable=False)
    op.drop_table("yolo_model_detection_type")
    op.drop_constraint(op.f("fk_yolo_model_version_model_id_yolo_model"), "yolo_model_version", type_="foreignkey")
    op.drop_constraint("uq_yolo_model_version_label", "yolo_model_version", type_="unique")
    op.drop_index("uq_yolo_model_active_version", table_name="yolo_model_version")
    op.drop_constraint(op.f("pk_yolo_model"), "yolo_model", type_="primary")
    op.drop_column("yolo_model", "id")
    op.create_primary_key(op.f("pk_yolo_model"), "yolo_model", ["detection_type"])
    op.create_check_constraint(op.f("ck_yolo_model_detection_type"), "yolo_model", "detection_type IN ('crack', 'spalling', 'peeling', 'damage', 'moisture', 'hollow')")
    op.create_foreign_key(op.f("fk_yolo_model_version_detection_type_yolo_model"), "yolo_model_version", "yolo_model", ["detection_type"], ["detection_type"], ondelete="RESTRICT")
    op.drop_column("yolo_model_version", "model_id")
    op.create_unique_constraint("uq_yolo_model_version_label", "yolo_model_version", ["detection_type", "version"])
    op.create_index("uq_yolo_model_active_version", "yolo_model_version", ["detection_type"], unique=True, postgresql_where=sa.text("is_active"))
