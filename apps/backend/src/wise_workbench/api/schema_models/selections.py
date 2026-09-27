"""Immutable, named case-table cohorts resolved by the EDA selector."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .eda import EDASelection


class SavedSelectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    datasetId: str = Field(min_length=1, max_length=256)
    attribute: str | None = Field(default=None, max_length=256)
    selection: EDASelection | None = None

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("A saved selection needs a name")
        return value.strip()


class SelectionSource(BaseModel):
    mappingId: str
    mappingChecksum: str
    datasetContentHash: str | None = None
    casesChecksum: str
    eventsChecksum: str


class SavedSelection(BaseModel):
    id: str
    name: str
    projectId: str
    datasetId: str
    caseTableId: str
    cases: int
    createdAt: datetime
    attribute: str | None = None
    selection: EDASelection
    membershipChecksum: str
    source: SelectionSource
    semanticsVersion: Literal["eda-v1"] = "eda-v1"
