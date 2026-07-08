import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from backend.database import get_db, async_session
from backend.models.bot import Bot, BotTool, Conversation, Message
from backend.models.tool import BuiltinTool
from backend.models.provider import ModelProvider
from backend.schemas.bot import (
    BotCreate, BotUpdate, BotOut, ToolOut,
    BotToolUpdate, ConversationCreate, ConversationOut,
    MessageOut, ChatRequest,
)
from backend.services.agent import stream_chat

router = APIRouter(prefix="/bots", tags=["bots"])

# ── Bot CRUD ──

def _bot_to_out(bot: Bot) -> BotOut:
    tools = []
    for link in bot.tool_links:
        if link.tool:
            tools.append(ToolOut(
                id=link.tool.id,
                name=link.tool.name,
                display_name=link.tool.display_name,
                description=link.tool.description or "",
            ))
    return BotOut(
        id=bot.id,
        name=bot.name,
        provider_id=bot.provider_id,
        model_name=bot.model_name,
        system_prompt=bot.system_prompt or "",
        temperature=bot.temperature,
        is_active=bot.is_active,
        tools=tools,
        avatar_url=bot.avatar_url or "",
        bio=bot.bio or "",
        greeting_message=bot.greeting_message or "",
        tags=bot.tags or [],
        created_at=bot.created_at,
        updated_at=bot.updated_at,
    )


@router.get("", response_model=list[BotOut])
async def list_bots(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Bot).order_by(Bot.id))
    return [_bot_to_out(b) for b in result.unique().scalars().all()]


@router.post("", response_model=BotOut, status_code=201)
async def create_bot(data: BotCreate, db: AsyncSession = Depends(get_db)):
    provider = await db.get(ModelProvider, data.provider_id)
    if not provider:
        raise HTTPException(404, "Provider not found")
    existing = await db.scalar(select(Bot.id).where(Bot.name == data.name))
    if existing is not None:
        raise HTTPException(409, "Bot name already exists")

    bot = Bot(
        name=data.name,
        provider_id=data.provider_id,
        model_name=data.model_name,
        system_prompt=data.system_prompt,
        temperature=data.temperature,
        is_active=data.is_active,
        avatar_url=data.avatar_url,
        bio=data.bio,
        greeting_message=data.greeting_message,
        tags=data.tags,
    )
    db.add(bot)
    await db.flush()

    # Bind tools
    if data.tool_ids:
        for tid in data.tool_ids:
            tool = await db.get(BuiltinTool, tid)
            if not tool:
                raise HTTPException(404, f"Tool {tid} not found")
            db.add(BotTool(bot_id=bot.id, tool_id=tid))

    await db.commit()
    await db.refresh(bot)
    return _bot_to_out(bot)


@router.get("/{bot_id}", response_model=BotOut)
async def get_bot(bot_id: int, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, bot_id)
    if not bot:
        raise HTTPException(404, "Bot not found")
    return _bot_to_out(bot)


@router.put("/{bot_id}", response_model=BotOut)
async def update_bot(bot_id: int, data: BotUpdate, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, bot_id)
    if not bot:
        raise HTTPException(404, "Bot not found")
    if data.name is not None:
        existing = await db.scalar(select(Bot.id).where(Bot.name == data.name, Bot.id != bot_id))
        if existing is not None:
            raise HTTPException(409, "Bot name already exists")

    for field, value in data.model_dump(exclude_unset=True, exclude={"tool_ids"}).items():
        if value is not None:
            setattr(bot, field, value)

    # Update tool bindings if provided
    if data.tool_ids is not None:
        await db.execute(delete(BotTool).where(BotTool.bot_id == bot_id))
        for tid in data.tool_ids:
            tool = await db.get(BuiltinTool, tid)
            if not tool:
                raise HTTPException(404, f"Tool {tid} not found")
            db.add(BotTool(bot_id=bot.id, tool_id=tid))

    await db.commit()
    await db.refresh(bot)
    return _bot_to_out(bot)


@router.delete("/{bot_id}", status_code=204)
async def delete_bot(bot_id: int, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, bot_id)
    if not bot:
        raise HTTPException(404, "Bot not found")
    await db.delete(bot)
    await db.commit()


# ── Tool binding ──

@router.put("/{bot_id}/tools")
async def update_bot_tools(bot_id: int, data: BotToolUpdate, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, bot_id)
    if not bot:
        raise HTTPException(404, "Bot not found")
    await db.execute(delete(BotTool).where(BotTool.bot_id == bot_id))
    for tid in data.tool_ids:
        tool = await db.get(BuiltinTool, tid)
        if not tool:
            raise HTTPException(404, f"Tool {tid} not found")
        db.add(BotTool(bot_id=bot.id, tool_id=tid))
    await db.commit()
    return {"ok": True}


# ── Conversations ──

router2 = APIRouter(prefix="/conversations", tags=["conversations"])


@router2.post("", response_model=ConversationOut, status_code=201)
async def create_conversation(data: ConversationCreate, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, data.bot_id)
    if not bot:
        raise HTTPException(404, "Bot not found")
    conv = Conversation(bot_id=data.bot_id, title="New Chat")
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return conv


@router2.get("", response_model=list[ConversationOut])
async def list_conversations(bot_id: int | None = None, db: AsyncSession = Depends(get_db)):
    q = select(Conversation).order_by(Conversation.created_at.desc())
    if bot_id is not None:
        q = q.where(Conversation.bot_id == bot_id)
    result = await db.execute(q)
    return result.unique().scalars().all()


@router2.delete("/{conversation_id}", status_code=204)
async def delete_conversation(conversation_id: int, db: AsyncSession = Depends(get_db)):
    conv = await db.get(Conversation, conversation_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    await db.delete(conv)
    await db.commit()


@router2.get("/{conversation_id}/messages", response_model=list[MessageOut])
async def get_messages(conversation_id: int, db: AsyncSession = Depends(get_db)):
    conv = await db.get(Conversation, conversation_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    result = await db.execute(
        select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at)
    )
    return result.scalars().all()


# ── Chat (SSE) ──

chat_router = APIRouter(prefix="/chat", tags=["chat"])


@chat_router.post("/{bot_id}")
async def chat(bot_id: int, req: ChatRequest, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, bot_id)
    if not bot:
        raise HTTPException(404, "Bot not found")
    if not bot.is_active:
        raise HTTPException(400, "Bot is not active")

    provider = await db.get(ModelProvider, bot.provider_id)
    if not provider:
        raise HTTPException(400, "Bot's provider not found")

    # Resolve or create conversation
    conv = None
    if req.conversation_id:
        conv = await db.get(Conversation, req.conversation_id)
        if not conv or conv.bot_id != bot_id:
            raise HTTPException(404, "Conversation not found")
    else:
        conv = Conversation(bot_id=bot_id)
        db.add(conv)
        await db.flush()

    # Load history
    hist_result = await db.execute(
        select(Message).where(Message.conversation_id == conv.id).order_by(Message.created_at)
    )
    history_msgs = hist_result.scalars().all()

    from langchain_core.messages import HumanMessage, AIMessage
    history = []
    for m in history_msgs:
        if m.role == "user":
            history.append(HumanMessage(content=m.content))
        elif m.role == "assistant":
            history.append(AIMessage(content=m.content))

    # Save user message
    user_msg = Message(conversation_id=conv.id, role="user", content=req.message)
    db.add(user_msg)
    await db.flush()

    # Update conversation title from first message
    if conv.title == "New Chat":
        conv.title = req.message[:80]
    await db.commit()

    async def event_stream():
        full_response = ""
        tool_calls_log = None
        try:
            async for event in stream_chat(bot, provider, req.message, history, bot.system_prompt or ""):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event["type"] == "token":
                    full_response += event["content"]
                elif event["type"] == "done":
                    full_response = event.get("content", full_response)
                    tool_calls_log = event.get("tool_calls")
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"

        # Save assistant message
        async with async_session() as s:
            assistant_msg = Message(
                conversation_id=conv.id,
                role="assistant",
                content=full_response,
                tool_calls=tool_calls_log,
            )
            s.add(assistant_msg)
            await s.commit()

    return StreamingResponse(event_stream(), media_type="text/event-stream")
