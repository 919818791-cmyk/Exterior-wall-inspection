# 和风天气 API 接入准备

本文档记录“检测时段推荐”后续算法所需的和风天气 API 接入信息。当前只实现接口连通测试：生成 JWT、请求实时天气接口、解析天气字段；暂不开发检测时段推荐算法。

## 已登记凭据信息

- 控制台凭据页：https://console.qweather.com/project/36E5G4T7X7/credential/K9GYAW4XH9?lang=zh
- API Host：`jy6k5q5a69.re.qweatherapi.com`
- 开发者 ID：`Q93CE6FB78`
- 项目 ID：`36E5G4T7X7`
- 凭据 ID：`K9GYAW4XH9`
- 公钥 SHA-256：`69e591592867506e834624ee0aa52e71047cd26af22663a449257c4ea8edd85a`
- 本机公钥路径：`/home/szcay/qweather-key/ed25519-public.pem`
- 本机私钥路径：`/home/szcay/qweather-key/ed25519-private.pem`

注意：私钥只保存在服务器本地，不写入 Git、不写入文档内容、不放进前端代码。

## 官方文档依据

- 身份认证：https://dev.qweather.com/docs/configuration/authentication/
- API Host：https://dev.qweather.com/docs/configuration/api-host/
- 实时天气：https://dev.qweather.com/docs/api/weather/weather-now/

和风天气推荐使用 JWT 认证。JWT Header 使用 `alg=EdDSA` 和 `kid=凭据ID`；Payload 使用 `sub=项目ID`、`iat` 和 `exp`。请求时通过 `Authorization: Bearer <token>` 传递。

和风天气要求使用控制台里的专属 API Host，例如 `abc1234xyz.def.qweatherapi.com`。不要把 `api.qweather.com`、`devapi.qweather.com` 或 `geoapi.qweather.com` 作为新接入默认值。

## 环境变量

后端通过 `.env` 或进程环境变量读取配置：

```bash
QWEATHER_API_HOST=jy6k5q5a69.re.qweatherapi.com
QWEATHER_DEVELOPER_ID=Q93CE6FB78
QWEATHER_PROJECT_ID=36E5G4T7X7
QWEATHER_CREDENTIAL_ID=K9GYAW4XH9
QWEATHER_PUBLIC_KEY_PATH=/home/szcay/qweather-key/ed25519-public.pem
QWEATHER_PUBLIC_KEY_SHA256=69e591592867506e834624ee0aa52e71047cd26af22663a449257c4ea8edd85a
QWEATHER_PRIVATE_KEY_PATH=/home/szcay/qweather-key/ed25519-private.pem
QWEATHER_TEST_LOCATION=116.41,39.92
QWEATHER_LANGUAGE=zh
QWEATHER_JWT_TTL_SECONDS=900
QWEATHER_REQUEST_TIMEOUT_SECONDS=10
```

`QWEATHER_TEST_LOCATION` 可以填和风天气 LocationID，也可以填经纬度，格式为 `lon,lat`，例如 `116.41,39.92`。

## 连通测试命令

先安装后端依赖：

```bash
cd backend
./.venv/bin/python -m pip install -r requirements.txt
```

执行默认位置的实时天气连通测试：

```bash
cd backend
./.venv/bin/python scripts/qweather_connectivity_test.py
```

指定测试位置：

```bash
cd backend
./.venv/bin/python scripts/qweather_connectivity_test.py --location 114.06,22.54
```

输出为已解析字段，示例结构如下：

```json
{
  "code": "200",
  "location": "116.41,39.92",
  "update_time": "2020-06-30T22:00:00+08:00",
  "obs_time": "2020-06-30T21:40:00+08:00",
  "weather_text": "多云",
  "temperature_c": 24.0,
  "feels_like_c": 26.0,
  "wind_dir": "东南风",
  "wind360": 123,
  "wind_scale": "1",
  "wind_speed_kmh": 3.0,
  "humidity_percent": 72.0,
  "precip_mm": 0.0,
  "pressure_hpa": 1003.0,
  "visibility_km": 16.0,
  "cloud_percent": 10.0,
  "dew_c": 21.0,
  "fx_link": "https://www.qweather.com/weather/beijing-101010100.html"
}
```

## 最近一次连通结果

验证时间：`2026-07-06 16:19 Asia/Shanghai`

测试命令：

```bash
cd backend
./.venv/bin/python scripts/qweather_connectivity_test.py
```

测试位置：`116.41,39.92`

返回结果：

```json
{
  "code": "200",
  "location": "116.41,39.92",
  "update_time": "2026-07-06T16:19:00+08:00",
  "obs_time": "2026-07-06T16:14:00+08:00",
  "weather_text": "多云",
  "temperature_c": 32.0,
  "feels_like_c": 33.0,
  "wind_dir": "西南风",
  "wind360": 225,
  "wind_scale": "3",
  "wind_speed_kmh": 12.0,
  "humidity_percent": 49.0,
  "precip_mm": 0.0,
  "pressure_hpa": 993.0,
  "visibility_km": 30.0,
  "cloud_percent": 91.0,
  "dew_c": 20.0,
  "fx_link": "https://www.qweather.com/weather/dongcheng-101011600.html"
}
```

## 当前实现范围

- `backend/app/services/qweather.py`：生成 Ed25519 JWT、校验本地公钥 SHA-256、请求 `/v7/weather/now`、解析实时天气字段。
- `backend/scripts/qweather_connectivity_test.py`：手工连通测试入口。
- `backend/tests/test_qweather.py`：覆盖 JWT Header/Payload、字段解析、请求 URL 和 Bearer Token。
- `frontend/src/pages/CapabilityDetailPage.tsx`：检测时段推荐弹窗复用高德地图点选坐标，输出 `longitude,latitude` 作为后续天气查询输入。

当前不写入数据库，不保存推荐结果，不实现检测时段评分、光照、立面朝向或作业窗口推荐逻辑。
