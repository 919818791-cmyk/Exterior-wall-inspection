# 外墙巡检智能平台

本仓库当前已推进到第 8 阶段：登录、角色权限与菜单边界。静态原型已整理至 `原型/`，新开发工程位于：

- `原型/`：可直接打开的静态 HTML 原型及其资源
- `frontend/`：React + TypeScript + Vite + HeroUI
- `backend/`：FastAPI + SQLAlchemy + Alembic
- `algorithm-worker/`：独立模拟算法 Worker，用于开发机和容器联调
- `docker-compose.yml`：PostgreSQL、MinIO、Redis 基础服务

## 环境要求

- Node.js 20 或更高版本
- Python 3.11 或更高版本
- Docker Desktop 或兼容 Docker Compose 的运行环境

## 1. 准备环境变量

```powershell
Copy-Item .env.example .env
```

前端 Vite 已配置 `envDir: ".."`，会读取根目录 `.env` 中的 `VITE_API_BASE_URL`。

## 2. 启动基础服务

```powershell
docker compose up -d postgres minio redis
```

默认端口：

- PostgreSQL：`localhost:5433`
- MinIO API：`http://localhost:9002`
- MinIO Console：`http://localhost:9003`
- Redis：`localhost:6379`

MinIO 默认账号密码来自 `.env.example`：

- Access Key：`building_exterior_minio`
- Secret Key：`building_exterior_minio_secret`

## 简易 AI 体验模型状态

当前先跑通 `/trial` 简易检测体验，不依赖项目管理、审核工作台或正式检测任务流。

简易体验使用后端视觉检测服务，不加载本地 `.pt` 模型。单次任务最多上传 10 张 JPG 或 PNG 图片；后端将每张图片按 `1280 x 960` 像素切片，相邻 TILE 保持 25% 重叠，每个 TILE 单独发起一次 API 请求。请求不携带历史上下文，同一任务最多并发 5 个 TILE 请求；Qwen3-VL 返回的 `[0,999]` 归一化 bbox 先换算为 TILE 像素坐标，再映射回原图并按缺陷类别执行 NMS 去重。

后端通过根目录 `.env` 中的以下配置调用 API：

```env
DASHSCOPE_API_KEY=替换为实际百炼API-Key
QWEN_API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3-vl-plus
QWEN_REQUEST_TIMEOUT_SECONDS=120
QWEN_MAX_CONCURRENCY=5
```

`DASHSCOPE_API_KEY` 只能由后端读取：不要使用 `VITE_` 前缀，不要写入前端代码、`.env.example`、日志或版本库。`.env.example` 只保留占位值；密钥一旦泄露，应立即在百炼控制台撤销并重新生成。API Key 未配置或服务不可用时，`/api/trial/generate` 会直接报错，不降级为模拟结果。

正式项目检测任务流仍保留 `algorithm-worker` 和 `algorithm-model` 本地权重适配层；相关 Docker、PyTorch 和模型权重配置不用于 `/trial`。

## 3. 启动后端

```powershell
Set-Location backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
```

API 文档：

- `http://127.0.0.1:8000/api/docs`
- `http://127.0.0.1:8000/api/redoc`

## 4. 数据库迁移与连接检查

启动 PostgreSQL 后执行：

```powershell
Set-Location backend
alembic upgrade head
python -m app.db.check_connection
```

如需查看迁移 SQL 而不连接数据库：

```powershell
Set-Location backend
alembic upgrade head --sql
```

## 5. 启动前端

另开一个终端：

```powershell
Set-Location frontend
npm install
npm run dev
```

访问：

- `http://localhost:5175`

首次访问业务页面会跳转到登录页。开发环境默认启用以下测试账号；生产环境请修改 `AUTH_SECRET_KEY` 并设置 `AUTH_SEED_DEMO_USERS=false`：

| 角色 | 用户名 | 密码 | 可用范围 |
| --- | --- | --- | --- |
| 客户用户 | `customer` | `Customer123!` | 项目、AI 检测体验、已推送报告 |
| 内部审核人员 | `reviewer` | `Reviewer123!` | 审核工作台、报告预览和推送 |
| 管理员 | `admin` | `Admin123!` | 全部功能 |

如果 `5175` 已被占用，可以临时改用其他端口：

```powershell
$env:VITE_API_BASE_URL = "http://127.0.0.1:8001/api"
npm run dev -- --host 127.0.0.1 --port 5174
```

## 6. 当前已实现

- 前端基础目录结构、Vite 配置、HeroUI Provider、React Router 路由骨架
- TanStack Query 接入 `/api/health`
- Zustand 预留轻量状态管理
- 后端 FastAPI 应用入口、CORS、统一异常响应
- `/api/health` 健康检查接口
- SQLAlchemy 数据库连接配置和 Alembic 骨架
- 第 2 阶段 15 张业务表 SQLAlchemy Model
- 集中状态枚举、UTC 时间字段、软删除字段约定
- 对应 Pydantic Create/Read Schema
- Alembic 初始迁移文件
- 数据库连接检查脚本 `python -m app.db.check_connection`
- PostgreSQL、MinIO、Redis Docker Compose 基础服务
- 算法 Worker 后端地址、Worker Token、MinIO 访问地址和正式模型内部地址等环境变量预留
- 项目、建筑、立面 CRUD 闭环
- 照片上传批次、MinIO 图片上传、照片列表与删除
- 检测模型多选和高精度检测配置
- `POST /api/projects/{project_id}/start-detection` 启动 AI 检测任务
- Worker API：`GET /api/algorithm/tasks/next`、心跳、结果回传、失败回传
- 检测任务成功后自动写入 `ai_detection_result` 并将项目流转到 `pending_review`
- 检测任务异常仅记录在任务层，项目恢复为 `draft` 可重新发起检测
- 独立模拟 Worker，可本地运行或作为 Docker Compose profile 运行
- 审核工作台、AI 缺陷框复核、人工新增/修改/删除审核结果
- 审核完成后生成固化报告数据并将项目流转到 `reviewed`
- `/api/reports` 检测结果列表、详情、正式报告推送和 DOCX 下载接口
- 检测结果列表页、结果详情页、AI 检测体验归档、推送后普通用户查看最终结果
- 报告文件字段统一为 `docx_bucket`、`docx_object_key`
- `backend/templates/reports/正式报告示例.docx` 作为正式报告 DOCX 模板
- AI 检测体验归档保存上传照片和简易识别结果，不生成 DOCX 文件
- `POST /api/auth/login`、`GET /api/auth/me`、`POST /api/auth/logout` 基础登录会话
- Bearer 登录态刷新恢复、未登录业务路由跳转登录页
- 客户用户仅看到自己的项目、已推送正式结果和自己的体验归档，且无法访问审核接口或审核菜单
- 内部审核人员和管理员可访问审核工作台；报告推送仅限内部审核人员和管理员

## 7. 模拟 Worker 联调

第 5 阶段测试环境不部署真实算法模型，使用固定 JSON 验证任务领取、照片下载、结果回传和状态流转。

本地运行：

```powershell
Set-Location algorithm-worker
$env:WORKER_BACKEND_BASE_URL = "http://localhost:8000"
$env:WORKER_ID = "mock-worker-local"
$env:WORKER_TOKEN = "change-this-worker-token"
$env:WORKER_MODEL_VERSION = "mock-facade-detector-v1"
python .\mock_worker.py
```

容器运行：

```powershell
docker compose --profile worker run --rm algorithm-worker
```

如果只想验证 Worker API 契约、暂时不下载 MinIO 图片：

```powershell
python .\algorithm-worker\mock_worker.py --skip-download
```

正式环境中，系统前端、后端和算法模型部署在同一台服务器。Worker 跟随算法模型部署，建议拆分为：

- `algorithm-worker`：持有后端访问 Token，主动拉取任务、下载图片、调用模型、回传结果。
- `algorithm-model`：只提供 Docker 内部网络推理接口，不直接访问数据库，不持有 Worker Token，默认不映射公网端口。

Web 后端不主动调用算法模型，Worker 不进入 Web 后端进程或 Web 后端容器。

## 8. 权限边界与会话说明

- 客户用户的 `pending_review`、`reviewed` 项目状态仅展示为“结果处理中”或“报告生成中”，不展示审核工作台与人工审核过程。
- 审核 API 在服务端校验 `reviewer` / `admin` 角色；仅隐藏菜单不能绕过接口权限。
- 项目、照片、检测配置和最终报告接口要求登录。客户用户只能读取和操作自己创建的项目及其最终报告。
- 登录令牌存储在浏览器本地存储中；刷新页面后会调用 `/api/auth/me` 恢复会话。退出登录会撤销当前令牌。

## 9. 自测命令

前端：

```powershell
Set-Location frontend
npm run build
```

后端：

```powershell
Set-Location backend
python -m pytest
alembic upgrade head --sql
```

Docker Compose：

```powershell
docker compose config
docker compose up -d postgres minio redis
```
