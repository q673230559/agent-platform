from pydantic import BaseModel, Field
from datetime import datetime


class SystemSettingsUpdate(BaseModel):
    provider_id: int | None = None
    model_name: str | None = Field(None, max_length=100)


class SystemSettingsOut(BaseModel):
    id: int
    provider_id: int | None = None
    model_name: str | None = None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}
