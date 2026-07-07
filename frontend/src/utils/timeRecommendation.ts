import type {
  QWeatherDailyForecast,
  QWeatherHourlyForecast,
  WeatherForecastDays,
  WeatherForecastHours
} from "@/api/weather";

const RC = {
  ellA: 27.471761995496227,
  d0: 2.216881365958858,
  uVoid: 6.674918299200928,
  uRef: 7.511840256623864,
  cVoid: 0.06648717359637858,
  cRef: 34.76807439010163,
  alphaG: 0.5703483059930676,
  alphaT: 1.8202491112099013,
  bias: 0.33239489574928477
};

export interface RecommendationWindow {
  start: number;
  end: number;
  duration: number;
  extremumTime: number;
  extremum: number;
  qualifies: boolean;
  label: string;
}

export interface TimeRecommendationResult {
  status: "高置信度双窗口" | "单窗口可检测" | "短窗口，建议复测" | "当前条件不推荐检测";
  headline: string;
  reason: string;
  primaryWindow: RecommendationWindow | null;
  positiveWindow: RecommendationWindow | null;
  negativeWindow: RecommendationWindow | null;
  peakRadiationWm2: number;
  peakRadiationTime: string;
  maxPositiveDeltaC: number;
  minNegativeDeltaC: number;
  weatherSummary: string;
  weatherSource: string;
  modelWarnings: string[];
}

export interface CalculateRecommendationOptions {
  date: string;
  latitude: number;
  longitude: number;
  orientationName: string;
  azimuth: number;
  daily: QWeatherDailyForecast[];
  hourly: QWeatherHourlyForecast[];
  now?: Date;
}

interface ModelInputs {
  date: Date;
  lat: number;
  lon: number;
  elevation: number;
  tz: number;
  azimuth: number;
  tilt: number;
  defectSize: number;
  dk: number;
  h: number;
  threshold: number;
  minimumDuration: number;
  rh: number;
  turbidity: number;
  albedo: number;
  tmean: number;
  tempAmplitude: number;
  tempPeakHour: number;
  radiationScale: number;
}

interface SolarPoint {
  time: number;
  elevation: number;
  azimuth: number;
  ghi: number;
  gwall: number;
}

export function forecastDaysForDate(dateText: string, now = new Date()): WeatherForecastDays | null {
  const daysAhead = calendarDaysAhead(dateText, now);
  if (daysAhead === null || daysAhead < 0) return null;
  if (daysAhead <= 2) return "3d";
  if (daysAhead <= 6) return "7d";
  if (daysAhead <= 9) return "10d";
  if (daysAhead <= 14) return "15d";
  if (daysAhead <= 29) return "30d";
  return null;
}

export function forecastHoursForDate(dateText: string, now = new Date()): WeatherForecastHours | null {
  const daysAhead = calendarDaysAhead(dateText, now);
  if (daysAhead === null || daysAhead < 0) return null;
  if (daysAhead === 0) return "24h";
  if (daysAhead <= 2) return "72h";
  if (daysAhead <= 6) return "168h";
  return null;
}

export function calculateTimeRecommendation(options: CalculateRecommendationOptions): TimeRecommendationResult {
  const targetDate = parseDateOnly(options.date);
  if (!targetDate) throw new Error("请选择有效日期。");

  const weather = deriveWeatherModel(options.date, options.daily, options.hourly);
  const inputs: ModelInputs = {
    date: targetDate,
    lat: options.latitude,
    lon: options.longitude,
    elevation: 30,
    tz: 8,
    azimuth: options.azimuth,
    tilt: 90,
    defectSize: 7.5,
    dk: 6,
    h: weather.convection,
    threshold: 1.2,
    minimumDuration: 1,
    rh: weather.humidity,
    turbidity: 1,
    albedo: 0.2,
    tmean: weather.tmean,
    tempAmplitude: weather.tempAmplitude,
    tempPeakHour: weather.tempPeakHour,
    radiationScale: weather.radiationScale
  };

  validateInputs(inputs);

  const step = 1 / 6;
  const times = Array.from({ length: 145 }, (_, index) => index * step);
  const solar = calculateClearSky(inputs, times);
  const air = times.map(
    time => inputs.tmean + inputs.tempAmplitude * Math.cos(2 * Math.PI * (time - inputs.tempPeakHour) / 24)
  );
  const deltaT = calculateDeltaT(inputs, times, solar, air);
  const minimumStartHour = minimumRecommendationHour(options.date, options.now ?? new Date());
  const positiveWindows = findWindows(times, deltaT, inputs.threshold, inputs.minimumDuration, true, minimumStartHour);
  const negativeWindows = findWindows(times, deltaT, inputs.threshold, inputs.minimumDuration, false, minimumStartHour);
  const positive = bestWindow(positiveWindows);
  const negative = bestWindow(negativeWindows);
  const status = classification(positive, negative, positiveWindows.length > 0 || negativeWindows.length > 0);
  const active = times.map((time, index) => ({ time, value: deltaT[index] })).filter(point => point.time >= minimumStartHour);
  const peakRadiation = solar.reduce((best, item) => (item.gwall > best.gwall ? item : best));
  const positivePeak = active.reduce((best, item) => (item.value > best.value ? item : best));
  const negativeValley = active.reduce((best, item) => (item.value < best.value ? item : best));
  const primaryWindow = pickPrimaryWindow(positive, negative);
  const weatherSummary = [
    `${weather.tmean.toFixed(1)} ℃`,
    `湿度 ${weather.humidity.toFixed(0)}%`,
    `云量 ${weather.cloud.toFixed(0)}%`,
    `风速 ${weather.windSpeedKmh.toFixed(1)} km/h`
  ].join(" · ");

  return {
    status,
    headline: headlineFor(status, options.orientationName),
    reason: reasonFor(status, positive, negative, weather.source),
    primaryWindow,
    positiveWindow: positive ? withLabel(positive) : null,
    negativeWindow: negative ? withLabel(negative) : null,
    peakRadiationWm2: peakRadiation.gwall,
    peakRadiationTime: hourText(peakRadiation.time),
    maxPositiveDeltaC: positivePeak.value,
    minNegativeDeltaC: negativeValley.value,
    weatherSummary,
    weatherSource: weather.source,
    modelWarnings: modelWarnings(inputs, weather)
  };
}

function deriveWeatherModel(
  dateText: string,
  daily: QWeatherDailyForecast[],
  hourly: QWeatherHourlyForecast[]
) {
  const day = daily.find(item => item.fx_date === dateText) ?? null;
  const dayHourly = hourly.filter(item => localDateFromIso(item.fx_time) === dateText);
  if (!day && dayHourly.length === 0) {
    throw new Error("未取得目标日期的天气预报数据。");
  }

  const hourlyTemps = values(dayHourly.map(item => item.temp_c));
  const hourlyHumidity = values(dayHourly.map(item => item.humidity_percent));
  const hourlyCloud = values(dayHourly.map(item => item.cloud_percent));
  const hourlyWind = values(dayHourly.map(item => item.wind_speed_kmh));
  const hourlyPrecip = values(dayHourly.map(item => item.precip_mm));
  const hasFullHourlyTemperature = hourlyTemps.length >= 18;
  const tempMax = hasFullHourlyTemperature ? Math.max(...hourlyTemps) : day?.temp_max_c ?? Math.max(...hourlyTemps);
  const tempMin = hasFullHourlyTemperature ? Math.min(...hourlyTemps) : day?.temp_min_c ?? Math.min(...hourlyTemps);
  const peakHour = peakHourFromHourly(dayHourly) ?? 14;
  const humidity = average(hourlyHumidity) ?? day?.humidity_percent ?? 60;
  const cloud = clamp(average(hourlyCloud) ?? day?.cloud_percent ?? 0, 0, 100);
  const windSpeedKmh = average(hourlyWind) ?? average(values([day?.wind_speed_day_kmh, day?.wind_speed_night_kmh])) ?? 0;
  const precip = hourlyPrecip.length ? sum(hourlyPrecip) : day?.precip_mm ?? 0;
  const radiationScale = clamp(1 - cloud * 0.0065 - Math.min(precip, 10) * 0.03, 0.25, 1);
  const windSpeedMps = windSpeedKmh / 3.6;
  const convection = clamp(5 + windSpeedMps * 2.2, 1, 17);

  return {
    tmean: (tempMax + tempMin) / 2,
    tempAmplitude: Math.max(0, (tempMax - tempMin) / 2),
    tempPeakHour: peakHour,
    humidity,
    cloud,
    windSpeedKmh,
    precip,
    radiationScale,
    convection,
    source: hasFullHourlyTemperature ? "逐小时预报" : "逐日预报估算"
  };
}

function calculateClearSky(inputs: ModelInputs, times: number[]): SolarPoint[] {
  const n = dayOfYear(inputs.date);
  const pressure = atmosphericPressure(inputs.elevation);
  const ea = inputs.rh / 100 * saturationVaporPressure(inputs.tmean);
  const precipitableWater = 0.14 * ea * pressure + 2.1;
  const dr = 1 + 0.033 * Math.cos(2 * Math.PI * n / 365);
  const extraterrestrialNormal = 0.0820 * 1000000 / 60 * dr;
  const wallAzimuth = rad(inputs.azimuth);
  const wallTilt = rad(inputs.tilt);
  const normalEast = Math.sin(wallTilt) * Math.sin(wallAzimuth);
  const normalNorth = Math.sin(wallTilt) * Math.cos(wallAzimuth);
  const normalUp = Math.cos(wallTilt);
  const skyView = (1 + Math.cos(wallTilt)) / 2;
  const groundView = (1 - Math.cos(wallTilt)) / 2;

  return times.map(time => {
    const solar = solarGeometry(n, time, inputs.lat, inputs.lon, inputs.tz);
    const sinBeta = Math.sin(solar.elevation);
    if (sinBeta <= 0) {
      return { time, elevation: deg(solar.elevation), azimuth: deg(solar.azimuth), ghi: 0, gwall: 0 };
    }
    const kb = clamp(
      0.98 * Math.exp(
        -0.00146 * pressure / (inputs.turbidity * sinBeta)
        -0.075 * Math.pow(precipitableWater / sinBeta, 0.4)
      ),
      0,
      1
    );
    const kd = clamp(kb >= 0.15 ? 0.35 - 0.36 * kb : 0.18 + 0.82 * kb, 0, 1);
    const dni = kb * extraterrestrialNormal;
    const dhi = kd * extraterrestrialNormal * sinBeta;
    const ghi = dni * sinBeta + dhi;
    const sunEast = Math.cos(solar.elevation) * Math.sin(solar.azimuth);
    const sunNorth = Math.cos(solar.elevation) * Math.cos(solar.azimuth);
    const sunUp = Math.sin(solar.elevation);
    const cosIncidence = Math.max(0, sunEast * normalEast + sunNorth * normalNorth + sunUp * normalUp);
    const directWall = dni * cosIncidence;
    const diffuseWall = dhi * skyView;
    const groundWall = ghi * inputs.albedo * groundView;
    return {
      time,
      elevation: deg(solar.elevation),
      azimuth: deg(solar.azimuth),
      ghi: ghi * inputs.radiationScale,
      gwall: (directWall + diffuseWall + groundWall) * inputs.radiationScale
    };
  });
}

function solarGeometry(n: number, hour: number, latitudeDeg: number, longitudeDeg: number, timezone: number) {
  const phi = rad(latitudeDeg);
  const gamma = 2 * Math.PI / 365 * (n - 1 + (hour - 12) / 24);
  const equationOfTime = 229.18 * (
    0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma)
  );
  const declination =
    0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const standardMeridian = 15 * timezone;
  const solarTime = hour + (equationOfTime + 4 * (longitudeDeg - standardMeridian)) / 60;
  const hourAngle = rad(15 * (solarTime - 12));
  const east = -Math.cos(declination) * Math.sin(hourAngle);
  const north = Math.cos(phi) * Math.sin(declination)
    - Math.sin(phi) * Math.cos(declination) * Math.cos(hourAngle);
  const up = clamp(
    Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle),
    -1,
    1
  );
  const elevation = Math.asin(up);
  const azimuth = (Math.atan2(east, north) + 2 * Math.PI) % (2 * Math.PI);
  return { elevation, azimuth };
}

function calculateDeltaT(inputs: ModelInputs, times: number[], solar: SolarPoint[], airTemperature: number[]) {
  const geometry = inputs.defectSize / (inputs.defectSize + RC.ellA) * inputs.dk / (inputs.dk + RC.d0);
  const tauVoid = RC.cVoid / (inputs.h + RC.uVoid);
  const tauRef = RC.cRef / (inputs.h + RC.uRef);
  const gwall = solar.map(point => point.gwall);
  const gv = lowpass(times, gwall, tauVoid);
  const gr = lowpass(times, gwall, tauRef);
  const airMean = average(airTemperature) ?? 0;
  const centeredAir = airTemperature.map(value => value - airMean);
  const tv = lowpass(times, centeredAir, tauVoid);
  const tr = lowpass(times, centeredAir, tauRef);
  return times.map((_, index) => geometry * (
    RC.alphaG * (gv[index] / (inputs.h + RC.uVoid) - gr[index] / (inputs.h + RC.uRef))
    + RC.alphaT * inputs.h * (tv[index] / (inputs.h + RC.uVoid) - tr[index] / (inputs.h + RC.uRef))
    + RC.bias
  ));
}

function lowpass(times: number[], values: number[], tau: number) {
  const result = new Array<number>(values.length).fill(0);
  if (tau <= 1e-9) return values.slice();
  for (let index = 1; index < values.length; index += 1) {
    const dt = times[index] - times[index - 1];
    const decay = Math.exp(-dt / tau);
    const midpoint = (values[index] + values[index - 1]) / 2;
    result[index] = decay * result[index - 1] + (1 - decay) * midpoint;
  }
  return result;
}

function findWindows(
  times: number[],
  valuesList: number[],
  threshold: number,
  minimumDuration: number,
  positive: boolean,
  minimumStartHour: number
) {
  const selected: number[] = [];
  for (let index = 0; index < times.length; index += 1) {
    const passes = positive ? valuesList[index] >= threshold : valuesList[index] <= -threshold;
    if (times[index] >= minimumStartHour && passes) selected.push(index);
  }
  if (!selected.length) return [];

  const groups: number[][] = [];
  let current = [selected[0]];
  for (let index = 1; index < selected.length; index += 1) {
    if (selected[index] === selected[index - 1] + 1) current.push(selected[index]);
    else {
      groups.push(current);
      current = [selected[index]];
    }
  }
  groups.push(current);
  const step = times[1] - times[0];
  return groups.map(group => {
    const end = Math.min(24, times[group[group.length - 1]] + step);
    let extremeIndex = group[0];
    group.forEach(index => {
      if ((positive && valuesList[index] > valuesList[extremeIndex])
        || (!positive && valuesList[index] < valuesList[extremeIndex])) {
        extremeIndex = index;
      }
    });
    const duration = end - times[group[0]];
    return withLabel({
      start: times[group[0]],
      end,
      duration,
      extremumTime: times[extremeIndex],
      extremum: valuesList[extremeIndex],
      qualifies: duration + 1e-9 >= minimumDuration,
      label: ""
    });
  });
}

function bestWindow(windows: RecommendationWindow[]) {
  if (!windows.length) return null;
  const qualified = windows.filter(window => window.qualifies);
  const pool = qualified.length ? qualified : windows;
  return pool.reduce((best, item) => (Math.abs(item.extremum) > Math.abs(best.extremum) ? item : best));
}

function classification(
  positive: RecommendationWindow | null,
  negative: RecommendationWindow | null,
  hasAny: boolean
): TimeRecommendationResult["status"] {
  if (positive?.qualifies && negative?.qualifies) return "高置信度双窗口";
  if (positive?.qualifies || negative?.qualifies) return "单窗口可检测";
  if (hasAny) return "短窗口，建议复测";
  return "当前条件不推荐检测";
}

function pickPrimaryWindow(positive: RecommendationWindow | null, negative: RecommendationWindow | null) {
  const candidates = [positive, negative].filter((item): item is RecommendationWindow => Boolean(item));
  const qualified = candidates.filter(item => item.qualifies);
  const pool = qualified.length ? qualified : candidates;
  if (!pool.length) return null;
  return pool.reduce((best, item) => (Math.abs(item.extremum) > Math.abs(best.extremum) ? item : best));
}

function headlineFor(status: TimeRecommendationResult["status"], orientationName: string) {
  if (status === "高置信度双窗口") return `${orientationName}向墙面：正、负温差窗口均可用于采集`;
  if (status === "单窗口可检测") return `${orientationName}向墙面：当前条件下存在稳定检测窗口`;
  if (status === "短窗口，建议复测") return "热异常达到阈值，但有效持续时间不足";
  return "当前环境下热异常可能无法稳定超过阈值";
}

function reasonFor(
  status: TimeRecommendationResult["status"],
  positive: RecommendationWindow | null,
  negative: RecommendationWindow | null,
  weatherSource: string
) {
  const sourceText = `计算依据：${weatherSource}`;
  if (status === "高置信度双窗口") return `建议受热阶段获取正异常，并在降温阶段利用负异常复核。${sourceText}。`;
  if (status === "单窗口可检测") {
    return positive?.qualifies
      ? `正温差窗口达到阈值，适合获取空鼓区相对高温异常。${sourceText}。`
      : `负温差窗口达到阈值，适合在降温阶段获取空鼓区相对低温异常。${sourceText}。`;
  }
  if (negative?.qualifies || positive?.qualifies) return `存在可用窗口，但需要结合现场任务时长复核。${sourceText}。`;
  if (status === "短窗口，建议复测") return `窗口持续时间不足 1 小时，建议选择辐照更稳定或风速更低的日期。${sourceText}。`;
  return `可尝试改选日期、朝向或降低最小目标尺寸要求。${sourceText}。`;
}

function modelWarnings(inputs: ModelInputs, weather: ReturnType<typeof deriveWeatherModel>) {
  const warnings: string[] = [];
  if (inputs.h < 1 || inputs.h > 17) warnings.push("对流换热系数超出当前标定范围。");
  if (weather.source !== "逐小时预报") warnings.push("目标日缺少完整逐小时温度，已使用逐日最高/最低温估算。");
  if (inputs.radiationScale < 0.75) warnings.push("云量或降水使辐照折减较明显，结果偏保守。");
  warnings.push("墙体构造参数采用瓷砖饰面外墙 COMSOL 标定默认值。");
  return warnings;
}

function validateInputs(inputs: ModelInputs) {
  if (!(inputs.lat >= -90 && inputs.lat <= 90)) throw new Error("纬度应在 -90° 至 90°。");
  if (!(inputs.lon >= -180 && inputs.lon <= 180)) throw new Error("经度应在 -180° 至 180°。");
  if (!(inputs.tilt >= 0 && inputs.tilt <= 180)) throw new Error("墙面倾角应在 0° 至 180°。");
  if (!(inputs.rh > 0 && inputs.rh <= 100)) throw new Error("相对湿度应在 0% 至 100%。");
}

function minimumRecommendationHour(dateText: string, now: Date) {
  if (dateText !== formatDateOnly(now)) return 6;
  return Math.max(6, now.getHours() + now.getMinutes() / 60);
}

function peakHourFromHourly(hourly: QWeatherHourlyForecast[]) {
  if (!hourly.length) return null;
  const peak = hourly.reduce((best, item) => (item.temp_c > best.temp_c ? item : best));
  const date = new Date(peak.fx_time);
  if (Number.isNaN(date.getTime())) return null;
  return date.getHours() + date.getMinutes() / 60;
}

function calendarDaysAhead(dateText: string, now: Date) {
  const target = parseDateOnly(dateText);
  if (!target) return null;
  const base = parseDateOnly(formatDateOnly(now));
  if (!base) return null;
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

function parseDateOnly(text: string) {
  const parts = text.split("-").map(Number);
  if (parts.length !== 3 || parts.some(value => !Number.isFinite(value))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
}

function localDateFromIso(text: string) {
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return formatDateOnly(date);
}

function formatDateOnly(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function withLabel(window: RecommendationWindow): RecommendationWindow {
  return {
    ...window,
    label: `${hourText(window.start)}-${hourText(window.end)}`
  };
}

function hourText(hour: number) {
  const total = Math.round(clamp(hour, 0, 24) * 60);
  if (total >= 1440) return "24:00";
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function dayOfYear(date: Date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date.getTime() - start.getTime()) / 86400000);
}

function saturationVaporPressure(temperatureC: number) {
  return 0.6108 * Math.exp(17.27 * temperatureC / (temperatureC + 237.3));
}

function atmosphericPressure(elevationM: number) {
  return 101.3 * Math.pow((293 - 0.0065 * elevationM) / 293, 5.26);
}

function values(items: Array<number | null | undefined>) {
  return items.filter((item): item is number => Number.isFinite(item));
}

function sum(items: number[]) {
  return items.reduce((total, item) => total + item, 0);
}

function average(items: number[]) {
  if (!items.length) return null;
  return sum(items) / items.length;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rad(degrees: number) {
  return degrees * Math.PI / 180;
}

function deg(radians: number) {
  return radians * 180 / Math.PI;
}
