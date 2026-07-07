# Agent Platform

基于 LangGraph 的前后端分离多模型 Agent 管理平台，支持多供应商接入、多机器人管理、流式对话。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | FastAPI + LangGraph + LangChain + SQLAlchemy |
| 数据库 | MySQL 8.0 |
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS |
| 容器化 | Docker + Docker Compose |

## 快速开始

### 1. 生成 Fernet 加密密钥

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，将生成的密钥填入 `FERNET_KEY`：

```env
MYSQL_ROOT_PASSWORD=123456
MYSQL_DATABASE=agent_platform
DATABASE_URL=mysql+aiomysql://root:123456@mysql:3306/agent_platform
FERNET_KEY=<你生成的密钥>
```

### 3. 启动服务

```bash
docker-compose up -d
```

### 4. 访问

| 服务 | 地址 |
|---|---|
| 前端界面 | http://localhost:3000 |
| 后端 API 文档 (Swagger) | http://localhost:8000/docs |
| 健康检查 | http://localhost:8000/api/health |

## 使用流程

1. **添加供应商** — 在 Providers 页面添加模型供应商（如 DeepSeek、OpenAI），填写 API Base URL 和 Key
2. **创建 Bot** — 在 Bots 页面创建机器人，选择供应商和模型，勾选所需工具
3. **开始对话** — 点击 Chat 进入对话界面，支持 SSE 流式输出

## 项目结构

```
verify-lang/
├── docker-compose.yml          # 服务编排
├── .env.example                # 环境变量模板
├── README.md
├── main.py                     # 原始 LangGraph demo
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                 # FastAPI 入口
│   ├── config.py               # 配置
│   ├── database.py             # 数据库
│   ├── models/                 # ORM 模型
│   │   ├── provider.py         # 模型供应商
│   │   ├── bot.py              # Bot / 对话 / 消息
│   │   └── tool.py             # 内置工具注册
│   ├── schemas/                # Pydantic schema
│   ├── routers/                # API 路由
│   │   ├── providers.py        # 供应商 CRUD
│   │   ├── bots.py             # Bot CRUD + SSE 聊天
│   │   └── tools.py            # 工具列表
│   ├── services/
│   │   ├── crypto.py           # Fernet 加密
│   │   ├── llm_factory.py      # LLM 实例工厂
│   │   └── agent.py            # LangGraph Agent
│   └── tools/
│       ├── registry.py         # 工具注册表
│       └── builtin.py          # calculator / web_search
└── frontend/
    ├── Dockerfile              # 多阶段构建
    ├── nginx.conf              # 反向代理
    └── src/
        ├── api/client.ts       # API + SSE 客户端
        ├── types/index.ts      # TypeScript 类型
        ├── components/
        │   └── Layout.tsx      # 侧边栏布局
        └── pages/
            ├── Dashboard.tsx   # 首页
            ├── Providers.tsx   # 供应商管理
            ├── Bots.tsx        # Bot 列表
            ├── BotEditor.tsx   # Bot 编辑
            └── Chat.tsx        # 流式对话
```

## 内置工具

| 工具 | 功能 |
|---|---|
| calculator | 四则运算 (add / sub / mul / div) |
| web_search | DuckDuckGo 网页搜索 |

## API 概览

### 供应商 `/api/providers`
- `GET` 列表 / `POST` 创建 / `PUT` 更新 / `DELETE` 删除

### Bot `/api/bots`
- `GET` 列表 / `POST` 创建 / `PUT` 更新 / `DELETE` 删除
- `PUT /{id}/tools` — 更新工具绑定

### 对话 `/api/conversations`
- `GET` 列表 / `POST` 创建 / `DELETE` 删除
- `GET /{id}/messages` — 获取消息历史

### 聊天 `/api/chat/{bot_id}` (SSE)
- `POST` 发送消息，流式返回 token / tool_call / done

### 工具 `/api/tools`
- `GET` 列出可用工具

## 开发模式

```bash
# 后端
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 前端
cd frontend
npm install
npm run dev   # Vite proxy 会自动转发 /api -> localhost:8000
```
