import { Button, Card, CardBody, Checkbox, Switch } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { detectionConfigQueryOptions, updateDetectionConfig } from "@/api/projects";
import type { DefectType, ProjectDetail } from "@/types/projects";

const MODEL_OPTIONS: Array<{ label: string; value: DefectType; description: string }> = [
  { label: "裂缝", value: "crack", description: "外墙裂缝和线状破损" },
  { label: "剥落", value: "spalling", description: "饰面层脱落、局部破损" },
  { label: "空鼓", value: "hollowing", description: "疑似空鼓和附着异常" },
  { label: "渗漏", value: "leakage", description: "水渍、渗漏和潮湿痕迹" },
  { label: "锈蚀", value: "corrosion", description: "金属件锈蚀和污染痕迹" }
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
    mutationFn: () =>
      updateDetectionConfig(project.id, {
        model_types: modelTypes,
        high_precision: highPrecision,
        config_json: null
      }),
    onSuccess: async () => {
      setLocalError("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["projects", project.id] }),
        queryClient.invalidateQueries({ queryKey: ["projects", project.id, "detection-config"] })
      ]);
    }
  });

  const toggleModel = (model: DefectType) => {
    setModelTypes((current) =>
      current.includes(model) ? current.filter((item) => item !== model) : [...current, model]
    );
    setLocalError("");
  };

  const save = () => {
    if (!modelTypes.length) {
      setLocalError("请至少选择一种检测模型。");
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Card className="rounded-lg border border-slate-200 shadow-none">
      <CardBody className="gap-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-action-soft text-action">
                <Cpu className="h-5 w-5" aria-hidden="true" />
              </span>
              <h2 className="text-lg font-black text-ink">检测模型与检测模式配置</h2>
            </div>
            <p className="mt-2 text-xs font-bold text-slate-500">
              至少选择一种检测模型；高精度检测是附加开关。
            </p>
          </div>
          <Button
            className="rounded-lg font-bold"
            color="primary"
            isDisabled={!isEditable}
            isLoading={saveMutation.isPending}
            startContent={<Save className="h-4 w-4" aria-hidden="true" />}
            onPress={save}
          >
            保存配置
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {MODEL_OPTIONS.map((model) => (
            <Checkbox
              key={model.value}
              classNames={{
                base: "m-0 max-w-none rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-none data-[selected=true]:border-action data-[selected=true]:bg-action-soft",
                label: "w-full"
              }}
              isDisabled={!isEditable}
              isSelected={modelTypes.includes(model.value)}
              onValueChange={() => toggleModel(model.value)}
            >
              <span className="block font-black text-slate-800">{model.label}</span>
              <span className="mt-1 block text-xs font-semibold text-slate-500">
                {model.description}
              </span>
            </Checkbox>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div>
            <h3 className="text-sm font-black text-ink">高精度检测</h3>
            <p className="mt-1 text-xs font-bold text-slate-500">
              开启后后续 AI 任务会使用更严格的模型配置。
            </p>
          </div>
          <Switch
            isDisabled={!isEditable}
            isSelected={highPrecision}
            onValueChange={setHighPrecision}
          >
            {highPrecision ? "已开启" : "未开启"}
          </Switch>
        </div>

        {(localError || saveMutation.isError) ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
            {localError || getErrorMessage(saveMutation.error)}
          </div>
        ) : null}

        {configQuery.isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
            {getErrorMessage(configQuery.error)}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
