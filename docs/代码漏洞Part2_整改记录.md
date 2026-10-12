# 代码漏洞 Part 2：硬编码手机号与 URL 整改

依据根目录 `代码漏洞part2.docx`，共核对 49 条手机号和 553 条 URL 告警。原报告行号保存在 `audit/security-part2/verification.json`，修改后行号会变化。

| 告警类型 | 数量 | 处置 |
| --- | ---: | --- |
| 业务及演示账号手机号 | 6 | 改为环境配置；无固定号码回退 |
| 测试手机号 | 43 | 使用生成的模拟号码，短信仍由假客户端处理 |
| 业务及开发代理 URL | 5 | 改为环境配置；校验地址协议和内嵌凭据 |
| 测试 URL | 37 | 通过测试数据工厂的参数生成，保留请求路径及 URL 校验场景 |
| npm 锁文件 URL | 510 | 依赖元数据误报，保留 |
| XMP 命名空间 URI | 1 | 标准格式标记误报，保留 |

## 业务变更

- `backend/app/api/dependencies.py`：演示客户、审核员和管理员的手机号分别读取 `AUTH_DEMO_CUSTOMER_PHONE`、`AUTH_DEMO_REVIEWER_PHONE`、`AUTH_DEMO_ADMIN_PHONE`。空配置的新账号保留 `NULL`，仍支持用户名登录；初始化不覆盖数据库中已有手机号。生产环境仍禁止演示账号初始化。
- `frontend/src/config/publicContact.ts`：集中读取 `VITE_CONTACT_BUSINESS_MOBILE`、`VITE_CONTACT_TECHNICAL_MOBILE`、`VITE_CONTACT_LANDLINE`，首页和隐私政策共用。未配置时显示提示，隐私政策不生成空的 `tel:` 链接。
- `frontend/vite.config.ts`：后端代理、高德样式代理及 REST 代理分别使用 `BACKEND_DEV_SERVER_URL`、`AMAP_WEB_API_URL`、`AMAP_REST_API_URL`。开发/预览缺少后端代理地址时明确报错；开发启用高德安全码代理时须同时配置两个高德上游。
- `frontend/src/components/project/ProjectLocationMap.tsx`：SDK 地址使用 `VITE_AMAP_SDK_URL`，版本、Key、插件用 URL 参数设置。脚本地址要求 HTTPS 且不能包含用户名或密码；缺少 SDK 配置时显示地图未配置提示。
- `backend/app/api/system_settings.py`：云端隐私披露链接使用 `QWEN_PRIVACY_POLICY_URL`；空配置不返回链接。自定义云端模型继续不展示预置供应商链接。
- `backend/app/core/config.py`：移除 `QWEN_API_BASE_URL` 的内置地址，并一并移除 CORS、MinIO 公开下载地址和 Worker 后端 HTTP 地址的代码默认值。示例配置继续保存在 `.env.example`。生产配置不能仅提供云端 Key 而缺少服务地址。

当前本机既有公开联系方式、地图和隐私链接已迁移到未跟踪的 `.env`；此前缺省的开发代理地址也已写入本机配置。配置示例不含真实联系号码。部署其他环境时应根据 `.env.example` 补齐新增配置，前端配置变更后须重新构建，后端配置变更后须重启服务。本次未重启生产后端。

公开联系电话、浏览器可访问的 SDK 地址仍会出现在网页或前端产物中，这是公开功能所需；本次移除的是源码中固定的业务号码和地址。私密手机号及凭据不能放入 `VITE_*` 配置。

## 保留告警的依据

`frontend/package-lock.json` 中的地址来自 npm 下载源和资助信息，不是应用发起业务请求的目标，也不含内嵌认证信息。删除这些元数据或锁文件会影响依赖安装的可复现性，因此本次没有修改锁文件。原报告包含 510 条锁文件告警；当前工作区在本次整改前已有锁文件变更，现有文件检查到 442 个 `resolved` 和 67 个资助 `url`。

`backend/tests/test_phase7_routes.py` 的 `ns.adobe.com/xap/` URI 是构造 JPEG 中 XMP 数据的命名空间字节标记，不触发网络访问。改成部署地址会改变测试图像格式，因此保留。

复扫时应按这两个具体来源进行人工误报审核，不应排除整个业务源码目录或禁用 URL 检查。`audit/security-part2/verify-findings.py` 只核对本报告清单和源码残留，并不替代原安全扫描工具的正式复扫。

## 验证证据

- 相关回归：227 项通过，包含 18 项新增配置、安全校验、演示账号初始化和隐私披露测试。
- 全量后端：676 项通过、6 项跳过、6 项失败。失败项涉及既有路由断言和试用检测结果；在隔离副本中撤去本次业务代码改动后，复现相同的 6 项失败。详见 `audit/security-part2/backend-tests.txt` 和 `baseline-failures.txt`。
- 前端 TypeScript 检查及生产构建通过，保留既有大分块提示。日志：`audit/security-part2/frontend-build.txt`。
- 报告清单检查：业务及测试来源均无固定手机号及 HTTP 目标地址残留，保留标准命名空间标记；检查结果及逐项归类见 `audit/security-part2/verification.json`。
- 浏览器检查：脚本为 `audit/security-part2/browser.mjs`，检查桌面/手机的首页和法律页面、正常/空配置的联系电话和拨号链接，以及地图 SDK 配置和空配置回退；使用模拟登录态，不创建或修改真实账号。结果见 `audit/security-part2/browser.json`。

复核命令（在项目根目录运行）：

```bash
python3 audit/security-part2/verify-findings.py
cd backend
.venv/bin/python -m pytest tests/test_security_part2.py -q
```

前端：在 `frontend/` 执行 `npm run build`。浏览器脚本接收两个本地 Vite 入口：第一处使用已配置的环境，第二处用空的 `VITE_CONTACT_*` 和 `VITE_AMAP_SDK_URL` 启动，用于检查配置缺失状态。
