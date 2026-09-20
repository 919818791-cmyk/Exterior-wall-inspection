import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Save, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";

import { trialInferenceDisclosureQueryOptions, trialInferenceSettingQueryOptions, updateTrialInferenceSettings } from "@/api/systemSettings";
import type {
  FormalDetectionPromptSettings,
  TrialInferenceProvider,
  TrialInferenceSetting,
  TrialInferenceSettingUpdate
} from "@/types/systemSettings";
import { formatDateTime } from "@/utils/projectDisplay";


interface SettingsForm extends FormalDetectionPromptSettings {
  provider: TrialInferenceProvider;
  global_job_concurrency: number;
  request_concurrency: number;
  monthly_photo_upload_limit: number;
  basic_formal_monthly_photo_upload_limit: number;
  professional_monthly_photo_upload_limit: number;
  professional_trial_monthly_photo_upload_limit: number;
  generate_limit_per_user: number;
  visible_prompt: string;
  crack_prompt: string;
  spalling_prompt: string;
  thermal_prompt: string;
  photo_guard_prompt: string;
}

type PromptSettingKey = keyof Pick<
  SettingsForm,
  | "visible_prompt"
  | "crack_prompt"
  | "spalling_prompt"
  | "thermal_prompt"
  | "photo_guard_prompt"
  | keyof FormalDetectionPromptSettings
>;

type PromptFacadeType = "general" | "tile" | "coating" | "plaster" | "panel" | "curtain_wall";

interface PromptSettingGroup {
  key: PromptFacadeType;
  label: string;
  options: Array<{ key: PromptSettingKey; label: string }>;
}

const PROMPT_SETTING_GROUPS: PromptSettingGroup[] = [
  {
    key: "general",
    label: "通用设置",
    options: [
      { key: "visible_prompt", label: "裂缝 + 剥落" },
      { key: "crack_prompt", label: "裂缝" },
      { key: "spalling_prompt", label: "剥落" },
      { key: "thermal_prompt", label: "空鼓（热成像）" },
      { key: "photo_guard_prompt", label: "照片相关性判断" }
    ]
  },
  {
    key: "tile",
    label: "饰面砖",
    options: [
      { key: "tile_crack_prompt", label: "裂缝" },
      { key: "tile_detachment_prompt", label: "脱落" },
      { key: "tile_crack_detachment_prompt", label: "裂缝 + 脱落" },
      { key: "tile_thermal_prompt", label: "空鼓（热成像）" }
    ]
  },
  {
    key: "coating",
    label: "涂饰",
    options: [
      { key: "coating_crack_prompt", label: "裂缝" },
      { key: "coating_peeling_prompt", label: "起皮" },
      { key: "coating_crack_peeling_prompt", label: "裂缝 + 起皮" },
      { key: "coating_thermal_prompt", label: "空鼓（热成像）" }
    ]
  },
  {
    key: "plaster",
    label: "抹灰",
    options: [
      { key: "plaster_crack_prompt", label: "裂缝" },
      { key: "plaster_spalling_prompt", label: "剥落" },
      { key: "plaster_visible_prompt", label: "裂缝 + 剥落" },
      { key: "plaster_thermal_prompt", label: "空鼓（热成像）" }
    ]
  },
  {
    key: "panel",
    label: "饰面板",
    options: [
      { key: "panel_damage_prompt", label: "面板破损" },
      { key: "panel_detachment_prompt", label: "脱落" }
    ]
  },
  {
    key: "curtain_wall",
    label: "幕墙",
    options: [
      { key: "curtain_wall_damage_prompt", label: "面板破损" }
    ]
  }
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "保存失败，请稍后重试。";
}

function runtimeStatusLabel(status: TrialInferenceSetting["options"][number]["runtime_status"]) {
  if (status === "running") return "运行中";
  if (status === "starting") return "正在启动";
  if (status === "stopped") return "已停止";
  return "";
}

function formFromSetting(setting: TrialInferenceSetting): SettingsForm {
  return {
    provider: setting.provider,
    global_job_concurrency: setting.global_job_concurrency,
    request_concurrency: setting.request_concurrency,
    monthly_photo_upload_limit: setting.monthly_photo_upload_limit ?? 50,
    basic_formal_monthly_photo_upload_limit: setting.basic_formal_monthly_photo_upload_limit ?? 50,
    professional_monthly_photo_upload_limit: setting.professional_monthly_photo_upload_limit ?? 1000,
    professional_trial_monthly_photo_upload_limit: setting.professional_trial_monthly_photo_upload_limit ?? 500,
    generate_limit_per_user: setting.generate_limit_per_user ?? 5,
    visible_prompt: setting.visible_prompt,
    crack_prompt: setting.crack_prompt,
    spalling_prompt: setting.spalling_prompt,
    thermal_prompt: setting.thermal_prompt,
    photo_guard_prompt: setting.photo_guard_prompt,
    ...setting.formal_prompts
  };
}

function updatePayload(form: SettingsForm): TrialInferenceSettingUpdate {
  return {
    provider: form.provider,
    global_job_concurrency: Number(form.global_job_concurrency),
    request_concurrency: Number(form.request_concurrency),
    monthly_photo_upload_limit: Number(form.monthly_photo_upload_limit),
    basic_formal_monthly_photo_upload_limit: Number(form.basic_formal_monthly_photo_upload_limit),
    professional_monthly_photo_upload_limit: Number(form.professional_monthly_photo_upload_limit),
    professional_trial_monthly_photo_upload_limit: Number(form.professional_trial_monthly_photo_upload_limit),
    generate_limit_per_user: Number(form.generate_limit_per_user),
    visible_prompt: form.visible_prompt,
    crack_prompt: form.crack_prompt,
    spalling_prompt: form.spalling_prompt,
    thermal_prompt: form.thermal_prompt,
    photo_guard_prompt: form.photo_guard_prompt,
    formal_prompts: {
      tile_crack_prompt: form.tile_crack_prompt,
      tile_detachment_prompt: form.tile_detachment_prompt,
      tile_crack_detachment_prompt: form.tile_crack_detachment_prompt,
      tile_thermal_prompt: form.tile_thermal_prompt,
      coating_crack_prompt: form.coating_crack_prompt,
      coating_peeling_prompt: form.coating_peeling_prompt,
      coating_crack_peeling_prompt: form.coating_crack_peeling_prompt,
      coating_thermal_prompt: form.coating_thermal_prompt,
      plaster_crack_prompt: form.plaster_crack_prompt,
      plaster_spalling_prompt: form.plaster_spalling_prompt,
      plaster_visible_prompt: form.plaster_visible_prompt,
      plaster_thermal_prompt: form.plaster_thermal_prompt,
      panel_damage_prompt: form.panel_damage_prompt,
      panel_detachment_prompt: form.panel_detachment_prompt,
      curtain_wall_damage_prompt: form.curtain_wall_damage_prompt
    }
  };
}

export function SystemSettingsPage() {
  const queryClient = useQueryClient();
  const settingQuery = useQuery(trialInferenceSettingQueryOptions);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [notice, setNotice] = useState("");
  const [activePromptKey, setActivePromptKey] = useState<PromptSettingKey>("visible_prompt");

  useEffect(() => {
    if (settingQuery.data) setForm(formFromSetting(settingQuery.data));
  }, [settingQuery.data]);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const updateMutation = useMutation({
    mutationFn: updateTrialInferenceSettings,
    onSuccess: async (setting) => {
      queryClient.setQueryData(trialInferenceSettingQueryOptions.queryKey, setting);
      setForm(formFromSetting(setting));
      const localOption = setting.options.find((option) => option.provider === "local_qwen");
      setNotice(
        setting.provider === "local_qwen" && localOption?.runtime_status === "starting"
          ? "推理设置已保存，本地模型正在加载；显示“运行中”后即可开始检测。"
          : setting.provider === "local_qwen"
            ? "推理设置已保存，本地模型已启动。"
            : "推理设置已保存，本地模型已关闭。"
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trialInferenceSettingQueryOptions.queryKey }),
        queryClient.invalidateQueries({ queryKey: trialInferenceDisclosureQueryOptions.queryKey })
      ]);
    }
  });

  function save() {
    if (!form) return;
    setNotice("");
    updateMutation.reset();
    updateMutation.mutate(updatePayload(form));
  }

  const activePromptGroup = PROMPT_SETTING_GROUPS.find((group) => (
    group.options.some((option) => option.key === activePromptKey)
  )) ?? PROMPT_SETTING_GROUPS[0];
  const activePromptOption = activePromptGroup.options.find((option) => option.key === activePromptKey)
    ?? activePromptGroup.options[0];

  return (
    <div className="system-settings-page management-list-page">
      {notice ? (
        <div className="system-settings-toast" role="status" aria-live="polite" aria-atomic="true">
          <CheckCircle2 aria-hidden="true" />
          <span>{notice}</span>
        </div>
      ) : null}
      <div className="project-workspace">
        <section className="project-hero">
          <div className="management-page-title system-settings-title">
            <Settings2 aria-hidden="true" className="management-page-title-icon" />
            <h1>推理设置</h1>
            {settingQuery.data ? (
              <span className="system-settings-updated-at">
                {settingQuery.data.updated_at ? `最近更新：${formatDateTime(settingQuery.data.updated_at)}` : "当前为系统默认配置"}
              </span>
            ) : null}
          </div>
          <div className="project-hero-action system-settings-header-actions">
            <RouterLink className="back-cancel-button system-settings-home-link" to="/">
              <ArrowLeft aria-hidden="true" />
              <span>返回首页</span>
            </RouterLink>
            <button
              className="button primary-action-button system-settings-save-button"
              disabled={!form || updateMutation.isPending}
              type="button"
              onClick={save}
            >
              <Save aria-hidden="true" />
              {updateMutation.isPending ? "正在保存…" : "保存配置"}
            </button>
          </div>
        </section>

        <section className="system-settings-panel" aria-label="平台 AI 推理设置配置项">
          {settingQuery.isLoading ? <div className="system-settings-loading">正在读取配置…</div> : null}
          {settingQuery.isError ? <div className="system-settings-message is-error">配置加载失败，请稍后刷新页面。</div> : null}

          {form && settingQuery.data ? (
            <>
              <div className="provider-option-grid" role="radiogroup" aria-label="当前推理 API">
                {settingQuery.data.options.map((option) => {
                  const selected = option.provider === form.provider;
                  const unavailable = !option.configured || (
                    option.provider === "local_qwen"
                    && (option.runtime_status === "disabled" || option.runtime_status === "error")
                  );
                  const showRuntimeInTitle = option.provider === "local_qwen" && (
                    option.runtime_status === "running"
                    || option.runtime_status === "starting"
                    || option.runtime_status === "stopped"
                  );
                  return (
                    <button key={option.provider} aria-checked={selected} className={`provider-option ${selected ? "is-selected" : ""}`} disabled={unavailable} role="radio" type="button" onClick={() => setForm({ ...form, provider: option.provider })}>
                      <span className="provider-option-radio" aria-hidden="true"><span /></span>
                      <span className="provider-option-content">
                        <span className="provider-option-title">
                          <strong>{option.label}</strong>
                          <span className="provider-option-title-badges">
                            {option.provider === settingQuery.data.provider ? <em><CheckCircle2 aria-hidden="true" />当前使用</em> : null}
                            {showRuntimeInTitle ? <span className={`provider-option-status is-${option.runtime_status} is-title-badge`} title={option.runtime_message || undefined}>{runtimeStatusLabel(option.runtime_status)}</span> : null}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="system-setting-block scheduler-setting-block">
                <h3>任务调度</h3>
                <div className="scheduler-setting-grid">
                  <label className="system-setting-field"><span>全局并发任务数<small>所有账号同时执行的检测任务上限，范围 1–10。</small></span><input min="1" max="10" type="number" value={form.global_job_concurrency} onChange={(event) => setForm({ ...form, global_job_concurrency: Number(event.target.value) })} /></label>
                  <label className="system-setting-field"><span>单任务并发请求数<small>一个检测任务同时发往模型服务的请求数，范围 1–10；本地模型还会受服务端显存安全上限约束。</small></span><input min="1" max="10" type="number" value={form.request_concurrency} onChange={(event) => setForm({ ...form, request_concurrency: Number(event.target.value) })} /></label>
                  <label className="system-setting-field"><span>基础版快速体验总检测上限<small>每账号按实际送检照片计数，一次性总额度不自动重置，默认 50 张。</small></span><input min="1" max="100000" type="number" value={form.monthly_photo_upload_limit} onChange={(event) => setForm({ ...form, monthly_photo_upload_limit: Number(event.target.value) })} /></label>
                  <label className="system-setting-field"><span>基础版专业检测总检测上限<small>每账号按实际送检照片计数，一次性总额度不自动重置，默认 50 张。</small></span><input min="1" max="100000" type="number" value={form.basic_formal_monthly_photo_upload_limit} onChange={(event) => setForm({ ...form, basic_formal_monthly_photo_upload_limit: Number(event.target.value) })} /></label>
                  <label className="system-setting-field"><span>专业版专业检测每月检测上限<small>每账号按实际送检照片计数，北京时间每月 1 日 00:00 重置，默认 1000 张。</small></span><input min="1" max="100000" type="number" value={form.professional_monthly_photo_upload_limit} onChange={(event) => setForm({ ...form, professional_monthly_photo_upload_limit: Number(event.target.value) })} /></label>
                  <label className="system-setting-field"><span>专业版快速体验每月检测上限<small>每账号按实际送检照片计数，北京时间每月 1 日 00:00 重置，默认 500 张。</small></span><input min="1" max="100000" type="number" value={form.professional_trial_monthly_photo_upload_limit} onChange={(event) => setForm({ ...form, professional_trial_monthly_photo_upload_limit: Number(event.target.value) })} /></label>
                  <label className="system-setting-field"><span>每账号检测次数上限<small>每 10 分钟允许发起的检测任务数。</small></span><input min="1" max="10000" type="number" value={form.generate_limit_per_user} onChange={(event) => setForm({ ...form, generate_limit_per_user: Number(event.target.value) })} /></label>
                </div>
              </div>

              <div className="system-setting-block prompt-setting-block">
                <div className="prompt-setting-heading">
                  <h3>检测提示词</h3>
                </div>
                <div className="prompt-setting-workspace" id="prompt-setting-workspace">
                  <div className="prompt-setting-filter-column">
                    <span className="prompt-setting-filter-title">外墙类型</span>
                    <div className="prompt-setting-list" role="radiogroup" aria-label="外墙类型">
                      {PROMPT_SETTING_GROUPS.map((group) => {
                        const selected = group.key === activePromptGroup.key;
                        return (
                          <button
                            key={group.key}
                            aria-controls="prompt-defect-type-list"
                            aria-checked={selected}
                            className={`prompt-setting-option ${selected ? "is-selected" : ""}`}
                            role="radio"
                            type="button"
                            onClick={() => setActivePromptKey(group.options[0].key)}
                          >
                            {group.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="prompt-setting-filter-column">
                    <span className="prompt-setting-filter-title">缺陷类型</span>
                    <div id="prompt-defect-type-list" className="prompt-setting-list" role="tablist" aria-label={`${activePromptGroup.label}缺陷类型`} aria-orientation="vertical">
                      {activePromptGroup.options.map((option) => {
                        const selected = option.key === activePromptKey;
                        return (
                          <button
                            key={option.key}
                            id={`prompt-setting-tab-${option.key}`}
                            aria-controls="prompt-setting-editor"
                            aria-selected={selected}
                            className={`prompt-setting-option ${selected ? "is-selected" : ""}`}
                            role="tab"
                            type="button"
                            onClick={() => setActivePromptKey(option.key)}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div
                    id="prompt-setting-editor"
                    aria-labelledby={`prompt-setting-tab-${activePromptKey}`}
                    className="prompt-setting-editor"
                    role="tabpanel"
                  >
                    <textarea
                      id="prompt-setting-content"
                      aria-label={`${activePromptOption.label}内容`}
                      value={form[activePromptKey]}
                      onChange={(event) => setForm({ ...form, [activePromptKey]: event.target.value })}
                    />
                  </div>
                </div>
              </div>

              {updateMutation.isError ? <div className="system-settings-message is-error">{errorMessage(updateMutation.error)}</div> : null}
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
