"""The explicit, persistent project dataset choice."""

from pydantic import BaseModel, ConfigDict, Field


class ProjectDatasetBinding(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    projectId: str
    datasetId: str | None
    boundAt: str | None


class ProjectDatasetBindingPut(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    datasetId: str = Field(min_length=1, max_length=200, pattern=r"^\S+$")
