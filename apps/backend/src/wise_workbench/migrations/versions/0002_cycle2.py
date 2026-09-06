"""Cycle 2: decisions on data caveats and the analysis notebook.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-06
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "decisions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("project_id", sa.String(64), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("case_table_id", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(64), nullable=False),
        sa.Column("params", sa.JSON(), nullable=False),
        sa.Column("readiness_item", sa.String(128), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("mapping_id", sa.String(64), nullable=False),
        sa.Column("result_case_table_id", sa.String(64), nullable=False),
        sa.Column("preview", sa.JSON(), nullable=False),
        sa.Column("author", sa.String(255)),
        sa.Column("note", sa.Text()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_decisions_project_id", "decisions", ["project_id"])
    op.create_index("ix_decisions_case_table_id", "decisions", ["case_table_id"])
    op.create_index("ix_decisions_result_case_table_id", "decisions", ["result_case_table_id"])
    op.create_table(
        "notebook_snapshots",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("project_id", sa.String(64), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("note", sa.Text()),
        sa.Column("context", sa.JSON(), nullable=False),
        sa.Column("data", sa.JSON()),
        sa.Column("image_path", sa.Text()),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("author", sa.String(255)),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_notebook_snapshots_project_id", "notebook_snapshots", ["project_id"])


def downgrade() -> None:
    op.drop_table("notebook_snapshots")
    op.drop_table("decisions")
