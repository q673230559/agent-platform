from typing import AsyncIterator
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import HumanMessage, AIMessage
from backend.models.bot import Bot
from backend.models.provider import ModelProvider
from backend.services.llm_factory import create_llm
from backend.tools.registry import registry


def build_agent(bot: Bot, provider: ModelProvider):
    llm = create_llm(provider, bot.model_name, bot.temperature)
    tools = []
    for link in bot.tool_links:
        tool_factory = registry.get(link.tool.name)
        if tool_factory:
            config = link.config or {}
            tools.append(tool_factory)
    return create_react_agent(llm, tools)


async def stream_chat(bot: Bot, provider: ModelProvider, message: str, history: list) -> AsyncIterator[dict]:
    agent = build_agent(bot, provider)
    messages = history + [HumanMessage(content=message)]
    full_response = ""
    tool_calls_log = []

    async for event in agent.astream_events({"messages": messages}, version="v2"):
        kind = event.get("event", "")
        if kind == "on_chat_model_stream":
            chunk = event["data"]["chunk"]
            token = chunk.content
            if token:
                full_response += token
                yield {"type": "token", "content": token}
        elif kind == "on_tool_start":
            tc = {
                "name": event.get("name", ""),
                "input": event["data"].get("input", {}),
            }
            tool_calls_log.append(tc)
            yield {"type": "tool_call", "content": tc}
        elif kind == "on_tool_end":
            pass

    yield {"type": "done", "content": full_response, "tool_calls": tool_calls_log or None}
