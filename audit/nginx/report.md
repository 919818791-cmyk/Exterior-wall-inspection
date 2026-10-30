# Nginx 检查与修复记录

检查日期：2026-10-10。范围：当前服务器启用的全部 Nginx 配置、应用代理路由、上传、对象下载、PDF 导出、地图代理、前端页面、启动检查和日志轮转。线上验证数据见 [verification.json](verification.json)。

## 升级与故障的关系

`/var/log/dpkg.log` 显示当天 11:10:39 从 `1.24.0-2ubuntu7.18` 升级至 `1.30.5-1~noble`，11:10:43 回退，11:11:05 再次升级。三次均保留原 `/etc/nginx/nginx.conf`。目前安装的是 1.30.5。

新包的编译默认目录为 `/var/cache/nginx/client_temp`、`proxy_temp` 等，默认 worker 用户为 `nginx`；保留的主配置实际使用 `www-data`。`/var/cache/nginx` 为 `root:root`、权限 750，`www-data` 无法进入。日志有请求体和上游响应临时文件的 `Permission denied`，包括检测策略 PUT、照片上传和大原图 GET。升级时保留旧用户配置，同时采用新包的目录默认值，是这些错误的直接原因。

目录可以在编译时决定，也可以在 `nginx.conf` 显式指定，见 [Nginx 官方编译参数说明](https://nginx.org/en/docs/configure.html)。现已显式配置全部五类 HTTP 临时目录，避免依赖安装包默认值。

413 属于独立的上传容量配置问题：站点通用上限为 105 MiB，而 PT 和 GLB 后端允许 1 GiB。此前调整模型上传时引入的斜杠重定向循环已修正，不归因于版本升级。日志中的一次连接拒绝发生于后端重启期间；后端不可用时的 502 需要恢复后端服务。

## 已生效的修复

| 项目 | 当前配置与结果 |
| --- | --- |
| 通用临时目录 | 请求体、proxy、FastCGI、uWSGI、SCGI 显式使用 `/var/lib/nginx` 下的五个目录，`www-data` 所有，权限 700；保留 PT 专用目录 |
| PT 上传 | 权重文件上限 1 GiB，额外 1 MiB 表单余量；只匹配版本上传路由，列表不发生斜杠循环 |
| 建筑模型与建筑图片 | 为 `building-model` 和 `building-model-images` 增加专用上传 location；GLB 单文件 1 GiB，建筑图片批次整次请求 1 GiB，额外 1 MiB 表单余量 |
| 普通照片与试用 | 普通接口继续沿用站点 105 MiB；普通照片后端仍限制单张 20 MiB；试用检测及归档使用照片 ID 和 JSON |
| 等待时间 | API 原有 900 秒响应等待保留，明确 HTTP 1.1，并设置 300 秒请求体停顿等待；PT 专用响应等待仍为 300 秒 |
| 重复安装 | 应用与 PT 配置脚本可分别重复执行，且能共存；修改已有权威指令，不叠加互相覆盖的同级配置 |
| 启动检查 | `start.sh` 在重启后端之前运行 `deploy/check-nginx.py`，除语法外，以 worker 用户核对 HTTP 通用及专用临时目录、所有站点静态文件的权限 |

修改站点前均备份，并执行 `nginx -t` 后平滑重载。最新站点备份为 `/etc/nginx/sites-available/building-exterior.bak-app-20261010-164516-166401`；通用目录修复备份为 `/etc/nginx/nginx.conf.bak-temp-paths-20261010-163247-413026`。备份不在 `sites-enabled` 中，不会作为重复站点加载。

## 验证结果

- Nginx 配置检查和 worker 权限检查通过；全部启用的站点已核对，当前只有应用站点，没有动态模块加载冲突。Nginx 与后端服务均 active、enabled。
- 17 项部署回归测试通过，使用实际隔离 Nginx：约 130 MiB PT、110 MiB GLB、图片批次可转发；超过专用上限及普通接口上限仍返回 413；配置可重复执行；JSON 错误、延迟响应、4 MiB 缓冲下载和流式首字节正常。
- 线上 API：健康检查、登录用户、PT 模型目录、视觉模型、检测策略、项目、报告均返回 200；不存在的 API 返回 JSON 404。
- 检测策略使用原 21 项配置执行保存，约 30 KB 请求返回 200，再读取与保存前完全一致。
- 原图 12,749,273 字节完整下载与直连后端 SHA-256 一致；Range 返回 206、正确 Content-Range 和内容；过期签名返回 403。
- 线上 PDF 导出返回 200，1,177,444 字节，具有 PDF 文件头、正确附件响应头。
- 线上建筑模型和建筑图片各发送 110 MiB 完整 multipart 请求：均到达后端并返回预期 JSON 401。请求故意不带登录信息，不创建或覆盖用户模型；这是代理转发及临时落盘验证。
- 浏览器以真实临时诊断会话访问 9 个主要页面，均返回 200；无同源失败请求、HTTP 错误或页面执行错误。诊断令牌已撤销。
- 浏览器在线地图实际渲染成功，`/_AMapService/v3/geocode/geo` 地址查询返回 HTTP 200、业务状态 1、OK。IP REST API 使用 JS 地图 key 会因平台类型不匹配而拒绝，已改用实际地图业务接口核验。
- 日志轮转 debug 检查通过。新包创建日志时的 `nginx` 用户不会构成已确认故障：现有 postrotate 发送 USR1，master 会按实际 worker 用户重新打开并设置日志所有者；目前日志实际为 `www-data:adm`。这一行为见 [Nginx 官方日志轮转说明](https://nginx.org/en/docs/control.html)。本次未强制轮转生产日志。
- 磁盘剩余约 794 GiB、文件描述符限额 524288，未发现存储或连接资源不足。修复通用目录后至本次验证结束，没有新的 Nginx 错误日志。
- BEST V1 运行健康，`ready=true`、`device=cuda:0`；本次 Nginx 修改没有重启模型或后端。

对象下载的 `X-Accel-Buffering: no` 可使 Nginx 及时转发流式响应，验证已通过，行为见 [Nginx 官方代理说明](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)。

## 范围与复查

当前仅监听 HTTP 80；没有启用 HTTPS 站点，因此不声称验证了证书续期或 HTTPS 流量。没有 WebSocket/SSE 路由需要额外代理。未运行真实耗时检测任务或覆盖用户模型来验证代理。

已修复确认存在的 Nginx 问题并检查当前应用入口。后端宕机、模型不可用、业务校验、签名过期、实际超过上传上限等仍可能返回预期或业务错误，不能通过扩大 Nginx 配置消除。更换安装源、版本或 worker 用户后，运行 `sudo python3 deploy/check-nginx.py` 复查；需要重建配置时使用 README 中三项带备份和回退的部署脚本。
