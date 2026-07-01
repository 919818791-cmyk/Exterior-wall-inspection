import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Droplets,
  GitBranch,
  Layers3,
  ShieldAlert,
  ThermometerSun
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { detectionConfigQueryOptions, updateDetectionConfig } from "@/api/projects";
import type { DefectType, DetectionConfigPayload, ProjectDetail } from "@/types/projects";

const MODEL_OPTIONS: Array<{
  label: string;
  value: DefectType;
  description: string;
  Icon: LucideIcon;
  tone: string;
}> = [
  {
    label: "裂缝",
    value: "crack",
    description: "外墙裂缝和线状破损",
    Icon: GitBranch,
    tone: "crack"
  },
  {
    label: "剥落",
    value: "spalling",
    description: "饰面层脱落、局部破损",
    Icon: Layers3,
    tone: "spalling"
  },
  {
    label: "空鼓",
    value: "hollowing",
    description: "疑似空鼓和附着异常",
    Icon: ThermometerSun,
    tone: "hollowing"
  },
  {
    label: "渗漏",
    value: "leakage",
    description: "水渍、渗漏和潮湿痕迹",
    Icon: Droplets,
    tone: "leakage"
  },
  {
    label: "锈蚀",
    value: "corrosion",
    description: "金属件锈蚀和污染痕迹",
    Icon: ShieldAlert,
    tone: "corrosion"
  }
];

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "保存失败，请稍后重试。";
}

export function DetectionConfigSection({
  project,
  isEditable
}: {
  project: ProjectDetail;
  isEditable: boolean;
}) {
  const queryClient = useQueryClient();
  const configQuery = useQuery(detectionConfigQueryOptions(project.id));
  const [modelTypes, setModelTypes] = useState<DefectType[]>([]);
  const [highPrecision, setHighPrecision] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!configQuery.data) return;
    setModelTypes(configQuery.data.model_types);
    setHighPrecision(configQuery.data.high_precision);
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (payload: DetectionConfigPayload) => updateDetectionConfig(project.id, payload),
    onSuccess: async () => {
      setLocalError("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["projects", project.id] }),
        queryClient.invalidateQueries({ queryKey: ["projects", project.id, "detection-config"] })
      ]);
    }
  });

  const persistConfig = (nextModelTypes: DefectType[], nextHighPrecision: boolean) => {
    if (!isEditable || configQuery.isLoading) return;
    if (!nextModelTypes.length) {
      setLocalError("请至少选择一种检测模型。");
      return;
    }

    setLocalError("");
    saveMutation.reset();
    saveMutation.mutate({
      model_types: nextModelTypes,
      high_precision: nextHighPrecision,
      config_json: null
    });
  };

  const toggleModel = (model: DefectType) => {
    if (!isEditable || configQuery.isLoading) return;

    const nextModelTypes = modelTypes.includes(model)
      ? modelTypes.filter((item) => item !== model)
      : [...modelTypes, model];

    if (!nextModelTypes.length) {
      setLocalError("请至少选择一种检测模型。");
      return;
    }

    setModelTypes(nextModelTypes);
    persistConfig(nextModelTypes, highPrecision);
  };

  const changePrecision = (nextHighPrecision: boolean) => {
    if (!isEditable || configQuery.isLoading || nextHighPrecision === highPrecision) return;

    setHighPrecision(nextHighPrecision);
    persistConfig(modelTypes, nextHighPrecision);
  };

  return (
    <div className={`ai-config-card ${!isEditable ? "is-readonly" : ""}`}>
      <div className="ai-config-layout">
        <section
          className={`ai-config-panel ai-model-panel ${localError ? "has-error" : ""}`}
          aria-labelledby="ai-model-title"
        >
          <div className="ai-panel-heading">
            <h3 id="ai-model-title">检测模型筛选</h3>
          </div>

          <div className="ai-model-grid" role="group" aria-label="检测模型">
            {MODEL_OPTIONS.map((model) => {
              const selected = modelTypes.includes(model.value);
              const Icon = model.Icon;

              return (
                <label
                  key={model.value}
                  className={`ai-model-card ai-model-card-${model.tone} ${
                    selected ? "is-selected" : ""
                  }`}
                  title={model.description}
                >
                  <input
                    checked={selected}
                    className="ai-config-sr-input"
                    disabled={!isEditable || configQuery.isLoading}
                    type="checkbox"
                    value={model.value}
                    onChange={() => toggleModel(model.value)}
                  />
                  <span className="ai-model-icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <span className="ai-model-name">{model.label}</span>
                  <span className="ai-model-check" aria-hidden="true">
                    {selected ? <Check /> : null}
                  </span>
                </label>
              );
            })}
          </div>

          {localError || saveMutation.isError ? (
            <div className="ai-config-alert">
              {localError || getErrorMessage(saveMutation.error)}
            </div>
          ) : null}
        </section>

        <section className="ai-config-panel ai-mode-panel" aria-labelledby="ai-mode-title">
          <div className="ai-panel-heading">
            <h3 id="ai-mode-title">检测模式</h3>
          </div>

          <div className="ai-mode-options" role="radiogroup" aria-label="检测模式">
            <label className={`ai-mode-option ${!highPrecision ? "is-selected" : ""}`}>
              <input
                checked={!highPrecision}
                className="ai-config-sr-input"
                disabled={!isEditable || configQuery.isLoading}
                name={`detection-mode-${project.id}`}
                type="radio"
                value="standard"
                onChange={() => changePrecision(false)}
              />
              <span className="ai-mode-radio" aria-hidden="true" />
              <span className="ai-mode-copy">
                <strong>
                  标准检测 <em>推荐</em>
                </strong>
                <span>平衡检测效果与处理效率</span>
              </span>
            </label>

            <label className={`ai-mode-option ${highPrecision ? "is-selected" : ""}`}>
              <input
                checked={highPrecision}
                className="ai-config-sr-input"
                disabled={!isEditable || configQuery.isLoading}
                name={`detection-mode-${project.id}`}
                type="radio"
                value="high"
                onChange={() => changePrecision(true)}
              />
              <span className="ai-mode-radio" aria-hidden="true" />
              <span className="ai-mode-copy">
                <strong>高精度检测</strong>
                <span>提升细小缺陷识别能力，处理时间更长</span>
              </span>
            </label>
          </div>

          {configQuery.isError ? (
            <div className="ai-config-alert">{getErrorMessage(configQuery.error)}</div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
