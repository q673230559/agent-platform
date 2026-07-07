import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain.tools import tool
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import HumanMessage

load_dotenv()

# DeepSeek 配置
llm = ChatOpenAI(
    model="deepseek-v4-flash",
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com"
)

# 自定义工具
@tool
def calculator(a: float, b: float, op: str) -> float:
    """
    加减乘除计算器
    Args:
        a: 第一个数字
        b: 第二个数字
        op: 运算类型，可选 add / sub / mul / div
    """
    match op:
        case "add":
            return a + b
        case "sub":
            return a - b
        case "mul":
            return a * b
        case "div":
            return a / b
        case _:
            raise ValueError("op 仅支持 add sub mul div")

tools = [calculator]

# 一键创建智能体
agent = create_react_agent(llm, tools)

if __name__ == "__main__":
    res = agent.invoke({
        "messages": [HumanMessage("(128 + 72) * 15 等于多少")]
    })
    print("最终回答：", res["messages"][-1].content)