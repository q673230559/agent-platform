from langchain_openai import ChatOpenAI
from backend.models.provider import ModelProvider
from backend.services.crypto import decrypt


def create_llm(provider: ModelProvider, model_name: str, temperature: float = 0.7, max_retries: int = 2) -> ChatOpenAI:
    api_key = decrypt(provider.api_key)
    return ChatOpenAI(
        model=model_name,
        api_key=api_key,
        base_url=provider.base_url,
        temperature=temperature,
        streaming=True,
        max_retries=max_retries,
    )
