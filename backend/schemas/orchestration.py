from pydantic import BaseModel, Field
from datetime import datetime
from backend.models.orchestration import OrchestrationType


# ── Node schemas ──

class NodeCreate(BaseModel):
    node_type: str = "agent"  # 'start' | 'end' | 'agent'
    label: str = ""
    position_x: int = 0
    position_y: int = 0
    config: dict = {}  # agent: {provider_id, model_name, system_prompt, temperature, tools}; start/end: {}
    temp_id: str = ""


class NodeUpdate(BaseModel):
    node_type: str | None = None
    label: str | None = None
    position_x: int | None = None
    position_y: int | None = None
    config: dict | None = None


class NodeOut(BaseModel):
    id: int
    node_type: str = "agent"
    label: str
    position_x: int
    position_y: int
    config: dict

    model_config = {"from_attributes": True}


# ── Edge schemas ──

class EdgeCreate(BaseModel):
    source_node_id: int
    target_node_id: int
    condition: str = ""
    label: str = ""
    is_default: bool = False


class EdgeOut(BaseModel):
    id: int
    source_node_id: int
    target_node_id: int
    condition: str
    label: str
    is_default: bool

    model_config = {"from_attributes": True}


# ── Orchestration CRUD ──

class OrchestrationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = ""
    orchestration_type: OrchestrationType = OrchestrationType.DAG
    config: dict = {}
    nodes: list[NodeCreate] = []
    edges: list[EdgeCreate] = []
    is_active: bool = True


class OrchestrationUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    orchestration_type: OrchestrationType | None = None
    config: dict | None = None
    is_active: bool | None = None
    nodes: list[NodeCreate] | None = None
    edges: list[EdgeCreate] | None = None


class OrchestrationOut(BaseModel):
    id: int
    name: str
    description: str
    orchestration_type: OrchestrationType
    config: dict
    is_active: bool
    nodes: list[NodeOut] = []
    edges: list[EdgeOut] = []
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


# ── Execution ──

class OrchestrationExecuteRequest(BaseModel):
    message: str = Field(..., min_length=1)
    conversation_id: int | None = None


class RunEventOut(BaseModel):
    id: int
    node_id: int | None
    event_type: str
    content: str
    metadata: dict | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class OrchestrationRunOut(BaseModel):
    id: int
    orchestration_id: int
    input_message: str
    status: str
    result: dict | None = None
    events: list[RunEventOut] = []
    created_at: datetime
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}
