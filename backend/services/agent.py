import logging
from typing import AsyncIterator
from langchain.agents import create_agent
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from backend.models.bot import Bot
from backend.models.provider import ModelProvider
from backend.services.llm_factory import create_llm
from backend.tools.registry import registry

logger = logging.getLogger("agent")


def build_agent(bot: Bot, provider: ModelProvider, system_prompt: str):
    llm = create_llm(provider, bot.model_name, bot.temperature)
    tools = []
    for link in bot.tool_links:
        tool_factory = registry.get(link.tool.name)
        if tool_factory:
            config = link.config or {}
            tools.append(tool_factory)
    return create_agent(llm, tools, system_prompt=system_prompt)


async def stream_chat(bot: Bot, provider: ModelProvider, message: str, history: list, system_prompt: str) -> AsyncIterator[dict]:
    logger.info(f"Chat start: bot={bot.name} model={bot.model_name} provider={provider.name}")
    logger.info(f"System prompt: {system_prompt[:200]}...")
    logger.info(f"History messages: {len(history)}")
    logger.info(f"User message: {message[:200]}")
    agent = build_agent(bot, provider, system_prompt)
    messages = history + [HumanMessage(content=message)]
    full_response = ""
    tool_calls_log = []

    async for event in agent.astream_events(
        {"messages": messages},
        config={"recursion_limit": 50},
        version="v2",
    ):
        kind = event.get("event", "")
        name = event.get("name", "")

        if kind == "on_chat_model_start":
            logger.info(f"LLM call starting...")

        elif kind == "on_chat_model_stream":
            chunk = event["data"]["chunk"]
            token = chunk.content
            if token:
                full_response += token
                yield {"type": "token", "content": token}

        elif kind == "on_chat_model_end":
            logger.info(f"LLM call ended, output tokens so far: {len(full_response)}")

        elif kind == "on_tool_start":
            tc = {
                "name": event.get("name", ""),
                "input": event["data"].get("input", {}),
            }
            tool_calls_log.append(tc)
            logger.info(f"Tool call: {tc['name']} input={tc['input']}")
            yield {"type": "tool_call", "content": tc}

        elif kind == "on_tool_end":
            output = event["data"].get("output", "")
            logger.info(f"Tool finished: {event.get('name', '')} output={str(output)[:200]}")

        elif kind == "on_chain_start":
            logger.info(f"Chain start: {name}")

        elif kind == "on_chain_end":
            logger.info(f"Chain end: {name}")

    logger.info(f"Chat done: {len(full_response)} chars, {len(tool_calls_log or [])} tool calls")
    yield {"type": "done", "content": full_response, "tool_calls": tool_calls_log or None}
