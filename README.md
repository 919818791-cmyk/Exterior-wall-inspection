# 外墙智能巡检平台

> **当前方案决策（2026-10-09）**：检测模型按“墙面类型 + 检测项”在“检测策略”中独立绑定，可选云端 API、本地视觉大模型或 YOLO；组合项单独配置。云端及 OpenAI 兼容视觉服务调用已接入，YOLO 权重执行仍需在模型服务器完成接入。专业检测按建筑生成独立结果并进入审核工作台。

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

前端 Vite 已配置 `envDir: ".."`，会读取根目录 `.env` 中的 `VITE_API_BASE_URL`。开发环境默认使用同源 `/api`，由 Vite 转发到 `BACKEND_DEV_SERVER_URL`（默认 `http://127.0.0.1:8000`），避免浏览器从局域网地址访问时把后端误解析为客户端自己的 `127.0.0.1`。

## 2. 启动基础服务

```powershell
docker compose up -d postgres minio redis
```

默认端口：

- PostgreSQL：`127.0.0.1:5433`
- MinIO API：`http://127.0.0.1:9002`
- MinIO Console：`http://127.0.0.1:9003`
- Redis：`127.0.0.1:6379`

MinIO 默认账号密码来自 `.env.example`：

- Access Key：`building_exterior_minio`
- Secret Key：`building_exterior_minio_secret`

## AI 推理模型状态

`/trials/new` 免费试用页面和专业检测共用同一套视觉推理服务；专业检测会按所选建筑分别归档任务和报告。后端仍通过 `/api/trial/*` 和 `/api/projects/*` 提供稳定的数据接口。

简易体验使用后端视觉检测服务，不加载本地 `.pt` 模型。快速体验与专业检测分别默认提供每账号 1000 张的一次性总检测额度，管理员可以为账号分别设置快速体验（基础版额度）和专业检测（专业版额度），额度按实际进入检测任务的照片数扣除，上传、预检淘汰或删除照片均不扣额度；但账号当前未送检照片数不能超过对应检测额度余额，删除未送检照片后会立即释放上传空间。额度不自动重置，且不限制单个专业检测项目的照片数。专业检测支持生成三维模型。不限制模型 API 请求数，也不限制检测结果归档份数。每 10 分钟最多发起 5 次检测。专业检测和快速体验的单张照片上传上限均为 20MB；快速体验支持 JPG、MPO 或 PNG 图片，不设置单次任务固定照片张数上限，普通客户账号的本次检测照片数不能超过快速体验剩余额度，可继续上传数量为快速体验剩余额度减去账号已有未送检照片数；不设置每日上传总 MB 限额。6400 万像素解码安全上限内使用原始分辨率，按 `1280 x 960` 像素切片，相邻 TILE 保持 25% 重叠；单任务内部可配置 1–10 个并发视觉模型请求。系统不再以 1200 万像素作为缩小阈值。

后端通过根目录 `.env.local`（优先）或 `.env` 中的以下配置调用 API：

```env
DASHSCOPE_API_KEY=替换为实际百炼API-Key
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

上传入口按照“检测策略 → 通用设置 → 照片相关性判断”指定的视觉模型执行图片预检。该项与其他策略使用相同的模型来源和指定模型控件，可以绑定云端 API 或本地视觉模型；模型管理会显示预置的照片预检模型及其实际服务名称。首次使用时沿用服务器已有 `PHOTO_GUARD_*` 配置：云端部署默认使用百炼 `qwen3-vl-flash` 并复用 `DASHSCOPE_API_KEY`、`QWEN_API_BASE_URL`、`QWEN3_VL_FLASH_MODEL`；本地部署（`PHOTO_GUARD_PROVIDER=openai_compatible`）显示并使用 `PHOTO_GUARD_API_BASE_URL`、`PHOTO_GUARD_MODEL` 和可选的 `PHOTO_GUARD_API_KEY`。保存显式绑定后，新上传照片的预检及健康检查使用该绑定，不再读取旧服务作为备用。

预检只判断照片是否属于建筑全景、外立面或建筑局部，不执行缺陷检测。上传时先把原图写入 MinIO 并提交照片记录，再读取原图、生成最长边 1280、最多 150 万像素、质量 82 的 JPEG 推理副本；原图不会降质或被模型覆盖。预检提示词和返回格式仍要求 `{"category":"BUILDING"}` 或 `{"category":"OTHER"}`，不使用缺陷检测的 bbox 数组格式。

预检状态分为 `pending`、`running`、`passed`、`rejected` 和 `error`。不合格、模型超时或服务失败都不会自动删除原图，用户仍可预览或主动删除；如需再次判断，需删除后重新上传照片。开始缺陷检测时，待处理、处理中或失败状态会阻止任务提交，明确不合格照片会被排除，只有 `passed` 照片进入检测任务。默认浏览器上传并发为 6，云端预检并发为 5。

```env
PHOTO_GUARD_ENABLED=true
PHOTO_GUARD_PROVIDER=dashscope
# 以下三项留空时复用 DASHSCOPE_API_KEY、QWEN_API_BASE_URL 和 QWEN3_VL_FLASH_MODEL
PHOTO_GUARD_API_BASE_URL=
PHOTO_GUARD_MODEL=
PHOTO_GUARD_API_KEY=
PHOTO_GUARD_REQUEST_CONCURRENCY=5
PHOTO_GUARD_MAX_INFERENCE_PIXELS=1500000
PHOTO_GUARD_MAX_EDGE=1280
PHOTO_GUARD_JPEG_QUALITY=82
PHOTO_GUARD_FAIL_OPEN=false
```

API Key 只保存在服务端环境变量中，不使用 `VITE_` 前缀，不写入前端或版本库。“模型管理”可新增、编辑云端 API 和本地视觉模型，在各自 Tab 填写显示名称以及 API Key 的环境变量名称；服务地址和服务中的模型名称不在界面编辑，新增模型沿用服务器的 `QWEN_API_BASE_URL` / `QWEN_MODEL` 或 `LOCAL_QWEN_API_BASE_URL` / `LOCAL_QWEN_MODEL`，编辑已有模型保留原配置。预置模型的空字段沿用上述服务器配置。云端服务须兼容视觉 `chat/completions` 接口及当前提示词约定的 JSON 返回格式。本地模型并发额外受 `LOCAL_QWEN_MAX_CONCURRENCY` 限制。

“检测策略”（原“检测提示词”，地址仍为 `/detection-prompts`）为每种墙面的单项及组合项指定具体模型。组合项不复用单项绑定；YOLO 必须指定具体权重版本，各项均可选择任意已有 YOLO 模型，适用墙面和检测项完全由策略绑定决定。“推理设置”仅维护并发、频率和检测额度，不再选择模型。配置缺失或尚未接入的运行服务会阻止检测，不能自动切换到其他模型。正式任务保存模型、服务地址、提示词及并发快照，排队任务沿用创建时的配置。

本地模型启停统一从“模型管理”操作。Linux GPU 服务器启用 `LOCAL_QWEN_CONTROL_ENABLED=true` 并配置 vLLM 后可手动启动或停止；保存策略、保存推理设置及后端启动均不会触发启停。Windows 显示不可启停的原因，允许先保存配置。预置本地模型使用 `.runtime/local-qwen.log`，新增模型使用独立的 `.runtime/vision-<模型 ID>/local-qwen.log`，多个模型需配置不同服务端口。服务器待完成内容见 [检测策略与模型服务器接入说明](docs/检测策略与模型服务器接入说明.md)。

YOLO 模型管理维护名称、说明及独立权重版本，不再设置“适用墙面”和“支持的检测类型”。详情（`?model=<模型 UUID>`）提供 `.pt` 权重上传、版本编辑、版本独立启停和删除；元数据保存在数据库，文件保存在 MinIO，默认上传上限为 1 GB（`YOLO_MODEL_MAX_UPLOAD_BYTES`）。同一模型版本号唯一，各版本独立启停，允许多个版本同时运行；运行中或被检测策略引用的版本不能删除。执行 `alembic upgrade head` 更新数据库：0061 保留原有权重和版本，0062 把原全局模型选择迁移到独立策略；历史适用范围记录保留但不再用于模型筛选或绑定校验。0063 移除版本互斥约束，并将旧的跟随绑定固定到原选定版本。YOLO 启停入口位于各版本行，运行服务未接入时按钮禁用并说明原因，绑定 YOLO 的策略会在执行前明确报错。

## 3. 启动后端

Windows 本地开发可直接双击项目根目录的 `start.bat`，它会分别打开前端和后端窗口；停止时双击 `stop.bat`。这两个脚本只管理前后端，不会启动或停止 Docker 服务。首次运行时会自动补齐缺失的 Python 或前端依赖。

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

首页、专业检测列表和快速体验记录页无需登录即可访问；进入新增专业检测或快速体验页时会跳转到登录页。开发环境默认启用以下测试账号；生产环境请修改 `AUTH_SECRET_KEY` 并设置 `AUTH_SEED_DEMO_USERS=false`：

未登录时，专业检测和快速体验列表都会展示只读的“示例项目”；登录后会在示例之后显示当前账号可访问的数据。该示例对所有账号开放查看和结果导出，但不能重命名、追加检测或删除。

| 角色 | 用户名 / 手机号 | 密码 | 可用范围 |
| --- | --- | --- | --- |
| 客户用户 | `customer` / `13800000001` | `Customer123!` | 本人项目、快速体验和审核完成报告 |
| 内部审核人员 | `reviewer` / `13800000002` | `Reviewer123!` | 全部专业检测只读、审核工作台和正式报告下载；快速体验记录仅本人及示例项目 |
| 管理员 | `admin` / `13800000003` | `Admin123!` | 全部功能 |

### 注册与登录短信验证码

注册账号与手机号登录已接入阿里云号码认证服务（Dypnsapi）：注册前端先调用
`POST /api/auth/registration/sms-code` 发送验证码，随后把验证码随
`POST /api/auth/trial-application` 一并提交；只有阿里云
`CheckSmsVerifyCode` 返回 `PASS` 才会创建账号。手机号登录先调用
`POST /api/auth/login/sms-code`，再把手机号与验证码提交到
`POST /api/auth/login`。注册与登录的同手机号发送间隔均为 30 分钟；手机号/IP
小时限额和核验错误次数均由后端及 Redis 统一控制，AccessKey 不会进入前端包。

在根目录 `.env.local`（本地）或 `.env`（生产）配置：

```dotenv
SMS_VERIFICATION_ENABLED=true
ALIYUN_DYPNS_ACCESS_KEY_ID=RAM用户AccessKeyId
ALIYUN_DYPNS_ACCESS_KEY_SECRET=RAM用户AccessKeySecret
ALIYUN_DYPNS_REGION_ID=ap-southeast-1
ALIYUN_DYPNS_ENDPOINT=dypnsapi.aliyuncs.com
SMS_VERIFICATION_SIGN_NAME=号码认证控制台当前可用的系统赠送签名
SMS_VERIFICATION_TEMPLATE_CODE=100001
SMS_VERIFICATION_AUTH_SEND_INTERVAL_SECONDS=1800
```

RAM 用户仅需授予 `dypns:SendSmsVerifyCode` 和
`dypns:CheckSmsVerifyCode`。请从号码认证控制台填写当前可用的系统签名，
不要长期写死 OpenAPI 测试页中的历史签名。未启用或配置不完整时，注册与登录
短信接口会返回 `503`，不会绕过手机验证直接创建账号或登录。

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
- 启动检测时多选裂缝、脱落、空鼓（默认全选）
- 专业检测提交后立即启动推理并显示“检测中”，任务启动期间短暂显示“正在排队”
- `POST /api/projects/{project_id}/start-detection` 为项目启动唯一的 AI 检测任务；无热成像照片时不触发空鼓分析
- 正式照片复用 TRIAL 的 `1280 x 960`、25% 重叠切片、跨 TILE 融合和 NMS 坐标回写流程
- 正式项目与简易检测共用推理模型、检测提示词和全局/单任务并发；实际送检照片额度分别计算
- 每个正式项目只生成一个检测任务、一条审核工作台记录和一份正式报告
- 检测任务成功后自动写入 `ai_detection_result`、创建项目草稿报告并将项目流转到 `pending_review`
- 检测任务异常仅记录在任务层，项目恢复为 `draft` 可重新发起检测
- 独立模拟 Worker，可本地运行或作为 Docker Compose profile 运行
- 审核工作台内置标注编辑器，支持缺陷框新增、移动、缩放、改类和删除
- 完成项目审核并固化唯一报告后，项目流转到 `reviewed`
- 检测工作台详情只通过 `/api/projects/{project_id}/reviewed-result` 读取已固化结果；`pending_review` 阶段不返回 AI 原始框
- `/api/reports` 检测结果列表、详情、正式报告推送和 DOCX 下载接口
- 检测结果列表页、结果详情页、AI 检测体验归档、审核后项目详情查看结果，以及推送后的正式报告交付
- 报告文件字段统一为 `docx_bucket`、`docx_object_key`
- `backend/templates/reports/正式报告示例.docx` 作为正式报告 DOCX 模板
- AI 检测体验归档保存上传照片和简易识别结果，不生成 DOCX 文件
- `POST /api/auth/login/sms-code`、`POST /api/auth/login`、`GET /api/auth/me`、`POST /api/auth/logout` 基础登录会话
- Bearer 登录态刷新恢复；专业检测和免费试用列表页公开访问，新增页及其他业务路由跳转登录页
- 客户用户仅看到自己的项目、项目审核完成后固化的检测结果、已推送正式报告和自己的体验归档，且无法访问审核接口或审核菜单
- 内部审核人员和管理员可访问审核工作台；审核员对其他账号的项目源数据只读，不能修改、上传、启动检测或删除
- 管理员重置账号密码时生成随机临时密码，不再使用固定默认密码

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
