# YOLO .pt 权重反序列化漏洞修复

测评路径为管理员创建模型、上传含恶意 pickle `reduce` 的 `.pt`，再启动该版本的 Docker runtime。原上传仅校验扩展名、大小、SHA256，runtime 直接调用 `YOLO(path)`；文件哈希与数据库一致不能证明内容安全。

## 修复后的行为

- `POST /api/yolo-models` 仍只创建模型元数据，不加载权重，继续要求管理员权限。
- `POST /api/yolo-models/{model_id}/versions` 在写入 MinIO 和版本记录之前进行静态检查。后端不引入 PyTorch，也不调用 pickle 反序列化。非法格式、危险函数、不支持的类型或指令返回 422。
- `POST /api/yolo-models/{model_id}/versions/{version_id}/runtime/start` 对历史下载和命中缓存的权重都重新检查，大小与 SHA256 一致的恶意文件仍返回 422，不执行 Docker 启动操作。
- runtime 对同一文件流进行 SHA256、格式检查及显式 `torch.load(map_location="cpu", weights_only=True)`。仅授权代码中列举的检测网络类型；排除环境里额外注册的 pickle 类型。失败时终止启动，不回退到 `weights_only=False`，不按报错自动添加白名单或安装依赖。
- 对 pickle 栈和 memo 进行符号检查，只允许张量重建、`OrderedDict`、`set`、`torch.Size` 等固定构造调用。检测模型和网络层只允许空参数 `NEWOBJ` 分配，禁止通过 `REDUCE` 执行模型类构造函数，避免把上传的 YAML/activation 配置交给构造器执行。
- 通过覆盖 YOLO 的 `_load` 接入已受限加载的检测对象，不再把上传路径交给 Ultralytics 的普通加载器，也不使用上传的 `train_args` 配置预测器。
- 创建容器时挂载共享加载模块，标记 `building-exterior.yolo.weight-policy=restricted-pickle-v1`，设置 `TORCH_FORCE_WEIGHTS_ONLY_LOAD=1` 并禁用新增权限。无策略标记的旧运行容器不再被报告为可用，也不会被直接复用；停止后再次启动会重建。

安全边界集中在 `backend/app/services/yolo_weights.py`，由 API/runtime 共用。Docker 镜像安装和运行时检查均要求 PyTorch >= 2.10.0，覆盖官方公告 [CVE-2025-32434](https://github.com/pytorch/pytorch/security/advisories/GHSA-53q9-r3pm-6pq6) 与 [CVE-2026-24747](https://github.com/pytorch/pytorch/security/advisories/GHSA-63cw-57p8-fm3p) 中涉及受限加载器的已知漏洞。

## 兼容范围

支持使用标准 `torch.save(..., pickle_protocol=2)` 保存的 ZIP 格式 Ultralytics 检测模型 checkpoint，包含白名单中的 `DetectionModel` 及网络层。已验证当前部署的约 137 MB 检测权重和新建 YOLO11 检测模型可以加载并完成 CPU 推理。

不接受旧式 raw pickle/tar、TorchScript、压缩 ZIP、自定义 Python 模型类、额外脚本、其他 pickle 协议、分类/分割等未支持任务。pickle 元数据上限 16 MiB，归档条目上限 20,000。需要新增网络层时，在代码中审核并显式扩展类型列表；不能为兼容任意上传文件取消受限加载。已有权重不自动转换，也不在后端执行不安全的加载或导出。

## 验证

后端回归在 `backend` 目录执行：

```bash
.venv/bin/python -m pytest tests/test_yolo_models.py tests/test_yolo_runtime.py tests/test_yolo_class_selection.py tests/test_yolo_weight_security.py tests/test_security_part1_retest.py tests/test_detection_strategies.py -q
```

模型镜像中的真实 PyTorch 测试在项目根目录执行：

```bash
docker run --rm --network none --read-only --tmpfs /tmp \
  --mount "type=bind,src=$PWD/backend/app/services/yolo_weights.py,dst=/model/yolo_weights.py,readonly" \
  --mount "type=bind,src=$PWD/algorithm-model/tests,dst=/tests,readonly" \
  -e OMP_NUM_THREADS=2 -e MPLCONFIGDIR=/tmp/matplotlib \
  -e TORCH_FORCE_WEIGHTS_ONLY_LOAD=1 \
  building-exterior-algorithm-model:cuda \
  python -m unittest discover -s /tests -v
```

覆盖恶意 `reduce` 无文件写入副作用、上传拒绝且无文件/记录残留、历史缓存与下载拒绝、旧容器策略迁移、固定类型构造绕过、校验失败、旧 PyTorch 拒绝、合法模型推理，以及绕过预检查时受限加载器仍阻断 `exec`、不进行不安全重试。

## 部署生效

代码修改与隔离测试不等同于线上部署。发布时更新后端和共享加载模块；若当前运行镜像 PyTorch 低于 2.10.0，先使用更新后的 Dockerfile 重建 `YOLO_RUNTIME_IMAGE` 指定的镜像。重启后端以启用上传与启动检查，在模型管理中先停止旧的版本容器，再启动所需正常版本以重建。恶意历史版本会拒绝启动，可通过原删除接口清理；修复不自动删除已有模型或文件，也不自动停止线上容器。
