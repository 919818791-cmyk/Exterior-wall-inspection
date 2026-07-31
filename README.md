# 外墙巡检智能平台

> **当前方案决策（2026-07-27）**：YOLO/Worker 本地权重方案仍暂停；正式项目管理流程已恢复，并与 `/trial` 共用“推理设置”中选择的视觉模型和提示词。项目检测按建筑生成独立结果，进入审核工作台后复用标注编辑器完成审核。

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

## AI 推理模型状态

`/trial` 简易检测和正式项目检测共用同一套视觉推理服务；正式项目检测会按所选建筑分别归档任务和报告。

简易体验使用后端视觉检测服务，不加载本地 `.pt` 模型。默认每位用户 10 分钟内最多上传 30 张照片、发起 5 次检测；不限制每天成功上传或检测的照片总数，也不限制检测结果归档份数。默认每位用户按北京时间每天最多使用 800 次模型 API 请求；API 请求额度按图片切片数在推理前预占，失败时退回。单次任务最多 10 张 JPG、MPO 或 PNG 图片，单张最大 10MB，不设置每日上传总 MB 限额。6400 万像素解码安全上限内使用原始分辨率，按 `1280 x 960` 像素切片，相邻 TILE 保持 25% 重叠；单任务内部可配置 1–10 个并发视觉模型请求。系统不再以 1200 万像素作为缩小阈值。

后端通过根目录 `.env` 中的以下配置调用 API：

```env
DASHSCOPE_API_KEY=替换为实际百炼API-Key
# 可选的智谱备用 API
ZHIPU_API_KEY=替换为实际智谱API-Key
QWEN_API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3-vl-plus
QWEN3_VL_FLASH_MODEL=qwen3-vl-flash
LOCAL_QWEN_API_BASE_URL=http://127.0.0.1:9005/v1
LOCAL_QWEN_MODEL=qwen3-vl-32b
# 本地服务未启用鉴权时保持为空
LOCAL_QWEN_API_KEY=
LOCAL_QWEN_CONTROL_ENABLED=true
LOCAL_QWEN_VLLM_EXECUTABLE=/home/szcay/.venvs/vllm/bin/vllm
LOCAL_QWEN_MODEL_PATH=/opt/models/Qwen3-VL-32B-Instruct-FP8
LOCAL_QWEN_CUDA_VISIBLE_DEVICES=0,1
LOCAL_QWEN_CUDA_HOME=
LOCAL_QWEN_USE_DEEP_GEMM=false
LOCAL_QWEN_USE_FLASHINFER_SAMPLER=false
LOCAL_QWEN_TENSOR_PARALLEL_SIZE=2
LOCAL_QWEN_MAX_CONCURRENCY=1
LOCAL_QWEN_GPU_MEMORY_UTILIZATION=0.75
LOCAL_QWEN_MAX_MODEL_LEN=16384
QWEN_REQUEST_TIMEOUT_SECONDS=120
QWEN_MAX_CONCURRENCY=5
```

上传入口另有一套始终在线的 `Qwen3-VL-2B-Instruct-FP8` 图片预检服务。它只判断照片是否属于建筑全景、外立面或建筑局部，不执行缺陷检测。上传时先把原图写入 MinIO 并提交照片记录，再从 MinIO 读取原图、生成最长边 1280、最多 150 万像素、质量 82 的 JPEG 推理副本；原图本身不会降质或被模型覆盖。

预检状态分为 `pending`、`running`、`passed`、`rejected` 和 `error`。不合格、模型超时或服务失败都不会自动删除原图，用户仍可预览或主动删除；如需再次判断，需删除后重新上传照片。开始缺陷检测时，待处理、处理中或失败状态会阻止任务提交，明确不合格照片会被排除，只有 `passed` 照片进入检测任务。默认浏览器上传并发为 6，vLLM 最大活动序列数为 8。

```env
PHOTO_GUARD_ENABLED=true
PHOTO_GUARD_API_BASE_URL=http://127.0.0.1:9006/v1
PHOTO_GUARD_MODEL=qwen3-vl-2b-photo-guard
PHOTO_GUARD_REQUEST_CONCURRENCY=8
PHOTO_GUARD_MAX_INFERENCE_PIXELS=1500000
PHOTO_GUARD_MAX_EDGE=1280
PHOTO_GUARD_JPEG_QUALITY=82
PHOTO_GUARD_FAIL_OPEN=false
PHOTO_GUARD_MODEL_PATH=/opt/models/Qwen3-VL-2B-Instruct-FP8
PHOTO_GUARD_CUDA_VISIBLE_DEVICES=0
PHOTO_GUARD_GPU_MEMORY_UTILIZATION=0.16
PHOTO_GUARD_MAX_NUM_SEQS=8
PHOTO_GUARD_MAX_MODEL_LEN=4096
```

以当前应用用户安装开机自启服务：

```bash
./deploy/install-photo-guard-service.sh
systemctl --user status building-photo-guard.service
```

安装脚本会启用 systemd user linger，因此服务器重启后无需用户登录，模型也会自动启动。服务只监听 `127.0.0.1:9006`，日志通过 `journalctl --user -u building-photo-guard.service` 查看。2B 准入服务常驻 GPU 0；32B 双卡配置相应收紧到 75% 显存和 16K 上下文，以预留共存空间。

`DASHSCOPE_API_KEY`、`ZHIPU_API_KEY`、API 地址和模型只能由后端环境变量读取：不要使用 `VITE_` 前缀，不要写入前端代码、日志或版本库。“阿里云Qwen3-VL-Plus”和“阿里云Qwen3-VL-Flash”共用同一个 `DASHSCOPE_API_KEY` 与 `QWEN_API_BASE_URL`，切换时只改变模型 ID；“本地 Qwen3-VL-32B”通过 `LOCAL_QWEN_API_BASE_URL` 连接 OpenAI 兼容服务，本地服务未开启鉴权时 `LOCAL_QWEN_API_KEY` 可以留空。管理员可在“管理中心 -> 推理设置”的任务调度模块统一维护并发数、每日模型请求额度和每账号检测次数；本地模型的实际请求并发还会受 `LOCAL_QWEN_MAX_CONCURRENCY` 限制，32B 模型建议从 `1` 开始，以免多个视觉编码请求同时占满显存。上传上限、限流窗口、请求超时与任务占位超时继续由后端环境配置维护。页面还可维护两套检测提示词。保存后对下一次新任务立即生效。被选服务配置缺失或不可用时，`/api/trial/generate` 会直接报错，不降级为模拟结果。

当 `LOCAL_QWEN_CONTROL_ENABLED=true` 时，选择“本地 Qwen3-VL-32B”会按上述 vLLM 配置启动本地模型，页面在模型健康检查通过前显示“正在启动”；选择任一云端模型会立即停止本地进程并释放 GPU，因此应在本地检测任务结束后再切换。后端重启时会按数据库中保存的当前选项自动恢复一致状态。运行日志保存在项目根目录 `.runtime/local-qwen.log`。

历史 `algorithm-worker` 和 `algorithm-model` 本地权重适配层仍保留用于契约测试和追溯，但当前正式项目检测由 Web 后端直接调用“推理设置”选中的视觉模型。

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

开发环境 API 文档（生产环境默认关闭）：

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

| 角色 | 用户名 / 手机号 | 密码 | 可用范围 |
| --- | --- | --- | --- |
| 客户用户 | `customer` / `13800000001` | `Customer123!` | 项目、AI 检测体验、已推送报告 |
| 内部审核人员 | `reviewer` / `13800000002` | `Reviewer123!` | 审核工作台、报告预览和推送 |
| 管理员 | `admin` / `13800000003` | `Admin123!` | 全部功能 |

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
- 业务表 SQLAlchemy Model
- 集中状态枚举、UTC 时间字段、软删除字段约定
- 对应 Pydantic Create/Read Schema
- Alembic 初始迁移文件
- 数据库连接检查脚本 `python -m app.db.check_connection`
- PostgreSQL、MinIO、Redis Docker Compose 基础服务
- 算法 Worker 后端地址、Worker Token、MinIO 访问地址和正式模型内部地址等环境变量预留
- 项目 CRUD 闭环
- 项目照片统一上传、MinIO 图片存储、照片列表与删除
- 启动检测时多选裂缝、剥落、空鼓（默认全选）
- `POST /api/projects/{project_id}/start-detection` 为项目启动唯一的 AI 检测任务；无热成像照片时不触发空鼓分析
- 正式照片复用 TRIAL 的 `1280 x 960`、25% 重叠切片、跨 TILE 融合和 NMS 坐标回写流程
- 正式项目与简易检测共用推理模型、检测提示词、全局/单任务并发和账号切片请求额度
- 每个正式项目只生成一个检测任务、一条审核工作台记录和一份正式报告
- 检测任务成功后自动写入 `ai_detection_result`、创建项目草稿报告并将项目流转到 `pending_review`
- 检测任务异常仅记录在任务层，项目恢复为 `draft` 可重新发起检测
- 独立模拟 Worker，可本地运行或作为 Docker Compose profile 运行
- 审核工作台复用标注管理编辑器，支持缺陷框新增、移动、缩放、改类和删除
- 完成项目审核并固化唯一报告后，项目流转到 `reviewed`
- 检测工作台详情只通过 `/api/projects/{project_id}/reviewed-result` 读取已固化结果；`pending_review` 阶段不返回 AI 原始框
- `/api/reports` 检测结果列表、详情、正式报告推送和 DOCX 下载接口
- 检测结果列表页、结果详情页、AI 检测体验归档、审核后项目详情查看结果，以及推送后的正式报告交付
- 报告文件字段统一为 `docx_bucket`、`docx_object_key`
- `backend/templates/reports/正式报告示例.docx` 作为正式报告 DOCX 模板
- AI 检测体验归档保存上传照片和简易识别结果，不生成 DOCX 文件
- `POST /api/auth/login`、`GET /api/auth/me`、`POST /api/auth/logout` 基础登录会话
- Bearer 登录态刷新恢复、未登录业务路由跳转登录页
- 客户用户仅看到自己的项目、项目审核完成后固化的检测结果、已推送正式报告和自己的体验归档，且无法访问审核接口或审核菜单
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

以下 Worker 说明仅用于历史适配层和 API 契约联调：

- `algorithm-worker`：持有后端访问 Token，主动拉取任务、下载图片、调用模型、回传结果。
- `algorithm-model`：只提供 Docker 内部网络推理接口，不直接访问数据库，不持有 Worker Token，默认不映射公网端口。

当前正式项目链路由 Web 后端主动调用“推理设置”选中的视觉模型，不依赖 Worker 领取任务。

## 8. 权限边界与会话说明

- 客户用户的 `pending_review` 项目只显示“审核中”，不展示 AI 原始框或审核过程；项目进入 `reviewed` 后，检测工作台详情才展示固化的审核结果。
- 审核 API 在服务端校验 `reviewer` / `admin` 角色；仅隐藏菜单不能绕过接口权限。
- 项目、照片、检测配置和结果接口要求登录。客户用户只能读取和操作自己创建的项目，并只能读取其审核后固化结果与最终报告。
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
