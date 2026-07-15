# Agent Platform

多 Agent 智能体平台，支持模型供应商管理、多 Agent 对话、可视化任务编排与定时调度，帮助你构建个人 AI 工作流。

## 核心能力

### 多 Agent 对话

接入多种模型供应商（DeepSeek、OpenAI 等），创建具备不同工具和系统提示词的机器人，支持 SSE 流式对话。

![机器人创建](doc/机器人创建.png)

### 任务编排

通过可视化 DAG 编辑器构建多 Agent 协作工作流，支持决策节点（智能路由）、Python 脚本节点、Agent 节点，实现复杂的自动化任务链路。

![任务编排](doc/任务编排.png)

### 定时调度

为编排任务配置 Cron 表达式，自动周期执行。每次执行均有完整的事件记录，可在执行历史中查看详情和输出结果。

![任务执行详情](doc/任务执行详情.png)

### 应用案例

基于平台能力，可以构建各类 AI 自动化应用：

![知识图谱应用](doc/通过本平台实现的知识图谱应用.png)

![知识星球应用](doc/通过本平台实现的知识星球应用.png)

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | FastAPI + LangGraph + LangChain + SQLAlchemy |
| 数据库 | MySQL 8.0 |
| 向量数据库 | Milvus |
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
docker compose up -d --build
```

### 4. 访问

| 服务 | 地址 |
|---|---|
| 前端界面 | http://localhost:3000 |
| 后端 API 文档 (Swagger) | http://localhost:8000/docs |
| 健康检查 | http://localhost:8000/api/health |

## 使用流程

### Bot 对话

1. **添加供应商** — 在 Providers 页面添加模型供应商（如 DeepSeek、OpenAI），填写 API Base URL 和 Key
2. **创建 Bot** — 在 Bots 页面创建机器人，选择供应商和模型，勾选所需工具
3. **开始对话** — 点击 Chat 进入对话界面，支持 SSE 流式输出

### 任务编排

1. **创建编排** — 在任务编排页面新建 DAG 工作流，拖拽节点构建流程
2. **配置节点** — 设置 Agent 节点（选择 Bot、编写提示词）、决策节点（智能分支路由）、Python 脚本节点
3. **连线** — 连接节点定义执行顺序和分支逻辑
4. **执行** — 输入消息启动执行，实时查看每个节点的输出和状态
5. **定时调度** — 配置 Cron 表达式和启用调度，平台将在后台自动周期执行

## 项目结构

```
agent-platform/
├── docker-compose.yml
├── .env.example
├── README.md
├── doc/                         # 文档截图
│   ├── 机器人创建.png
│   ├── 任务编排.png
│   ├── 任务执行详情.png
│   ├── 通过本平台实现的知识图谱应用.png
│   └── 通过本平台实现的知识星球应用.png
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                  # FastAPI 入口 + stats/health API
│   ├── config.py                # 配置
│   ├── database.py              # 数据库连接与 migration
│   ├── models/                  # ORM 模型
│   │   ├── provider.py          # 模型供应商
│   │   ├── bot.py               # Bot / 对话 / 消息
│   │   ├── tool.py              # 内置工具注册
│   │   └── orchestration.py     # 编排 / 节点 / 边 / 运行记录
│   ├── schemas/                 # Pydantic schema
│   │   ├── provider.py
│   │   ├── bot.py
│   │   └── orchestration.py
│   ├── routers/                 # API 路由
│   │   ├── providers.py         # 供应商 CRUD
│   │   ├── bots.py              # Bot CRUD + SSE 聊天 + 对话
│   │   ├── tools.py             # 工具列表
│   │   └── orchestrations.py    # 编排 CRUD + 执行 + 运行历史
│   ├── services/
│   │   ├── crypto.py            # Fernet 加密
│   │   ├── llm_factory.py       # LLM 实例工厂
│   │   ├── agent.py             # LangGraph Agent
│   │   ├── orchestration.py     # DAG 执行引擎 + 拓扑排序 + 节点运行
│   │   └── scheduler.py         # Cron 定时调度
│   └── tools/
│       ├── registry.py          # 工具注册表
│       └── builtin.py           # calculator / web_search
└── frontend/
    ├── Dockerfile               # 多阶段构建 (Node + Nginx)
    ├── nginx.conf               # 反向代理
    └── src/
        ├── api/client.ts        # API + SSE 客户端
        ├── types/index.ts       # TypeScript 类型
        ├── components/
        │   └── Layout.tsx       # 侧边栏布局
        └── pages/
            ├── Dashboard.tsx    # 首页统计
            ├── Providers.tsx    # 供应商管理
            ├── Bots.tsx         # Bot 列表
            ├── BotEditor.tsx    # Bot 编辑
            ├── Chat.tsx         # 流式对话
            ├── Orchestrations.tsx       # 编排列表
            ├── OrchestrationEditor.tsx  # DAG 可视化编辑器
            └── OrchestrationRun.tsx     # 执行详情 / 历史
```

## 内置工具

### 网络搜索
| 工具 | 功能 |
|---|---|
| web_search | DuckDuckGo 网页搜索 |
| web_fetch | 抓取网页内容并转为 Markdown |

### 文件操作
| 工具 | 功能 |
|---|---|
| read_file | 读取文件内容，支持行偏移和行数限制 |
| write_file | 写入内容到文件，自动创建父目录 |
| edit_file | 精确替换文件中的文本（需唯一匹配） |
| glob_files | 按 glob 模式匹配文件路径 |
| grep_files | 在文件中搜索正则表达式 |

### 时间工具
| 工具 | 功能 |
|---|---|
| get_current_time | 当前时间、星期、节气、倒计时、时区转换、农历、中国节假日 |

### 诗词
| 工具 | 功能 |
|---|---|
| poetry_search | 按关键词搜索唐诗、宋词、元曲（近 40 万首） |
| poetry_random | 随机获取一首诗词 |
| poetry_get | 根据 ID 获取指定诗词 |
| poetry_authors | 列出诗人/词人及朝代信息 |

## API 概览

### 统计 `/api/stats`
- `GET` — 返回供应商、Bot、编排、执行次数统计

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

### 任务编排 `/api/orchestrations`
- `GET` 列表 / `POST` 创建 / `PUT` 更新 / `DELETE` 删除
- `POST /{id}/execute` — SSE 流式执行编排
- `GET /{id}/runs` — 获取执行历史
- `GET /runs/{run_id}` — 获取单次执行详情

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
