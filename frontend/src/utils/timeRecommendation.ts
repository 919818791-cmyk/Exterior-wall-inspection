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

const RECOMMENDATION_RULES = {
  preferredThreshold: 1.2,
  usableThreshold: 0.8,
  preferredMinimumDuration: 1,
  usableMinimumDuration: 0.5
} as const;

export type RecommendationLevel = "优选时段" | "可用时段" | "不推荐";

export interface RecommendationWindow {
  start: number;
  end: number;
  duration: number;
  extremumTime: number;
  extremum: number;
  qualifies: boolean;
  quality: Exclude<RecommendationLevel, "不推荐">;
  threshold: number;
  minimumDuration: number;
  label: string;
}

export interface TimeRecommendationResult {
  recommendationLevel: RecommendationLevel;
  status: "高置信度双窗口" | "单窗口可检测" | "可用时段，建议复测" | "当前条件不推荐检测";
  headline: string;
  reason: string;
  primaryWindow: RecommendationWindow | null;
  usableWindow: RecommendationWindow | null;
  positiveWindow: RecommendationWindow | null;
  negativeWindow: RecommendationWindow | null;
  peakRadiationWm2: number;
  peakRadiationTime: string;
  maxPositiveDeltaC: number;
  minNegativeDeltaC: number;
  weatherSummary: string;
  weatherSource: string;
  modelWarnings: string[];
  calculation: {
    evaluationRange: string;
    temperatureModel: string;
    radiationModel: string;
    convectionModel: string;
    positiveJudgement: string;
    negativeJudgement: string;
    finalJudgement: string;
    criteria: string;
  };
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
    threshold: RECOMMENDATION_RULES.preferredThreshold,
    minimumDuration: RECOMMENDATION_RULES.preferredMinimumDuration,
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
  const preferredPositive = bestQualifiedWindow(findWindows(
    times,
    deltaT,
    inputs.threshold,
    inputs.minimumDuration,
    true,
    minimumStartHour,
    "优选时段"
  ));
  const preferredNegative = bestQualifiedWindow(findWindows(
    times,
    deltaT,
    inputs.threshold,
    inputs.minimumDuration,
    false,
    minimumStartHour,
    "优选时段"
  ));
  const usablePositive = bestUsableWindow(times, deltaT, true, minimumStartHour);
  const usableNegative = bestUsableWindow(times, deltaT, false, minimumStartHour);
  const positive = preferredPositive ?? usablePositive;
  const negative = preferredNegative ?? usableNegative;
  const status = classification(preferredPositive, preferredNegative, usablePositive, usableNegative);
  const recommendationLevel = levelFor(status);
  const active = times.map((time, index) => ({ time, value: deltaT[index] })).filter(point => point.time >= minimumStartHour);
  const peakRadiation = solar.reduce((best, item) => (item.gwall > best.gwall ? item : best));
  const positivePeak = active.reduce((best, item) => (item.value > best.value ? item : best));
  const negativeValley = active.reduce((best, item) => (item.value < best.value ? item : best));
  const primaryWindow = pickPrimaryWindow(positive, negative);
  const usableWindow = pickPrimaryWindow(usablePositive, usableNegative);
  const peakHasPassed = options.date === formatDateOnly(options.now ?? new Date())
    && peakRadiation.time < minimumStartHour;
  const weatherSummary = [
    `${weather.tmean.toFixed(1)} ℃`,
    `湿度 ${weather.humidity.toFixed(0)}%`,
    `云量 ${weather.cloud.toFixed(0)}%`,
    `风速 ${weather.windSpeedKmh.toFixed(1)} km/h`
  ].join(" · ");

  return {
    recommendationLevel,
    status,
    headline: headlineFor(status, options.orientationName),
    reason: reasonFor(status, positive, negative, weather.source, peakHasPassed),
    primaryWindow,
    usableWindow,
    positiveWindow: positive ? withLabel(positive) : null,
    negativeWindow: negative ? withLabel(negative) : null,
    peakRadiationWm2: peakRadiation.gwall,
    peakRadiationTime: hourText(peakRadiation.time),
    maxPositiveDeltaC: positivePeak.value,
    minNegativeDeltaC: negativeValley.value,
    weatherSummary,
    weatherSource: weather.source,
    modelWarnings: [
      ...(recommendationLevel === "可用时段"
        ? ["可用时段未达到优选标准，建议缩短单次航线，并安排现场复核或补采。"]
        : []),
      ...modelWarnings(inputs, weather)
    ],
    calculation: {
      evaluationRange: `${hourText(minimumStartHour)}-24:00，每 10 分钟计算 1 次${minimumStartHour > 6 ? "；当天已过时段不参与推荐" : ""}`,
      temperatureModel: `最高 ${weather.tempMax.toFixed(1)} ℃，最低 ${weather.tempMin.toFixed(1)} ℃ → 均温 ${weather.tmean.toFixed(1)} ℃，日振幅 ${weather.tempAmplitude.toFixed(1)} ℃`,
      radiationModel: `云量 ${weather.cloud.toFixed(0)}% + 降水 ${weather.precip.toFixed(1)} mm → 辐照保留 ${(weather.radiationScale * 100).toFixed(0)}%，墙面峰值 ${peakRadiation.gwall.toFixed(0)} W/m²（${hourText(peakRadiation.time)}）${peakHasPassed ? "，峰值已早于可推荐时段" : ""}`,
      convectionModel: `风速 ${weather.windSpeedKmh.toFixed(1)} km/h → 对流换热系数 ${weather.convection.toFixed(1)} W/(m²·K)`,
      positiveJudgement: judgementText("正温差", positivePeak.value, positive, true),
      negativeJudgement: judgementText("负温差", negativeValley.value, negative, false),
      finalJudgement: finalJudgementText(status, positive, negative),
      criteria: "优选：|ΔT| ≥ 1.2 ℃且连续 ≥ 1 小时；可用：|ΔT| ≥ 0.8 ℃且连续 ≥ 30 分钟"
    }
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
    tempMax,
    tempMin,
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
  minimumStartHour: number,
  quality: RecommendationWindow["quality"]
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
      quality,
      threshold,
      minimumDuration,
      label: ""
    });
  });
}

function bestQualifiedWindow(windows: RecommendationWindow[]) {
  const qualified = windows.filter(window => window.qualifies);
  if (!qualified.length) return null;
  return qualified.reduce((best, item) => (Math.abs(item.extremum) > Math.abs(best.extremum) ? item : best));
}

function bestUsableWindow(
  times: number[],
  valuesList: number[],
  positive: boolean,
  minimumStartHour: number
) {
  const usableWindows = findWindows(
    times,
    valuesList,
    RECOMMENDATION_RULES.usableThreshold,
    RECOMMENDATION_RULES.usableMinimumDuration,
    positive,
    minimumStartHour,
    "可用时段"
  );
  return bestQualifiedWindow(usableWindows);
}

function classification(
  preferredPositive: RecommendationWindow | null,
  preferredNegative: RecommendationWindow | null,
  usablePositive: RecommendationWindow | null,
  usableNegative: RecommendationWindow | null
): TimeRecommendationResult["status"] {
  if (preferredPositive && preferredNegative) return "高置信度双窗口";
  if (preferredPositive || preferredNegative) return "单窗口可检测";
  if (usablePositive || usableNegative) return "可用时段，建议复测";
  return "当前条件不推荐检测";
}

function levelFor(status: TimeRecommendationResult["status"]): RecommendationLevel {
  if (status === "高置信度双窗口" || status === "单窗口可检测") return "优选时段";
  if (status === "可用时段，建议复测") return "可用时段";
  return "不推荐";
}

function pickPrimaryWindow(positive: RecommendationWindow | null, negative: RecommendationWindow | null) {
  const candidates = [positive, negative].filter((item): item is RecommendationWindow => Boolean(item));
  const preferred = candidates.filter(item => item.quality === "优选时段");
  const pool = preferred.length ? preferred : candidates;
  if (!pool.length) return null;
  return pool.reduce((best, item) => (Math.abs(item.extremum) > Math.abs(best.extremum) ? item : best));
}

function headlineFor(status: TimeRecommendationResult["status"], orientationName: string) {
  if (status === "高置信度双窗口") return `${orientationName}向墙面：正、负温差窗口均可用于采集`;
  if (status === "单窗口可检测") return `${orientationName}向墙面：当前条件下存在稳定检测窗口`;
  if (status === "可用时段，建议复测") return `${orientationName}向墙面：存在条件性可用窗口`;
  return "当前环境下热异常无法形成可用窗口";
}

function reasonFor(
  status: TimeRecommendationResult["status"],
  positive: RecommendationWindow | null,
  negative: RecommendationWindow | null,
  weatherSource: string,
  peakHasPassed: boolean
) {
  const sourceText = `计算依据：${weatherSource}`;
  if (status === "高置信度双窗口") return `建议受热阶段获取正异常，并在降温阶段利用负异常复核。${sourceText}。`;
  if (status === "单窗口可检测") {
    const preferred = [positive, negative].find(window => window?.quality === "优选时段");
    return preferred === positive
      ? `正温差窗口达到阈值，适合获取空鼓区相对高温异常。${sourceText}。`
      : `负温差窗口达到阈值，适合在降温阶段获取空鼓区相对低温异常。${sourceText}。`;
  }
  if (status === "可用时段，建议复测") {
    return `温差和持续时间达到可用标准，但未同时满足优选温差与持续时间；建议缩短航线并现场复核。${sourceText}。`;
  }
  if (peakHasPassed) return `当天墙面辐照峰值已经过去，系统只判断当前时刻之后的时段；可改选未来日期重新计算。${sourceText}。`;
  return `正、负温差均未形成可用窗口，可改选云量更低、风速更小的日期或调整立面朝向。${sourceText}。`;
}

function judgementText(
  name: string,
  extremum: number,
  window: RecommendationWindow | null,
  positive: boolean
) {
  const measured = `${extremum >= 0 ? "+" : ""}${extremum.toFixed(2)} ℃`;
  if (!window) return `${name}极值 ${measured}，未形成满足优选或可用标准的连续窗口 → 不通过`;
  const target = positive
    ? `≥ +${window.threshold.toFixed(1)} ℃`
    : `≤ -${window.threshold.toFixed(1)} ℃`;
  const duration = `${window.duration.toFixed(1)} 小时`;
  const minimumDuration = window.minimumDuration === 1 ? "1.0 小时" : "0.5 小时";
  return `${name}极值 ${measured}，达到 ${target}；连续 ${duration}，达到 ≥ ${minimumDuration} → ${window.quality}`;
}

function finalJudgementText(
  status: TimeRecommendationResult["status"],
  positive: RecommendationWindow | null,
  negative: RecommendationWindow | null
) {
  const preferredCount = [positive, negative].filter(window => window?.quality === "优选时段").length;
  if (status === "可用时段，建议复测") return "没有优选窗口，但至少 1 个方向达到可用标准 → 可用时段，建议现场复核";
  if (preferredCount === 2) return "正、负温差窗口均达到优选标准 → 高置信度双窗口";
  if (preferredCount === 1) return "正、负温差窗口中有 1 个达到优选标准 → 单窗口可检测";
  return "优选与可用标准均未通过 → 当前条件不推荐检测";
}

function modelWarnings(inputs: ModelInputs, weather: ReturnType<typeof deriveWeatherModel>) {
  const warnings: string[] = [];
  if (inputs.h < 1 || inputs.h > 17) warnings.push("对流换热系数超出当前标定范围。");
  if (weather.source !== "逐小时预报") warnings.push("目标日缺少完整逐小时温度，已使用逐日最高/最低温估算。");
  if (inputs.radiationScale < 0.75) warnings.push("云量或降水使辐照折减较明显，结果偏保守。");
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
