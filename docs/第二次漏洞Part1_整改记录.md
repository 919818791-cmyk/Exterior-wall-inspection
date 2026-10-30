# 第二次漏洞 Part 1 整改记录

依据根目录《第二次漏洞part1.docx》，逐条处理其剩余 19 条告警：命令注入 2 条、未受控格式字符串 6 条、绑定所有网络接口 4 条、对象访问违规 6 条、硬编码临时目录 1 条。此次修改了全部报告来源，未添加扫描排除、忽略规则或删减负向测试。首次整改记录中对应的“保留，待误报复核”由本次实现取代。

## 实现与运行影响

### 受管服务控制

`vision_models.py` 保留管理员权限、unit 和动作白名单，并消除动态文本进入命令的路径：

- 状态查询、启动、停止分别使用完整字面量参数数组。可执行文件固定为部署主机上的 `/usr/bin/systemctl`，服务名固定为 `building-photo-guard.service`，动作固定为各分支中的 show/start/stop。
- 输入 unit 只用于授权校验和审计，不进入 subprocess 参数；非法 service/action 仍在运行命令前拒绝。保留 `shell=False`、`--`、超时、返回值检查和错误脱敏。
- 子进程仅得到按操作系统 UID 构造的用户运行目录、用户 D-Bus 地址和 LANG；不再继承 PATH、LD_PRELOAD、SYSTEMD_BUS_ADDRESS 或外部 XDG/DBUS 地址。部署使用标准 `/run/user/<uid>/bus`，自定义用户总线不再支持。
- 在当前部署主机上用实际精简环境执行只读 show 查询成功，服务为 active/running。没有执行生产启停。

### 脚本输出与字段读取

四个数据库脚本中的六处 f-string 改为 `print` 的固定文本和独立数据参数。原有成功/失败文案、计数、换行、数据库操作及异常类型摘要保持一致；未将 `%` 替换成转义文本。使用 SQLite/假会话验证输出，生产回填与账户加固脚本没有被执行。

`defect_area._value()` 改为九个明确测量字段的白名单 reader，每个 reader 直接读取固定属性，未知 key 返回 None。保留 Mapping、具名对象、None/错误类型兼容；真实 ORM 描述符和过期字段的延迟加载仍生效，没有改为读取 `__dict__`。`FakePhotoUploadDb.add()` 已明确检查 Photo 类型，因此直接读取 `item.id`，仍为空 ID 分配 UUID。

### YOLO 监听与旧容器迁移

新增独立启动器 `algorithm-model/serve_version.py`：在加载模型前解析容器 hostname 对应的 IPv4 地址，要求恰好一个地址，拒绝未指定、回环、多播、保留、链路本地及多地址结果。解析失败时停止，不回退到全接口监听。Uvicorn 只绑定这个容器网卡地址，端口仍为 9002；Docker 仍使用宿主 `127.0.0.1` 的随机发布端口，保留原 `_url` 的唯一回环映射检查。Docker 发布端口与容器网卡监听的关系见 [Docker 官方端口发布说明](https://docs.docker.com/engine/network/port-publishing/)。

启动器通过只读 bind mount 加入版本容器，代码改动无需重新构建 GPU 基础镜像。新容器增加 `building-exterior.yolo.binding=container-ip-v1` 标记。已停止的旧容器在下一次启动时按原有 UUID/权重 SHA256 身份检查后删除并重建，保留外部权重缓存；运行中的旧容器显示需迁移提示，要求先停止，再启动，不会在读取状态时重启或删除它。此次没有改动正在运行的生产容器。

负向网络测试通过 `IPv4Address(0)` 生成真实的 IPv4 未指定地址，继续验证拒绝公开映射、IPv6 全接口、非回环和混合映射；没有移除安全断言或用其他安全地址替代攻击输入。绝对路径拒绝测试改用 `/outside`，仍验证绝对路径不可作为模型 ID，也不创建或访问该目录。实际测试文件使用 pytest 临时目录，网络验证使用 `TemporaryDirectory`。

## 逐项记录（按报告类别与原序号）

| 类别 | 序号 | 原报告定位 | 本次处置与证据 |
| --- | ---: | --- | --- |
| 命令注入 | 1 | services/vision_models.py:139 | 查询 argv 全部固定；精简环境；恶意 unit 与环境注入回归；实际只读查询成功。 |
| 命令注入 | 2 | services/vision_models.py:166 | start/stop 分支分别使用固定 argv；权限、非法动作、命令参数与审计回归通过。 |
| 格式字符串 | 1 | db/check_connection.py:11 | 固定文本与值分开输出；SQLite 连接检查输出与原文一致。 |
| 格式字符串 | 2 | db/backfill_photo_projection_pose.py:60 | 照片 ID 与异常类型使用独立 print 参数；模拟失败不泄露凭据或换行。 |
| 格式字符串 | 3 | db/backfill_photo_thumbnails.py:102 | 汇总计数独立输出；正式/试用/失败/报告计数和文案回归通过。 |
| 格式字符串 | 4 | db/backfill_photo_projection_pose.py:62 | 汇总计数独立输出；成功、跳过、无数据、失败四类均有覆盖。 |
| 格式字符串 | 5 | db/harden_production_accounts.py:44 | 独立输出 disabled 计数；假会话验证普通账户加固和管理员保持不变。 |
| 格式字符串 | 6 | db/backfill_photo_thumbnails.py:38 | 固定文本与表名/ID/异常类型分开输出；成功、无缩略图、异常及回滚保持一致。 |
| 全接口绑定 | 1 | services/yolo_runtime.py:177 | 启动器只绑定解析后的单一容器地址；实际 Docker 映射/健康/监听表验证通过；旧容器迁移覆盖。 |
| 全接口绑定 | 2 | tests/test_yolo_runtime.py:135 | 使用 IPv4 未指定地址语义生成测试输入，保留原拒绝断言。 |
| 全接口绑定 | 3 | tests/test_security_part1.py:238 | 保留未指定 IPv4 映射拒绝场景，改用地址类型构造。 |
| 全接口绑定 | 4 | tests/test_security_part1.py:239 | 保留回环与未指定地址混合映射拒绝场景，改用地址类型构造。 |
| 对象访问 | 1 | services/defect_area.py:25 | 明确字段 reader 白名单，Mapping/对象/缺失值/未知 key/过期 ORM 加载回归。 |
| 对象访问 | 2 | tests/test_phase4_routes.py:54 | Photo 类型分支直接 item.id，原照片上传、事件与路由回归通过。 |
| 对象访问 | 3 | tests/test_phase4_routes.py:54 | 同源重复项，与对象访问 2 共用修复及证据。 |
| 对象访问 | 4 | services/defect_area.py:25 | 同源重复项，与对象访问 1 共用修复及证据。 |
| 对象访问 | 5 | tests/test_phase4_routes.py:54 | 同源重复项，与对象访问 2 共用修复及证据。 |
| 对象访问 | 6 | services/defect_area.py:25 | 同源重复项，与对象访问 1 共用修复及证据。 |
| 硬编码临时目录 | 1 | tests/test_security_part1.py:28 | 绝对路径攻击输入改为 `/outside`，不创建任何固定临时目录，保留校验前无文件写入断言。 |

## 验证与证据

- 首轮相关回归 161 项通过；新增第二次复测回归后，专项 180 项通过。
- 全量整改前：693 passed、6 failed、6 skipped；整改后：712 passed、6 failed、6 skipped，失败项与整改前完全一致，没有新增失败。对比见 `audit/security-part1-retest/verification.json`。既有六项失败是一个路由注册断言和五个试用结果断言。
- 源码清单检查覆盖报告全部 19 条，检查固定 argv、精简环境、六处 f-string 移除、报告文件中全接口常量移除、动态属性读取移除和测试临时目录字面量移除；结果通过。这是针对报告的本地检查，不能代替原扫描器正式复扫。
- Python 编译与 `git diff --check` 通过。原工作区的 Part 2、前端及测试素材改动保留，没有修改 CSS。
- 临时容器使用现有模型镜像、真实新启动器和 CPU FastAPI 健康接口替身，不加载 GPU/真实权重。实际监听表显示仅绑定分配的容器 IPv4；宿主回环健康请求成功，宿主四个非回环 IPv4 上的同一发布端口连接被拒绝。测试容器已删除。证据：`network-smoke.json`；它没有验收真实模型推理或独立外部节点访问。
- 当前运行中的旧 YOLO 容器仍使用旧全接口命令，宿主发布为回环 32768 端口。后端源码部署后，管理员需要停止该权重版本，再启动完成重建；无需删除模型记录或重新上传权重。本次不改变其运行状态，也不自动重启生产后端。
- 精简 systemctl 环境实测证据：`systemctl-show.txt`。测试日志：`baseline-pytest.log`、`targeted-pytest.log`、`full-pytest.log`；逐项源代码检查：`findings.json`。

复核命令（项目根目录）：

```bash
python3 audit/security-part1-retest/verify-findings.py
python3 audit/security-part1-retest/network-smoke.py
```

后端专项（backend 目录）：

```bash
PYTHONPATH=. .venv/bin/pytest -q tests/test_security_part1_retest.py tests/test_security_part1.py tests/test_detection_strategies.py tests/test_yolo_runtime.py tests/test_phase4_routes.py tests/test_defect_area.py
```

正式复扫仍由原测评工具确认最终告警数量；不同 Docker 网络、宿主防火墙、容器直连路由和独立外部节点仍按部署拓扑验收。单一容器地址绑定和宿主回环发布不等同于同网络容器之间的隔离。
