# 代码漏洞 Part 1 整改记录

整改日期：2026-10-12。依据根目录《代码漏洞Part1_逐项修复方案.docx》，覆盖其原序号 01—34；下表行号为原报告定位，整改后请按函数名定位。

状态说明：**已加固**表示代码修改和对应回归已完成；**保留，待误报复核**表示已核查输入来源和类型契约，保留原行为并提供证据，最终结论由测评方确认；**部署待验收**表示仓库中的保护已验证，实际运行网络仍需验收。当前尚未执行测评方扫描器复扫，不能据此宣称所有告警已消除。

## 实施内容与兼容性

- `backend/app/core/model_security.py` 统一模型标识正则：ASCII 字母/数字起始，后续仅字母、数字、下划线、连字符，长度 1—64。HTTP 路径参数、配置读取和运行目录构造共用约束。新增模型仍由后端生成 UUID，前端无法提交自定义 ID。
- 模型运行目录经 `expanduser()`、`resolve()` 后检查 `is_relative_to()`；拒绝模型目录符号链接，包括指向同一根目录内其他模型的链接。非法配置在控制接口返回固定 422 提示，不执行生命周期操作。保留 `local_qwen` 的已有根目录语义，其余模型使用独立 `vision-<id>` 子目录。服务端根目录来自部署配置，客户端无法指定。
- 实际部署 unit 经核查为 `building-photo-guard.service`，与 `deploy/systemd/building-photo-guard.service`、安装脚本一致。Settings 只接受空值或该 unit；查询和启停在 subprocess 前再次检查固定白名单及是否已由 Settings 启用。动作只接受 `start`、`stop`。显式使用 `shell=False`、参数数组、`--` 选项终止符、固定超时与 `check=True`；查询仅解析 `ActiveState`、`SubState`、`MainPID`，拒绝异常 PID/未知状态。
- 模型路由保留 `require_roles(UserRole.ADMIN)`，启停增加操作者 UUID、模型 ID、unit、动作、结果审计。异常正文、文件路径和子进程输出不进入 HTTP 错误和审计字段；日志保留安全的异常类型与操作上下文。本地模型错误状态也返回固定提示。
- `reports.py` 从明确的 ORM 字段读取预检状态、类别、示例项目标志；缓存预检值，保留 None/pending/running/error → 409、未通过或非 BUILDING → 422、示例写入 → 403。真实依赖 `get_db()` 返回 SQLAlchemy Session，因此直接执行 `db.rollback()`；相关测试替身补齐相同契约。
- 试用检测估算和执行都直接读取经过 Settings 校验的四个参数。已核查线上值为图片/推理像素上限各 64,000,000、单图切片 100、单请求切片 1000；默认值保持一致，以此作为代码中的资源预算上限，仍允许部署降低限额。若未来需提高预算，必须同步评估资源成本并修改上限。像素下限仍为已有的 1,000,000，切片下限仍为 1。APP_ENV 收敛为 development/test/staging/production，兼容大小写和首尾空白，拼写错误拒绝启动。
- QWeather CLI 失败时只输出固定摘要，日志只记录异常类型；保留成功摘要与 `--raw` 的受控 CLI 输出。
- 不修改既有 f-string 日志、测试中的兼容 `getattr`、测量函数的 Mapping/对象双输入兼容，也不修改容器内部 `0.0.0.0:9002`。没有 CSS 或前端行为变更。

## 逐项处置（34/34）

| 序号 | 原报告定位 | 处置 | 对应实现或证据 |
| --- | --- | --- | --- |
| 01 | services/vision_models.py:139 | 已加固 | `control_managed_photo_guard`：固定 unit 白名单、动作白名单、参数分隔、超时、错误脱敏；管理员启停与审计回归。 |
| 02 | services/vision_models.py:120 | 已加固 | `managed_photo_guard_status`：相同 unit 白名单、固定属性参数、仅解析约定字段、异常 PID/状态拒绝。 |
| 03 | db/check_connection.py:11 | 保留，待误报复核 | SQL 为常量 `select 1`；标量进入固定 f-string，不执行外部模板。已在当前数据库执行连接检查，输出 `database connection ok: 1`。 |
| 04 | db/backfill_photo_projection_pose.py:60 | 保留，待误报复核 | 固定模板只打印 ORM 照片 ID 和 `type(exc).__name__`；不打印异常正文。脚本编译通过。 |
| 05 | db/backfill_photo_thumbnails.py:102 | 保留，待误报复核 | 固定模板打印内部完成/失败计数与报告更新计数。脚本编译通过。 |
| 06 | db/backfill_photo_projection_pose.py:62 | 保留，待误报复核 | 固定完成模板及内部计数；同 04 的上下文证据。 |
| 07 | db/harden_production_accounts.py:44 | 保留，待误报复核 | `disabled` 是内部整数计数；脚本原有生产环境检查及保留管理员逻辑。编译通过，未对生产账户执行写操作。 |
| 08 | db/backfill_photo_thumbnails.py:38 | 保留，待误报复核 | 内部模型表名、照片 UUID 和异常类型进入固定模板；不打印凭据/异常正文。 |
| 09 | scripts/qweather_connectivity_test.py:28 | 已加固；原格式串告警待复核 | 移除失败输出中的原始异常；含凭据/恶意换行的两类异常均不泄露。成功输出及 `--raw` 回归通过。 |
| 10 | services/vision_models.py:94 | 已加固 | 统一标识校验、规范化目录、根目录边界、拒绝符号链接；合法 ID、空/长/斜杠/编码/绝对路径/换行/NUL/链接均有回归。 |
| 11 | tests/test_yolo_runtime.py:135 | 保留，待误报复核 | 原 `test_public_model_port_is_rejected` 通过；新增 IPv6 全接口、非回环地址、无映射和多映射拒绝回归。负向测试不删除。 |
| 12 | services/yolo_runtime.py:177 | 部署待验收 | 原 Docker `--publish 127.0.0.1::9002` 与 `_url` 单一回环映射检查保留，启动参数回归通过。当前无 YOLO 版本容器，不能以 MinIO 的 9002 端口代替其验收证据。 |
| 13 | tests/test_phase4_routes.py:54 | 保留，待误报复核 | FakeSession 在 `isinstance(item, Photo)` 后通过固定属性名读取新建对象 ID；照片/事件/路由原有回归通过。 |
| 14 | services/defect_area.py:25 | 保留，待误报复核 | `_value` 的 key 全来自内部常量字段；Mapping、SimpleNamespace、真实 Photo ORM 对象及空/错误类型回归通过。 |
| 15 | api/reports.py:1207 | 已加固 | `trial_max_tiles_per_request` Settings 范围 1—1000，估算/执行直接读取且限额一致。 |
| 16 | services/vision_models.py:93 | 已加固 | 明确 Settings 的 `local_qwen_runtime_dir` 字段及目录边界；空值回退、显式目录和 `~` 扩展兼容。 |
| 17 | services/vision_models.py:164 | 已加固 | 直接读取 `local_qwen_control_enabled` 和校验后的 APP_ENV；已有测试环境禁用本地生命周期逻辑保留并回归。 |
| 18 | api/reports.py:909 | 已加固 | 固定 ORM 状态字段读取、缓存，所有未完成状态阻止检测。 |
| 19 | api/reports.py:1196 | 已加固 | `trial_max_image_pixels` Settings 范围 1,000,000—64,000,000，非法值拒绝，估算/执行一致。 |
| 20 | services/defect_area.py:25 | 保留，待误报复核（重复） | 与 14 同源；同一组 Mapping/对象/空值证据。 |
| 21 | api/reports.py:915 | 已加固 | None 状态保持 409 拒绝；不能绕过照片预检。 |
| 22 | tests/test_phase4_routes.py:54 | 保留，待误报复核（重复） | 与 13 同源；保留新建 ORM 对象兼容逻辑。 |
| 23 | api/reports.py:922 | 已加固 | 从缓存状态统计 pending/running/error；聚合用例验证计数及 409 文案。 |
| 24 | api/reports.py:1197 | 已加固 | `trial_inference_max_image_pixels` Settings 范围 1,000,000—64,000,000，非法值拒绝，估算/执行一致。 |
| 25 | api/reports.py:1619 | 已加固 | Session 契约下直接 rollback；调用真实 `generate_trial_result` 和真实 Session，验证读取对象存储前结束事务、回滚未提交写入且保留照片源快照。 |
| 26 | api/reports.py:943 | 已加固 | 仅 passed 状态有资格继续；rejected/未知状态返回 422。 |
| 27 | api/reports.py:1202 | 已加固 | `trial_max_tiles_per_image` Settings 范围 1—100，非法值拒绝，估算/执行一致。 |
| 28 | api/reports.py:944 | 已加固 | passed 但类别为空/OTHER 仍返回 422；仅 passed + BUILDING 放行。 |
| 29 | services/defect_area.py:25 | 保留，待误报复核（重复） | 与 14/20/32 同源。 |
| 30 | services/vision_models.py:91 | 已加固 | 直接读取 Settings 的模型路径；显式配置优先，local_qwen 可回退部署路径，独立模型保留配置语义。 |
| 31 | services/vision_models.py:105 | 已加固 | Settings unit 只允许空值或实际固定 unit，并在 subprocess 前复核；任意/选项/换行/通配符 unit 均不执行命令。 |
| 32 | services/defect_area.py:25 | 保留，待误报复核（重复） | 与 14/20/29 同源。 |
| 33 | api/reports.py:363 | 已加固 | 直接访问真实 ORM `is_example`；示例写入返回 403，普通结果继续可写；故障恢复测试替身补齐字段。 |
| 34 | tests/test_phase4_routes.py:54 | 保留，待误报复核（重复） | 与 13/22 同源。 |

## 回归及只读部署检查

新增 `backend/tests/test_security_part1.py`；扩展测量输入兼容测试，补齐原有配置/会话测试替身契约。专项回归命令和完整结果见 `audit/security-part1/verification.json` 与同目录日志。

- 整改前全量：563 passed，6 failed，6 skipped。
- 整改后全量：658 passed，6 failed，6 skipped；失败项与整改前完全一致，新增失败为 0。
- 安全专项：179 passed。覆盖非法标识/unit/action、合法控制参数、状态解析、权限、审计、目录链接、资源预算、预检状态、真实事务、QWeather 脱敏、YOLO 回环约束。
- 既有 6 项失败：`test_phase3_project_routes_are_registered`，以及 `test_phase7_routes.py` 中的 `test_trial_generate_endpoint_returns_preview_payload`、`test_trial_generate_endpoint_preserves_legacy_corrosion_label`、`test_trial_generate_endpoint_hides_findings_at_point_six`、`test_trial_generate_endpoint_accepts_uploaded_photo_ids`、`test_trial_generate_endpoint_appends_to_archived_result`。原失败断言及修复前后日志均已归档，未通过修改业务行为或删除断言消除这些失败。
- `compileall` 和 `git diff --check` 通过。生产 Settings 读取校验通过；数据库中 3 个已保存模型 ID 全部合法。`.runtime` 为当前非 root 服务账号所有，权限 0700，无符号链接。
- 本机 systemd 255 上实测 `systemctl --user show --property=ActiveState,SubState,MainPID -- building-photo-guard.service` 成功解析。`--user` 作用于调用账号的用户服务管理器，参见 [systemd 官方 systemctl 文档](https://github.com/systemd/systemd/blob/main/man/systemctl.xml)。生产进程用户为 szcay（uid 1000），未改变其服务账号、权限或正在运行的服务。
- 当前 Docker 仅有 PostgreSQL、Redis、MinIO，发布端口均为宿主回环；9002 是 MinIO 端口。照片预检用户 unit 查询为 activating/auto-restart、MainPID=0，这是观测状态，不是正常启停/模型健康验收。合法 unit 启停使用 mock 回归，没有重启生产模型。
- 一次与全量测试同时运行的专项测试出现原有 `test_local_qwen_lifecycle_reports_unexpected_exit` 时序失败（stopped/error）；该文件未修改，全量及串行专项重跑均通过。保留此记录，避免将单次重跑等同于消除时序问题。

## 后续测评与运行验收

1. 测评方使用原扫描规则复扫，并逐条确认 01—34。f-string、固定字段 `getattr` 及重复项附上本表上下文与测试日志申请人工复核。
2. 在实际启动的 YOLO 版本上保存 `docker inspect` 的 Ports/HostConfig/Networks、`docker ps` 和 `ss` 证据，验证宿主只发布到 127.0.0.1；从另一台可达机器探测其实际随机发布端口。当前会话没有运行中的 YOLO 容器或外部探测节点，因此这部分未完成。
3. 宿主回环发布不能证明同 Docker 网络容器之间隔离。按部署拓扑核验同网络访问，必要时应用专用网络和防火墙；不得将容器内部监听机械改为 127.0.0.1。Docker 组权限仍需由部署方按业务最小权限管理。
4. 根目录和 unit 文件保持仅受信服务账号/管理员可写；代码的路径规范化及链接检查不提供针对同 UID 攻击者替换目录的无竞态保证。当前 0700 权限检查是此边界的部署证据。
5. 正式发布后验收合法 unit 启停和模型健康。已有后台进程未重启，本次源码变更不会自动替换其已加载代码。回填和生产账户加固脚本只做代码复核/编译，未为获取日志而修改真实业务数据。
