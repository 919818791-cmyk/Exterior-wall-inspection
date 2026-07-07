import { apiRequest } from "@/api/client";

export type WeatherForecastDays = "3d" | "7d" | "10d" | "15d" | "30d";
export type WeatherForecastHours = "24h" | "72h" | "168h";

export interface QWeatherRefer {
  sources: string[];
  license: string[];
}

export interface QWeatherNowObservation {
  obs_time: string;
  temp_c: number;
  feels_like_c: number | null;
  icon: string | null;
  text: string | null;
  wind360: number | null;
  wind_dir: string | null;
  wind_scale: string | null;
  wind_speed_kmh: number | null;
  humidity_percent: number | null;
  precip_mm: number | null;
  pressure_hpa: number | null;
  visibility_km: number | null;
  cloud_percent: number | null;
  dew_c: number | null;
}

export interface QWeatherNowResponse {
  code: string;
  update_time: string;
  fx_link: string | null;
  now: QWeatherNowObservation;
  refer: QWeatherRefer | null;
}

export interface QWeatherDailyForecast {
  fx_date: string;
  sunrise: string | null;
  sunset: string | null;
  moonrise: string | null;
  moonset: string | null;
  moon_phase: string | null;
  moon_phase_icon: string | null;
  temp_max_c: number;
  temp_min_c: number;
  icon_day: string | null;
  text_day: string | null;
  icon_night: string | null;
  text_night: string | null;
  wind360_day: number | null;
  wind_dir_day: string | null;
  wind_scale_day: string | null;
  wind_speed_day_kmh: number | null;
  wind360_night: number | null;
  wind_dir_night: string | null;
  wind_scale_night: string | null;
  wind_speed_night_kmh: number | null;
  humidity_percent: number | null;
  precip_mm: number | null;
  pressure_hpa: number | null;
  visibility_km: number | null;
  cloud_percent: number | null;
  uv_index: number | null;
}

export interface QWeatherDailyForecastResponse {
  code: string;
  update_time: string;
  fx_link: string | null;
  daily: QWeatherDailyForecast[];
  refer: QWeatherRefer | null;
}

export interface QWeatherHourlyForecast {
  fx_time: string;
  temp_c: number;
  icon: string | null;
  text: string | null;
  wind360: number | null;
  wind_dir: string | null;
  wind_scale: string | null;
  wind_speed_kmh: number | null;
  humidity_percent: number | null;
  pop_percent: number | null;
  precip_mm: number | null;
  pressure_hpa: number | null;
  cloud_percent: number | null;
  dew_c: number | null;
  uv_index: number | null;
}

export interface QWeatherHourlyForecastResponse {
  code: string;
  update_time: string;
  fx_link: string | null;
  hourly: QWeatherHourlyForecast[];
  refer: QWeatherRefer | null;
}

export function getWeatherNow(location: string, lang?: string) {
  return apiRequest<QWeatherNowResponse>(`/weather/now?${weatherParams({ location, lang })}`);
}

export function getWeatherDaily(location: string, days: WeatherForecastDays = "7d", lang?: string) {
  return apiRequest<QWeatherDailyForecastResponse>(
    `/weather/daily?${weatherParams({ location, lang, days })}`
  );
}

export function getWeatherHourly(location: string, hours: WeatherForecastHours = "24h", lang?: string) {
  return apiRequest<QWeatherHourlyForecastResponse>(
    `/weather/hourly?${weatherParams({ location, lang, hours })}`
  );
}

function weatherParams(values: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}
