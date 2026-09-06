"""Runtime settings, read from the environment (prefix ``WISE_``)."""

from __future__ import annotations

from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Process-wide configuration.

    ``WISE_WORKSPACE`` is the root directory of all project artefacts;
    ``WISE_DATABASE_URL`` defaults to a SQLite file inside it.
    """

    model_config = SettingsConfigDict(env_prefix="WISE_", extra="ignore")

    workspace: Path = Field(default_factory=lambda: Path.home() / "WISE Workbench")
    database_url: str | None = None
    host: str = "127.0.0.1"
    port: int = 8000
    inprocess_worker: bool = True
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
        ]
    )
    # Public logs for the presets (``POST /projects/{id}/datasets/presets/{preset}``).
    bpic19_csv: Path = Field(
        default_factory=lambda: (
            Path.home() / "code" / "PhD" / "WISE" / "WISE" / "Untitled" / "data" / "BPI_Challenge_2019.csv"
        )
    )
    bpic19_norm: Path = Field(
        default_factory=lambda: Path.home() / "code" / "PhD" / "WISE" / "wise-lib" / "examples" / "bpic19_norm.json"
    )
    log_format: str = "json"
    log_level: str = "INFO"
    job_lease_seconds: float = 60.0
    job_heartbeat_seconds: float = 5.0
    job_poll_seconds: float = 0.5
    job_max_attempts: int = 3
    score_cache_size: int = 4
    mapping_sample_events: int = 200_000
    max_upload_bytes: int = 4 * 1024**3

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [v.strip() for v in value.split(",") if v.strip()]
        return value

    @property
    def workspace_path(self) -> Path:
        return Path(self.workspace).expanduser().resolve()

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{self.workspace_path / 'workbench.db'}"


def load_settings(**overrides: object) -> Settings:
    """Settings from the environment with explicit overrides on top."""
    return Settings(**overrides)  # type: ignore[arg-type]
