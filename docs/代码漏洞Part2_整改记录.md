# 代码漏洞 Part 2：硬编码手机号与 URL 整改

依据根目录 `代码漏洞part2.docx`，共核对 49 条手机号和 553 条 URL 告警。原报告行号保存在 `audit/security-part2/verification.json`，修改后行号会变化。

第二次复测 `第二次漏洞part2.docx` 剩余 511 条，恰好是首次处理时保留的 510 条锁文件元数据及 1 条 XMP 标记。首次仅标为误报没有满足复扫要求，本次已修改这两个来源，未添加扫描排除或忽略规则。

| 告警类型 | 数量 | 处置 |
| --- | ---: | --- |
| 业务及演示账号手机号 | 6 | 改为环境配置；无固定号码回退 |
| 测试手机号 | 43 | 使用生成的模拟号码，短信仍由假客户端处理 |
| 业务及开发代理 URL | 5 | 改为环境配置；校验地址协议和内嵌凭据 |
| 测试 URL | 37 | 通过测试数据工厂的参数生成，保留请求路径及 URL 校验场景 |
| npm 锁文件 URL | 510 | 改由 registry 配置解析下载地址；移除含 URL 的可选展示元数据 |
| XMP 命名空间 URI | 1 | 从二进制测试素材读取格式标记，Python 源码不再包含固定 URI |

## 业务变更

- `backend/app/api/dependencies.py`：演示客户、审核员和管理员的手机号分别读取 `AUTH_DEMO_CUSTOMER_PHONE`、`AUTH_DEMO_REVIEWER_PHONE`、`AUTH_DEMO_ADMIN_PHONE`。空配置的新账号保留 `NULL`，仍支持用户名登录；初始化不覆盖数据库中已有手机号。生产环境仍禁止演示账号初始化。
- `frontend/src/config/publicContact.ts`：集中读取 `VITE_CONTACT_BUSINESS_MOBILE`、`VITE_CONTACT_TECHNICAL_MOBILE`、`VITE_CONTACT_LANDLINE`，首页和隐私政策共用。未配置时显示提示，隐私政策不生成空的 `tel:` 链接。
- `frontend/vite.config.ts`：后端代理、高德样式代理及 REST 代理分别使用 `BACKEND_DEV_SERVER_URL`、`AMAP_WEB_API_URL`、`AMAP_REST_API_URL`。开发/预览缺少后端代理地址时明确报错；开发启用高德安全码代理时须同时配置两个高德上游。
- `frontend/src/components/project/ProjectLocationMap.tsx`：SDK 地址使用 `VITE_AMAP_SDK_URL`，版本、Key、插件用 URL 参数设置。脚本地址要求 HTTPS 且不能包含用户名或密码；缺少 SDK 配置时显示地图未配置提示。
- `backend/app/api/system_settings.py`：云端隐私披露链接使用 `QWEN_PRIVACY_POLICY_URL`；空配置不返回链接。自定义云端模型继续不展示预置供应商链接。
- `backend/app/core/config.py`：移除 `QWEN_API_BASE_URL` 的内置地址，并一并移除 CORS、MinIO 公开下载地址和 Worker 后端 HTTP 地址的代码默认值。示例配置继续保存在 `.env.example`。生产配置不能仅提供云端 Key 而缺少服务地址。

当前本机既有公开联系方式、地图和隐私链接已迁移到未跟踪的 `.env`；此前缺省的开发代理地址也已写入本机配置。配置示例不含真实联系号码。部署其他环境时应根据 `.env.example` 补齐新增配置，前端配置变更后须重新构建，后端配置变更后须重启服务。本次未重启生产后端。

公开联系电话、浏览器可访问的 SDK 地址仍会出现在网页或前端产物中，这是公开功能所需；本次移除的是源码中固定的业务号码和地址。私密手机号及凭据不能放入 `VITE_*` 配置。

## 第二次复测补修

`frontend/.npmrc` 使用 npm 官方支持的 `omit-lockfile-registry-resolved=true`：锁文件固定版本和完整性校验值，下载地址由安装环境的 registry 配置解析。部署环境可通过 npm 配置或 `NPM_CONFIG_REGISTRY` 指定源，无需在锁文件中固定某个镜像。该选项可能增加安装时的 registry 查询次数，见 [npm 官方配置说明](https://docs.npmjs.com/cli/v11/using-npm/config/#omit-lockfile-registry-resolved)。

`frontend/scripts/normalize-lockfile.mjs` 移除 442 个 registry 下载地址、50 个资助字段（共 67 个 URL）和 1 个含 URL 的许可证说明字段。许可证说明是锁文件中可选的展示元数据，未修改第三方下载包中的版权、许可说明或内容。443 个包条目的版本、依赖关系、完整性校验值及其他数据保持一致；另按新增的根项目安装钩子记录 `hasInstallScript=true`。

`postinstall` 会在普通依赖安装后执行整理，构建前执行只读检查，阻止固定 URL 再次进入构建。使用 `--ignore-scripts` 或其他绕过根项目安装钩子的命令更新锁文件时，应手动执行 `npm run lockfile:normalize`。整理脚本仅允许按名称及固定版本解析的 registry 包；遇到 Git、本地文件或其他 tarball 来源不会直接删除来源，而会停止并要求评审。

`backend/tests/fixtures/jpeg_xmp_header.bin` 保留原来相同的 29 字节标准标记。`test_phase7_routes.py` 从测试素材读取它，再组合各用例的 DJI 元数据，图片格式和解析断言保持不变。同时将后续新增 YOLO 测试中的固定回环地址改为已有测试数据工厂的参数。

本地清单检查已覆盖两次报告，第二次报告的两个来源文件均没有 HTTP URL 字面量；没有继续保留告警豁免。`audit/security-part2/verify-findings.py` 仍不替代原安全扫描工具，应使用原工具正式复扫确认最终告警数量。

## 第二次复测验证

- 在全新临时目录执行 `npm ci --prefer-offline --no-audit --no-fund` 成功，不影响当前工作区依赖目录。
- 使用全新安装的依赖执行完整前端 TypeScript 检查及生产构建成功；构建前锁文件检查也通过。
- 执行 `npm install --package-lock-only --offline --no-audit --no-fund` 后，安装钩子正常整理锁文件；结果与当前提交中的规范锁文件一致。
- 63 项相关后端测试通过，覆盖 XMP 热成像元数据、配置安全校验、检测策略及 YOLO 测试。
- 两次报告所指源码及锁文件中均无固定手机号或 HTTP URL 残留。443 个包条目的版本、关系与完整性校验值保持一致。
- 证据：`audit/security-part2/npm-ci-retest.txt`、`frontend-clean-build-retest.txt`、`npm-lockfile-refresh-retest.txt`、`npm-retest-verification.json`、`backend-retest.txt`、`verification.json`。本次未修改 CSS、未重启生产服务。

## 首次整改验证记录

- 相关回归：227 项通过，包含 18 项新增配置、安全校验、演示账号初始化和隐私披露测试。
- 全量后端：676 项通过、6 项跳过、6 项失败。失败项涉及既有路由断言和试用检测结果；在隔离副本中撤去本次业务代码改动后，复现相同的 6 项失败。详见 `audit/security-part2/backend-tests.txt` 和 `baseline-failures.txt`。
- 前端 TypeScript 检查及生产构建通过，保留既有大分块提示。日志：`audit/security-part2/frontend-build.txt`。
- 首次报告清单检查保留了依赖元数据及标准命名空间标记；这些保留项已在第二次复测补修中处理，`verification.json` 已更新为当前状态。
- 浏览器检查：脚本为 `audit/security-part2/browser.mjs`，检查桌面/手机的首页和法律页面、正常/空配置的联系电话和拨号链接，以及地图 SDK 配置和空配置回退；使用模拟登录态，不创建或修改真实账号。结果见 `audit/security-part2/browser.json`。

复核命令（在项目根目录运行）：

```bash
python3 audit/security-part2/verify-findings.py
cd backend
.venv/bin/python -m pytest tests/test_security_part2.py -q
```

前端：在 `frontend/` 执行 `npm run build`。浏览器脚本接收两个本地 Vite 入口：第一处使用已配置的环境，第二处用空的 `VITE_CONTACT_*` 和 `VITE_AMAP_SDK_URL` 启动，用于检查配置缺失状态。
