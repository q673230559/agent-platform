from pydantic import BaseModel, Field
from datetime import datetime


class ProviderCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    base_url: str = Field(..., min_length=1, max_length=500)
    api_key: str = Field(..., min_length=1)
    default_model: str = Field(..., min_length=1, max_length=100)


class ProviderUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    base_url: str | None = Field(None, min_length=1, max_length=500)
    api_key: str | None = Field(None, min_length=1)
    default_model: str | None = Field(None, min_length=1, max_length=100)


class ProviderOut(BaseModel):
    id: int
    name: str
    base_url: str
    api_key: str = "********"
    default_model: str
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class ModelsResponse(BaseModel):
    models: list[str]


class FetchModelsRequest(BaseModel):
    base_url: str
    api_key: str
