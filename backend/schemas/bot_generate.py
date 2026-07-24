from pydantic import BaseModel, Field


class GenerateFromBioRequest(BaseModel):
    bio: str = Field(min_length=1, max_length=300)


class GenerateFromBioResponse(BaseModel):
    system_prompt: str
    greeting_message: str


class GenerateIdRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class GenerateIdResponse(BaseModel):
    bot_id: str
