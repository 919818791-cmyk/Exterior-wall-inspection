import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  GitBranch,
  ScanSearch
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
    description: "面砖及其他外墙材料的脱落和局部剥离",
    Icon: ScanSearch,
    tone: "spalling"
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
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!configQuery.data) return;
    setModelTypes(configQuery.data.model_types);
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

  const persistConfig = (nextModelTypes: DefectType[]) => {
    if (!isEditable || configQuery.isLoading) return;
    if (!nextModelTypes.length) {
      setLocalError("请至少选择一种检测模型。");
      return;
    }

    setLocalError("");
    saveMutation.reset();
    saveMutation.mutate({
      model_types: nextModelTypes,
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
    persistConfig(nextModelTypes);
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

          {localError || saveMutation.isError || configQuery.isError ? (
            <div className="ai-config-alert">
              {localError || getErrorMessage(saveMutation.error ?? configQuery.error)}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
