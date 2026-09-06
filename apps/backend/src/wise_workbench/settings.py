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
    # The built single-page application (``index.html`` and ``assets/``) served at ``/`` with history fallback.
    # ``WISE_STATIC_DIR`` names it explicitly; otherwise the package's own ``static`` directory is used, then
    # ``apps/frontend/dist`` of a source checkout. Without any of them only the API and ``/docs`` are served.
    static_dir: Path | None = None
    log_format: str = "json"
    log_level: str = "INFO"
    job_lease_seconds: float = 60.0
    job_heartbeat_seconds: float = 5.0
    job_poll_seconds: float = 0.5
    job_max_attempts: int = 3
    score_cache_size: int = 4
    mapping_sample_events: int = 200_000
    max_upload_bytes: int = 4 * 1024**3
    # Analytics (packages/wise-analytics): queued after every scoring job unless ``WISE_ANALYTICS_AUTO=0``;
    # ``B`` bootstrap replicates; comparison sentences for the top groups of every backlog; the replicated share
    # from which the bootstrap resamples by document instead of by case.
    analytics_auto: bool = True
    analytics_bootstrap_b: int = 200
    analytics_comparison_top: int = 12
    analytics_cluster_share: float = 0.20
    analytics_seed: int = 0

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
    def resolved_static_dir(self) -> Path | None:
        """The directory holding ``index.html``, or ``None`` when no built frontend is available."""
        if self.static_dir is not None:
            candidates = [Path(self.static_dir).expanduser()]
        else:
            here = Path(__file__).resolve().parent
            candidates = [here / "static", here.parents[2] / "frontend" / "dist"]
        for candidate in candidates:
            if (candidate / "index.html").is_file():
                return candidate.resolve()
        return None

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{self.workspace_path / 'workbench.db'}"


def load_settings(**overrides: object) -> Settings:
    """Settings from the environment with explicit overrides on top."""
    return Settings(**overrides)  # type: ignore[arg-type]
