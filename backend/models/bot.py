from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, JSON, func
from sqlalchemy.orm import relationship
from backend.database import Base


class Bot(Base):
    __tablename__ = "bots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, unique=True)
    bot_id = Column(String(100), nullable=False, unique=True, default="")
    workspace_dir = Column(String(255), nullable=False, default="")
    provider_id = Column(Integer, ForeignKey("model_providers.id"), nullable=False)
    model_name = Column(String(100), nullable=False)
    system_prompt = Column(Text, default="")
    temperature = Column(Float, default=0.7)
    is_active = Column(Boolean, default=True)
    avatar_url = Column(String(500), default="")
    bio = Column(String(300), default="")
    greeting_message = Column(Text, default="")
    tags = Column(JSON, default=list)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    provider = relationship("ModelProvider", lazy="joined")
    tool_links = relationship("BotTool", back_populates="bot", lazy="joined", cascade="all, delete-orphan")
    conversations = relationship("Conversation", back_populates="bot", lazy="dynamic", cascade="all, delete-orphan")


class BotTool(Base):
    __tablename__ = "bot_tools"

    bot_id = Column(Integer, ForeignKey("bots.id", ondelete="CASCADE"), primary_key=True)
    tool_id = Column(Integer, ForeignKey("builtin_tools.id"), primary_key=True)
    config = Column(JSON, default=dict)

    bot = relationship("Bot", back_populates="tool_links")
    tool = relationship("BuiltinTool", lazy="joined")


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    bot_id = Column(Integer, ForeignKey("bots.id"), nullable=False)
    title = Column(String(200), default="New Chat")
    created_at = Column(DateTime, server_default=func.now())

    bot = relationship("Bot", back_populates="conversations")
    messages = relationship("Message", back_populates="conversation", lazy="joined", cascade="all, delete-orphan", order_by="Message.created_at")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=False)
    role = Column(String(20), nullable=False)
    content = Column(Text, default="")
    tool_calls = Column(JSON, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    conversation = relationship("Conversation", back_populates="messages")
