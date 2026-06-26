import { Button, Card, CardBody, Divider, Input, Textarea } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Plus, Save, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";

import { createProject } from "@/api/projects";
import type { ProjectCreatePayload } from "@/types/projects";

interface FacadeDraft {
  localId: string;
  name: string;
  area: string;
  floors_range: string;
  description: string;
}

interface BuildingDraft {
  localId: string;
  name: string;
  floors: string;
  height: string;
  remark: string;
  facades: FacadeDraft[];
}

interface ProjectDraft {
  name: string;
  province: string;
  city: string;
  district: string;
  address: string;
  client_name: string;
  contact_name: string;
  contact_phone: string;
  longitude: string;
  latitude: string;
  buildings: BuildingDraft[];
}

function createFacadeDraft(name = ""): FacadeDraft {
  return {
    localId: crypto.randomUUID(),
    name,
    area: "",
    floors_range: "",
    description: ""
  };
}

function createBuildingDraft(name = ""): BuildingDraft {
  return {
    localId: crypto.randomUUID(),
    name,
    floors: "",
    height: "",
    remark: "",
    facades: [createFacadeDraft()]
  };
}

const initialProject: ProjectDraft = {
  name: "",
  province: "",
  city: "",
  district: "",
  address: "",
  client_name: "",
  contact_name: "",
  contact_phone: "",
  longitude: "",
  latitude: "",
  buildings: [createBuildingDraft()]
};

function cleanText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function cleanNumber(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
}

function cleanDecimal(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function buildPayload(form: ProjectDraft): { payload: ProjectCreatePayload | null; error: string } {
  if (!form.name.trim()) {
    return { payload: null, error: "请填写项目名称。" };
  }

  if (!form.buildings.length) {
    return { payload: null, error: "请至少添加一栋建筑。" };
  }

  for (const [buildingIndex, building] of form.buildings.entries()) {
    if (!building.name.trim()) {
      return { payload: null, error: `请填写第 ${buildingIndex + 1} 栋建筑名称。` };
    }
    if (!building.facades.length) {
      return { payload: null, error: `请为“${building.name.trim()}”至少添加一个检测立面。` };
    }
    for (const [facadeIndex, facade] of building.facades.entries()) {
      if (!facade.name.trim()) {
        return {
          payload: null,
          error: `请填写“${building.name.trim()}”第 ${facadeIndex + 1} 个立面名称。`
        };
      }
    }
  }

  return {
    error: "",
    payload: {
      name: form.name.trim(),
      province: cleanText(form.province),
      city: cleanText(form.city),
      district: cleanText(form.district),
      address: cleanText(form.address),
      client_name: cleanText(form.client_name),
      contact_name: cleanText(form.contact_name),
      contact_phone: cleanText(form.contact_phone),
      longitude: cleanDecimal(form.longitude),
      latitude: cleanDecimal(form.latitude),
      buildings: form.buildings.map((building, buildingIndex) => ({
        name: building.name.trim(),
        floors: cleanNumber(building.floors),
        height: cleanDecimal(building.height),
        remark: cleanText(building.remark),
        sort_order: buildingIndex,
        facades: building.facades.map((facade, facadeIndex) => ({
          name: facade.name.trim(),
          area: cleanDecimal(facade.area),
          floors_range: cleanText(facade.floors_range),
          description: cleanText(facade.description),
          sort_order: facadeIndex
        }))
      }))
    }
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "保存失败，请稍后重试。";
}

export function NewProjectPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProjectDraft>(initialProject);
  const [formError, setFormError] = useState("");

  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${project.id}`);
    }
  });

  const updateField = (field: keyof ProjectDraft, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFormError("");
  };

  const updateBuilding = (
    buildingId: string,
    field: keyof Omit<BuildingDraft, "localId" | "facades">,
    value: string
  ) => {
    setForm((current) => ({
      ...current,
      buildings: current.buildings.map((building) =>
        building.localId === buildingId ? { ...building, [field]: value } : building
      )
    }));
    setFormError("");
  };

  const updateFacade = (
    buildingId: string,
    facadeId: string,
    field: keyof Omit<FacadeDraft, "localId">,
    value: string
  ) => {
    setForm((current) => ({
      ...current,
      buildings: current.buildings.map((building) =>
        building.localId === buildingId
          ? {
              ...building,
              facades: building.facades.map((facade) =>
                facade.localId === facadeId ? { ...facade, [field]: value } : facade
              )
            }
          : building
      )
    }));
    setFormError("");
  };

  const addBuilding = () => {
    setForm((current) => ({
      ...current,
      buildings: [...current.buildings, createBuildingDraft()]
    }));
  };

  const removeBuilding = (buildingId: string) => {
    setForm((current) => ({
      ...current,
      buildings: current.buildings.filter((building) => building.localId !== buildingId)
    }));
  };

  const addFacade = (buildingId: string) => {
    setForm((current) => ({
      ...current,
      buildings: current.buildings.map((building) =>
        building.localId === buildingId
          ? { ...building, facades: [...building.facades, createFacadeDraft()] }
          : building
      )
    }));
  };

  const removeFacade = (buildingId: string, facadeId: string) => {
    setForm((current) => ({
      ...current,
      buildings: current.buildings.map((building) =>
        building.localId === buildingId
          ? {
              ...building,
              facades: building.facades.filter((facade) => facade.localId !== facadeId)
            }
          : building
      )
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { payload, error } = buildPayload(form);
    if (!payload) {
      setFormError(error);
      return;
    }
    setFormError("");
    createMutation.mutate(payload);
  };

  return (
    <form className="grid gap-5" onSubmit={handleSubmit}>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-action">New Project</p>
          <h1 className="mt-2 text-3xl font-black text-ink">新建项目</h1>
          <p className="mt-3 max-w-2xl text-sm font-semibold leading-7 text-slate-600">
            创建项目基础信息，并一次性录入建筑和检测立面。
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            as={RouterLink}
            className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
            startContent={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
            to="/projects"
            variant="flat"
          >
            返回列表
          </Button>
          <Button
            className="rounded-lg font-bold"
            color="primary"
            isLoading={createMutation.isPending}
            startContent={<Save className="h-4 w-4" aria-hidden="true" />}
            type="submit"
          >
            保存并进入详情
          </Button>
        </div>
      </section>

      {(formError || createMutation.isError) ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {formError || getErrorMessage(createMutation.error)}
        </div>
      ) : null}

      <Card className="rounded-lg border border-slate-200 shadow-none">
        <CardBody className="gap-5 p-5">
          <div>
            <h2 className="text-lg font-black text-ink">项目基础信息</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">创建后项目状态默认为待检测。</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Input
              isRequired
              classNames={{ inputWrapper: "rounded-lg shadow-none" }}
              label="项目名称"
              value={form.name}
              onValueChange={(value) => updateField("name", value)}
            />
            <Input
              classNames={{ inputWrapper: "rounded-lg shadow-none" }}
              label="委托单位"
              value={form.client_name}
              onValueChange={(value) => updateField("client_name", value)}
            />
            <Input
              classNames={{ inputWrapper: "rounded-lg shadow-none" }}
              label="联系人"
              value={form.contact_name}
              onValueChange={(value) => updateField("contact_name", value)}
            />
            <Input
              classNames={{ inputWrapper: "rounded-lg shadow-none" }}
              label="联系电话"
              value={form.contact_phone}
              onValueChange={(value) => updateField("contact_phone", value)}
            />
            <Input
              classNames={{ inputWrapper: "rounded-lg shadow-none" }}
              label="省"
              value={form.province}
              onValueChange={(value) => updateField("province", value)}
            />
            <Input
              classNames={{ inputWrapper: "rounded-lg shadow-none" }}
              label="市"
              value={form.city}
              onValueChange={(value) => updateField("city", value)}
            />
            <Input
              classNames={{ inputWrapper: "rounded-lg shadow-none" }}
              label="区"
              value={form.district}
              onValueChange={(value) => updateField("district", value)}
            />
            <Input
              classNames={{ inputWrapper: "rounded-lg shadow-none" }}
              label="经度"
              type="number"
              value={form.longitude}
              onValueChange={(value) => updateField("longitude", value)}
            />
            <Input
              classNames={{ inputWrapper: "rounded-lg shadow-none" }}
              label="纬度"
              type="number"
              value={form.latitude}
              onValueChange={(value) => updateField("latitude", value)}
            />
            <Input
              classNames={{ inputWrapper: "rounded-lg shadow-none" }}
              className="lg:col-span-3"
              label="项目位置"
              value={form.address}
              onValueChange={(value) => updateField("address", value)}
            />
          </div>
        </CardBody>
      </Card>

      <Card className="rounded-lg border border-slate-200 shadow-none">
        <CardBody className="gap-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-ink">建筑与检测立面</h2>
              <p className="mt-1 text-xs font-bold text-slate-500">
                立面只维护名称、面积、楼层范围和说明，不维护朝向。
              </p>
            </div>
            <Button
              className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
              startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
              type="button"
              variant="flat"
              onPress={addBuilding}
            >
              添加建筑
            </Button>
          </div>

          <div className="grid gap-4">
            {form.buildings.map((building, buildingIndex) => (
              <div key={building.localId} className="rounded-lg border border-slate-200 bg-slate-50">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                  <div className="inline-flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-action-soft text-action">
                      <Building2 className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <strong className="text-sm text-ink">建筑 {buildingIndex + 1}</strong>
                  </div>
                  <Button
                    isIconOnly
                    aria-label="删除建筑"
                    className="rounded-lg border border-red-200 bg-white text-red-600 shadow-none disabled:opacity-40"
                    isDisabled={form.buildings.length <= 1}
                    size="sm"
                    type="button"
                    variant="flat"
                    onPress={() => removeBuilding(building.localId)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="grid gap-4 p-4">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_160px_160px_minmax(0,1.4fr)]">
                    <Input
                      isRequired
                      classNames={{ inputWrapper: "rounded-lg shadow-none" }}
                      label="建筑名称"
                      value={building.name}
                      onValueChange={(value) => updateBuilding(building.localId, "name", value)}
                    />
                    <Input
                      classNames={{ inputWrapper: "rounded-lg shadow-none" }}
                      label="楼层数"
                      type="number"
                      value={building.floors}
                      onValueChange={(value) => updateBuilding(building.localId, "floors", value)}
                    />
                    <Input
                      classNames={{ inputWrapper: "rounded-lg shadow-none" }}
                      label="建筑高度（米）"
                      type="number"
                      value={building.height}
                      onValueChange={(value) => updateBuilding(building.localId, "height", value)}
                    />
                    <Input
                      classNames={{ inputWrapper: "rounded-lg shadow-none" }}
                      label="备注"
                      value={building.remark}
                      onValueChange={(value) => updateBuilding(building.localId, "remark", value)}
                    />
                  </div>

                  <Divider />

                  <div className="grid gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <strong className="text-sm text-slate-700">检测立面信息</strong>
                      <Button
                        className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
                        size="sm"
                        startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
                        type="button"
                        variant="flat"
                        onPress={() => addFacade(building.localId)}
                      >
                        添加立面
                      </Button>
                    </div>

                    {building.facades.map((facade, facadeIndex) => (
                      <div key={facade.localId} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 lg:grid-cols-[minmax(0,1fr)_140px_160px_minmax(0,1fr)_40px]">
                        <Input
                          isRequired
                          classNames={{ inputWrapper: "rounded-lg shadow-none" }}
                          label={`立面 ${facadeIndex + 1}`}
                          value={facade.name}
                          onValueChange={(value) =>
                            updateFacade(building.localId, facade.localId, "name", value)
                          }
                        />
                        <Input
                          classNames={{ inputWrapper: "rounded-lg shadow-none" }}
                          label="面积（㎡）"
                          type="number"
                          value={facade.area}
                          onValueChange={(value) =>
                            updateFacade(building.localId, facade.localId, "area", value)
                          }
                        />
                        <Input
                          classNames={{ inputWrapper: "rounded-lg shadow-none" }}
                          label="楼层范围"
                          value={facade.floors_range}
                          onValueChange={(value) =>
                            updateFacade(building.localId, facade.localId, "floors_range", value)
                          }
                        />
                        <Input
                          classNames={{ inputWrapper: "rounded-lg shadow-none" }}
                          label="说明"
                          value={facade.description}
                          onValueChange={(value) =>
                            updateFacade(building.localId, facade.localId, "description", value)
                          }
                        />
                        <Button
                          isIconOnly
                          aria-label="删除立面"
                          className="self-end rounded-lg border border-red-200 bg-white text-red-600 shadow-none disabled:opacity-40"
                          isDisabled={building.facades.length <= 1}
                          size="sm"
                          type="button"
                          variant="flat"
                          onPress={() => removeFacade(building.localId, facade.localId)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </form>
  );
}
