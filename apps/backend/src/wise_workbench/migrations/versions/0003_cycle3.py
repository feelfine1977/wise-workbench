"""Cycle 3: the review records — hypotheses, gates, findings and actions.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-06
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_items",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("project_id", sa.String(64), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("title", sa.Text(), nullable=False, server_default=""),
        sa.Column("run_id", sa.String(64)),
        sa.Column("slicing", sa.Text()),
        sa.Column("slice_key", sa.Text()),
        sa.Column("view", sa.String(128)),
        sa.Column("body", sa.JSON(), nullable=False),
        sa.Column("author", sa.String(255)),
        sa.Column("note", sa.Text()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_review_items_project_id", "review_items", ["project_id"])
    op.create_index("ix_review_items_run_id", "review_items", ["run_id"])
    op.create_index("ix_review_items_project_kind", "review_items", ["project_id", "kind"])


def downgrade() -> None:
    op.drop_index("ix_review_items_project_kind", table_name="review_items")
    op.drop_index("ix_review_items_run_id", table_name="review_items")
    op.drop_index("ix_review_items_project_id", table_name="review_items")
    op.drop_table("review_items")
