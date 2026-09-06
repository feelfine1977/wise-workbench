"""Initial schema: projects, datasets, mappings, case tables, norm versions, runs, jobs.

Revision ID: 0001
Revises:
Create Date: 2026-09-05
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("process", sa.String(64)),
        sa.Column("question", sa.Text()),
        sa.Column("latest_run_id", sa.String(64)),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "datasets",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("project_id", sa.String(64), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("source_kind", sa.String(32), nullable=False),
        sa.Column("source_path", sa.Text()),
        sa.Column("content_hash", sa.String(128)),
        sa.Column("events", sa.Integer()),
        sa.Column("columns", sa.JSON()),
        sa.Column("error", sa.Text()),
        sa.Column("job_id", sa.String(64)),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_datasets_project_id", "datasets", ["project_id"])
    op.create_table(
        "mappings",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("dataset_id", sa.String(64), sa.ForeignKey("datasets.id"), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_mappings_dataset_id", "mappings", ["dataset_id"])
    op.create_table(
        "case_tables",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("project_id", sa.String(64), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("dataset_id", sa.String(64), sa.ForeignKey("datasets.id"), nullable=False),
        sa.Column("mapping_id", sa.String(64), sa.ForeignKey("mappings.id"), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("cases", sa.Integer()),
        sa.Column("events", sa.Integer()),
        sa.Column("readiness", sa.JSON()),
        sa.Column("activities", sa.JSON()),
        sa.Column("attributes", sa.JSON()),
        sa.Column("error", sa.Text()),
        sa.Column("job_id", sa.String(64)),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_case_tables_project_id", "case_tables", ["project_id"])
    op.create_index("ix_case_tables_dataset_id", "case_tables", ["dataset_id"])
    op.create_table(
        "norm_versions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("project_id", sa.String(64), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("norm_id", sa.String(64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("fingerprint", sa.String(128), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("note", sa.Text()),
        sa.Column("author", sa.String(255)),
        sa.Column("parent_id", sa.String(64)),
        sa.Column("validation", sa.JSON()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_norm_versions_project_id", "norm_versions", ["project_id"])
    op.create_index("ix_norm_versions_norm_id", "norm_versions", ["norm_id"])
    op.create_index("ix_norm_versions_fingerprint", "norm_versions", ["fingerprint"])
    op.create_table(
        "runs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("project_id", sa.String(64), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("case_table_id", sa.String(64), nullable=False),
        sa.Column("norm_version_id", sa.String(64), nullable=False),
        sa.Column("params", sa.JSON(), nullable=False),
        sa.Column("params_hash", sa.String(128), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("job_id", sa.String(64)),
        sa.Column("idempotency_key", sa.String(255)),
        sa.Column("manifest", sa.JSON()),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_runs_project_id", "runs", ["project_id"])
    op.create_index("ix_runs_idempotency_key", "runs", ["idempotency_key"])
    op.create_index("ix_runs_project_params", "runs", ["project_id", "params_hash"])
    op.create_table(
        "jobs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("project_id", sa.String(64)),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("progress", sa.Float(), nullable=False, server_default="0"),
        sa.Column("message", sa.Text()),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("lease_until", sa.DateTime()),
        sa.Column("heartbeat_at", sa.DateTime()),
        sa.Column("worker_id", sa.String(128)),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("result_ref", sa.String(128)),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime()),
        sa.Column("finished_at", sa.DateTime()),
    )
    op.create_index("ix_jobs_project_id", "jobs", ["project_id"])
    op.create_index("ix_jobs_status_created", "jobs", ["status", "created_at"])


def downgrade() -> None:
    for table in ("jobs", "runs", "norm_versions", "case_tables", "mappings", "datasets", "projects"):
        op.drop_table(table)
