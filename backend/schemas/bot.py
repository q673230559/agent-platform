from pydantic import BaseModel, Field
from datetime import datetime


class BotCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    provider_id: int
    model_name: str = Field(..., min_length=1, max_length=100)
    system_prompt: str = ""
    temperature: float = Field(0.7, ge=0.0, le=2.0)
    is_active: bool = True
    tool_ids: list[int] = []


class BotUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    provider_id: int | None = None
    model_name: str | None = Field(None, min_length=1, max_length=100)
    system_prompt: str | None = None
    temperature: float | None = Field(None, ge=0.0, le=2.0)
    is_active: bool | None = None
    tool_ids: list[int] | None = None


class ToolOut(BaseModel):
    id: int
    name: str
    display_name: str
    description: str

    model_config = {"from_attributes": True}


class BotToolOut(BaseModel):
    tool: ToolOut
    config: dict | None = None

    model_config = {"from_attributes": True}


class BotOut(BaseModel):
    id: int
    name: str
    provider_id: int
    model_name: str
    system_prompt: str
    temperature: float
    is_active: bool
    tools: list[ToolOut] = []
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class ConversationCreate(BaseModel):
    bot_id: int


class ConversationOut(BaseModel):
    id: int
    bot_id: int
    title: str
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageOut(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    tool_calls: dict | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatRequest(BaseModel):
    conversation_id: int | None = None
    message: str = Field(..., min_length=1)


class BotToolUpdate(BaseModel):
    tool_ids: list[int] = []
