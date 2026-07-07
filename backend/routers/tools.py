from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from backend.database import get_db
from backend.models.tool import BuiltinTool
from backend.schemas.bot import ToolOut

router = APIRouter(prefix="/tools", tags=["tools"])


@router.get("", response_model=list[ToolOut])
async def list_tools(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BuiltinTool).where(BuiltinTool.is_active == True).order_by(BuiltinTool.id))
    return result.scalars().all()
