export interface TrialDefectDisplay {
  label: string;
  descriptionClassName: string;
  boxClassName: string;
}

const TRIAL_DEFECT_DISPLAY_BY_TYPE: Record<string, TrialDefectDisplay> = {
  crack: {
    label: "裂缝",
    descriptionClassName: "trial-report-description-crack",
    boxClassName: "trial-defect-box-crack"
  },
  missing: {
    label: "面砖剥落",
    descriptionClassName: "trial-report-description-missing",
    boxClassName: "trial-defect-box-missing"
  },
  spalling: {
    label: "剥落",
    descriptionClassName: "trial-report-description-spalling",
    boxClassName: "trial-defect-box-spalling"
  },
  moisture: {
    label: "潮湿",
    descriptionClassName: "trial-report-description-moisture",
    boxClassName: "trial-defect-box-moisture"
  }
};

const TRIAL_MODEL_TO_DEFECT_TYPE: Record<string, string> = {
  crack: "crack",
  "裂缝": "crack",
  "开裂": "crack",
  missing: "missing",
  "面砖剥落": "missing",
  "面砖缺失": "missing",
  spalling: "spalling",
  "剥落": "spalling",
  moisture: "moisture",
  "潮湿": "moisture"
};

const FALLBACK_TRIAL_DEFECT_DISPLAY = TRIAL_DEFECT_DISPLAY_BY_TYPE.crack;

function normalizeTrialDefectKey(value: string | null | undefined) {
  return (value ?? "").trim();
}

export function trialDefectDisplayFromType(defectType: string | null | undefined) {
  const key = normalizeTrialDefectKey(defectType);
  return TRIAL_DEFECT_DISPLAY_BY_TYPE[key] ?? FALLBACK_TRIAL_DEFECT_DISPLAY;
}

export function trialDefectDisplayFromModel(model: string | null | undefined) {
  const key = normalizeTrialDefectKey(model);
  return trialDefectDisplayFromType(TRIAL_MODEL_TO_DEFECT_TYPE[key] ?? key);
}

export function trialDefectDescriptionFromType(defectType: string | null | undefined, count = 1) {
  const display = trialDefectDisplayFromType(defectType);
  return {
    className: display.descriptionClassName,
    text: `疑似${display.label}: ${count}处`
  };
}

export function trialDefectBoxLabel(display: TrialDefectDisplay, confidence?: number | string | null) {
  const numericConfidence = Number(confidence);
  const confidenceText = Number.isFinite(numericConfidence)
    ? numericConfidence.toFixed(2)
    : typeof confidence === "string" && confidence.trim()
      ? confidence.trim()
      : "";

  return confidenceText ? `${display.label} ${confidenceText}` : display.label;
}
