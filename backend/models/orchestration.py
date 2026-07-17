import enum
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, JSON, Enum as SAEnum, func
from sqlalchemy.orm import relationship
from backend.database import Base


class OrchestrationType(str, enum.Enum):
    SUPERVISOR = "supervisor"
    DAG = "dag"
    SWARM = "swarm"


class Orchestration(Base):
    __tablename__ = "orchestrations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text, default="")
    orchestration_type = Column(
        SAEnum(OrchestrationType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=OrchestrationType.DAG,
    )
    config = Column(JSON, default=dict)
    is_active = Column(Boolean, default=True)
    cron_expression = Column(String(100), nullable=True)
    schedule_enabled = Column(Boolean, default=False)
    max_retries = Column(Integer, default=1)
    recursion_limit = Column(Integer, default=50)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    nodes = relationship(
        "OrchestrationNode", back_populates="orchestration",
        lazy="joined", cascade="all, delete-orphan",
    )
    edges = relationship(
        "OrchestrationEdge", back_populates="orchestration",
        lazy="joined", cascade="all, delete-orphan",
    )
    runs = relationship(
        "OrchestrationRun", back_populates="orchestration",
        lazy="dynamic", cascade="all, delete-orphan",
    )


class OrchestrationNode(Base):
    __tablename__ = "orchestration_nodes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    orchestration_id = Column(Integer, ForeignKey("orchestrations.id", ondelete="CASCADE"), nullable=False)
    node_type = Column(String(20), default="agent")  # 'start' | 'end' | 'agent' | 'decision_agent' | 'python_script'
    node_key = Column(String(50), default="")
    label = Column(String(100), default="")
    position_x = Column(Integer, default=0)
    position_y = Column(Integer, default=0)
    config = Column(JSON, default=dict)
    # Agent nodes: config = {provider_id, model_name, system_prompt, temperature, tools}
    # Python script nodes: config = {script, requirements}
    # Start/End nodes: config = {}

    orchestration = relationship("Orchestration", back_populates="nodes")


class OrchestrationEdge(Base):
    __tablename__ = "orchestration_edges"

    id = Column(Integer, primary_key=True, autoincrement=True)
    orchestration_id = Column(Integer, ForeignKey("orchestrations.id", ondelete="CASCADE"), nullable=False)
    source_node_id = Column(Integer, ForeignKey("orchestration_nodes.id", ondelete="CASCADE"), nullable=False)
    target_node_id = Column(Integer, ForeignKey("orchestration_nodes.id", ondelete="CASCADE"), nullable=False)
    condition = Column(Text, default="")
    label = Column(String(100), default="")
    is_default = Column(Boolean, default=False)

    orchestration = relationship("Orchestration", back_populates="edges")
    source_node = relationship("OrchestrationNode", foreign_keys=[source_node_id], lazy="joined")
    target_node = relationship("OrchestrationNode", foreign_keys=[target_node_id], lazy="joined")


class OrchestrationRun(Base):
    __tablename__ = "orchestration_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    orchestration_id = Column(Integer, ForeignKey("orchestrations.id"), nullable=False)
    input_message = Column(Text, nullable=False)
    status = Column(String(20), default="pending")
    result = Column(JSON, default=dict)
    created_at = Column(DateTime, server_default=func.now())
    completed_at = Column(DateTime, nullable=True)

    orchestration = relationship("Orchestration", back_populates="runs")
    events = relationship(
        "OrchestrationRunEvent", back_populates="run",
        lazy="joined", cascade="all, delete-orphan",
        order_by="OrchestrationRunEvent.created_at",
    )


class OrchestrationRunEvent(Base):
    __tablename__ = "orchestration_run_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey("orchestration_runs.id", ondelete="CASCADE"), nullable=False)
    node_id = Column(Integer, ForeignKey("orchestration_nodes.id"), nullable=True)
    event_type = Column(String(30), nullable=False)
    content = Column(Text, default="")
    metadata_ = Column("metadata", JSON, default=dict)
    created_at = Column(DateTime, server_default=func.now())

    run = relationship("OrchestrationRun", back_populates="events")
