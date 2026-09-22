# 和风天气 API 接入准备

本文档记录“检测时段推荐”所需的和风天气 API 接入信息。客户端同时支持 API Key 和 Ed25519/JWT，优先使用 API Key；暂不开发检测时段推荐算法。

## 已登记凭据信息

- API Host：`jy6k5q5a69.re.qweatherapi.com`
- 项目 ID：`3CTM8V69NN`
- 鉴权方式：API Key（密钥只保存于本机 `.env.local`）

注意：API Key 或 JWT 私钥只保存在服务器本地，不写入 Git、不写入文档内容、不放进前端代码。

## 官方文档依据

- 身份认证：https://dev.qweather.com/docs/configuration/authentication/
- API Host：https://dev.qweather.com/docs/configuration/api-host/
- 实时天气：https://dev.qweather.com/docs/api/weather/weather-now/

API Key 模式通过 `X-QW-Api-Key` 请求头传递。代码在 `QWEATHER_API_KEY` 非空时使用 API Key；留空时才回退到 Ed25519/JWT。不要同时发送两种鉴权信息。

和风天气要求使用控制台里的专属 API Host，例如 `abc1234xyz.def.qweatherapi.com`。不要把 `api.qweather.com`、`devapi.qweather.com` 或 `geoapi.qweather.com` 作为新接入默认值。

## 环境变量

后端通过 `.env.local`、`.env` 或进程环境变量读取配置，生产密钥优先放在已忽略提交的 `.env.local`：

```bash
QWEATHER_API_HOST=jy6k5q5a69.re.qweatherapi.com
QWEATHER_API_KEY=替换为实际API-Key
QWEATHER_PROJECT_ID=3CTM8V69NN
QWEATHER_TEST_LOCATION=116.41,39.92
QWEATHER_LANGUAGE=zh
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

验证时间：`2026-08-01 01:53 Asia/Shanghai`

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
  "update_time": "2026-08-01T01:53:00+08:00",
  "obs_time": "2026-08-01T01:51:00+08:00",
  "weather_text": "小雨",
  "temperature_c": 26.0,
  "feels_like_c": 29.0,
  "wind_dir": "西南风",
  "wind360": 225,
  "wind_scale": "2",
  "wind_speed_kmh": 9.0,
  "humidity_percent": 95.0,
  "precip_mm": 0.0,
  "pressure_hpa": 996.0,
  "visibility_km": 15.0,
  "cloud_percent": 91.0,
  "dew_c": 26.0,
  "fx_link": "https://www.qweather.com/weather/dongcheng-101011600.html"
}
```

## 当前实现范围

- `backend/app/services/qweather.py`：支持 API Key 与 Ed25519/JWT、请求实时/逐日/逐小时天气接口并解析字段。
- `backend/scripts/qweather_connectivity_test.py`：手工连通测试入口。
- `backend/tests/test_qweather.py`：覆盖 API Key 请求头、JWT Header/Payload、字段解析和请求 URL。
- `frontend/src/pages/CapabilityDetailPage.tsx`：检测时段推荐弹窗复用高德地图点选坐标，输出 `longitude,latitude` 作为后续天气查询输入。

当前不写入数据库，不保存推荐结果，不实现检测时段评分、光照、立面朝向或作业窗口推荐逻辑。
