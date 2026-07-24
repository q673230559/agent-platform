import json
import os
import re
import unicodedata
from backend.config import WORKSPACE_ROOT, set_workspace_override
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
from backend.schemas.bot_generate import GenerateFromBioRequest, GenerateFromBioResponse, GenerateIdRequest, GenerateIdResponse
from backend.schemas.orchestration import WorkspaceTreeItem
from backend.services.agent import stream_chat
from backend.services.system_model import get_system_llm

router = APIRouter(prefix="/bots", tags=["bots"])

# ── Helpers ──

BOT_ID_PATTERN = re.compile(r'^[a-z0-9_][a-z0-9_-]*$')


def slugify(name: str) -> str:
    """Convert a name to a URL-friendly slug."""
    name = unicodedata.normalize('NFKD', name)
    name = name.encode('ascii', 'ignore').decode('ascii')
    name = re.sub(r'[^a-zA-Z0-9\s_-]', '', name)
    name = re.sub(r'[\s-]+', '_', name)
    name = name.strip('_').lower()
    return name[:100] if name else "bot"


def validate_bot_id(bot_id: str) -> str:
    if not bot_id:
        raise HTTPException(400, "Bot ID 不能为空")
    if not BOT_ID_PATTERN.match(bot_id):
        raise HTTPException(400, "Bot ID 只能包含小写字母、数字、下划线和连字符")
    if len(bot_id) > 100:
        raise HTTPException(400, "Bot ID 过长")
    return bot_id


def validate_workspace_dir(ws_dir: str) -> str:
    if not ws_dir:
        raise HTTPException(400, "Workspace 目录不能为空")
    if '..' in ws_dir or '/' in ws_dir or '\\' in ws_dir:
        raise HTTPException(400, "Workspace 目录包含非法字符")
    if len(ws_dir) > 255:
        raise HTTPException(400, "Workspace 目录名称过长")
    return ws_dir

def _bot_to_out(bot: Bot) -> BotOut:
    tools = []
    for link in bot.tool_links:
        if link.tool:
            tools.append(ToolOut(
                id=link.tool.id,
                name=link.tool.name,
                display_name=link.tool.display_name,
                description=link.tool.description or "",
                category=link.tool.category or "",
            ))
    return BotOut(
        id=bot.id,
        name=bot.name,
        bot_id=bot.bot_id or "",
        workspace_dir=bot.workspace_dir or "",
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

    # Resolve bot_id
    bot_id = data.bot_id.strip() if data.bot_id else slugify(data.name)
    bot_id = validate_bot_id(bot_id)

    # Check bot_id uniqueness
    existing_id = await db.scalar(select(Bot.id).where(Bot.bot_id == bot_id))
    if existing_id is not None:
        raise HTTPException(409, f"Bot ID '{bot_id}' 已存在")

    # Resolve workspace_dir
    workspace_dir = data.workspace_dir.strip() if data.workspace_dir else bot_id
    workspace_dir = validate_workspace_dir(workspace_dir)

    bot = Bot(
        name=data.name,
        bot_id=bot_id,
        workspace_dir=workspace_dir,
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

    # Create workspace directory on disk
    workspace_path = os.path.join(WORKSPACE_ROOT, "workspace", workspace_dir)
    os.makedirs(workspace_path, exist_ok=True)

    return _bot_to_out(bot)


@router.post("/generate-from-bio", response_model=GenerateFromBioResponse)
async def generate_from_bio(req: GenerateFromBioRequest, db: AsyncSession = Depends(get_db)):
    llm = await get_system_llm(db, temperature=0.8)
    if llm is None:
        raise HTTPException(400, "系统模型未配置，请先在系统设置中配置模型")

    prompt = f"""你是一个专业的智能体配置助手。请根据以下机器人简介，生成对应的系统提示词和欢迎语。

机器人简介：
{req.bio}

请严格按照以下JSON格式返回结果，不要输出任何其他内容：
{{"system_prompt": "系统提示词内容", "greeting_message": "欢迎语内容"}}

要求：
1. system_prompt 应该明确定义机器人的角色、专业领域、语气风格和行为准则，使用中文。
2. greeting_message 应该热情友好，简要介绍机器人的功能，包含一个表情符号，使用中文。"""

    try:
        response = await llm.ainvoke(prompt)
        content = response.content.strip()
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)
        data = json.loads(content)
        system_prompt = data.get("system_prompt", "").strip()
        greeting_message = data.get("greeting_message", "").strip()
        if not system_prompt or not greeting_message:
            raise ValueError("生成内容不完整")
        return GenerateFromBioResponse(
            system_prompt=system_prompt,
            greeting_message=greeting_message,
        )
    except json.JSONDecodeError:
        raise HTTPException(500, "生成内容格式错误，请重试")
    except Exception as e:
        raise HTTPException(500, f"生成失败：{str(e)}")


@router.post("/generate-id", response_model=GenerateIdResponse)
async def generate_bot_id(req: GenerateIdRequest, db: AsyncSession = Depends(get_db)):
    llm = await get_system_llm(db, temperature=0.3)
    if llm is not None:
        prompt = f"""你是一个命名助手。请将以下名称转成一个简短的英文ID（slug格式）。
只使用小写字母、数字和下划线，不要使用空格或特殊字符。长度不超过50个字符。

名称：{req.name}

请直接返回ID内容，不要输出任何其他文字或JSON格式。示例格式：hr_assistant, code_reviewer"""
        try:
            response = await llm.ainvoke(prompt)
            raw = response.content.strip().lower()
            raw = re.sub(r'[^a-z0-9_]', '_', raw)
            raw = re.sub(r'_+', '_', raw)
            raw = raw.strip('_')[:100]
            if raw:
                return GenerateIdResponse(bot_id=raw)
        except Exception:
            pass

    return GenerateIdResponse(bot_id=slugify(req.name))


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
    if data.bot_id is not None:
        new_bot_id = data.bot_id.strip()
        if not new_bot_id:
            raise HTTPException(400, "Bot ID 不能为空")
        new_bot_id = validate_bot_id(new_bot_id)
        existing_id = await db.scalar(select(Bot.id).where(Bot.bot_id == new_bot_id, Bot.id != bot_id))
        if existing_id is not None:
            raise HTTPException(409, f"Bot ID '{new_bot_id}' 已存在")
        data.bot_id = new_bot_id
    if data.workspace_dir is not None:
        data.workspace_dir = validate_workspace_dir(data.workspace_dir.strip())

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

    # Resolve bot workspace directory
    ws_dir = os.path.join(WORKSPACE_ROOT, "workspace", bot.workspace_dir or bot.bot_id)
    os.makedirs(ws_dir, exist_ok=True)
    set_workspace_override(ws_dir)

    # Inject workspace path into system prompt so the LLM knows its working directory
    system_prompt = bot.system_prompt or ""
    ws_hint = f"\n\n[工作目录: {ws_dir}]\n所有文件读写操作都在此目录下进行，请使用相对路径引用文件。"
    system_prompt = system_prompt + ws_hint

    async def event_stream():
        full_response = ""
        tool_calls_log = None
        try:
            async for event in stream_chat(bot, provider, req.message, history, system_prompt):
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


# ── Workspace ──

def _build_workspace_tree(dir_path: str) -> list[dict]:
    items = []
    try:
        entries = sorted(os.scandir(dir_path), key=lambda e: (not e.is_dir(), e.name))
    except OSError:
        return []
    for entry in entries:
        node: dict = {
            "name": entry.name,
            "path": entry.path,
            "type": "directory" if entry.is_dir() else "file",
            "children": [],
        }
        if entry.is_dir():
            node["children"] = _build_workspace_tree(entry.path)
        items.append(node)
    return items


@router.get("/{bot_id}/workspace", response_model=list[WorkspaceTreeItem])
async def get_bot_workspace_tree(bot_id: int, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, bot_id)
    if not bot:
        raise HTTPException(404, "Bot not found")
    ws_dir = os.path.join(WORKSPACE_ROOT, "workspace", bot.workspace_dir or bot.bot_id)
    return _build_workspace_tree(ws_dir)
