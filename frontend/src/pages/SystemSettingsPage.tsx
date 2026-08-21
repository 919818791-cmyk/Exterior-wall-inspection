import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Save, Settings2, Star } from "lucide-react";
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
  daily_api_request_limit: number;
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

const PROMPT_SETTING_OPTIONS: Array<{ key: PromptSettingKey; label: string }> = [
  { key: "visible_prompt", label: "裂缝 + 剥落合并提示词" },
  { key: "crack_prompt", label: "裂缝单独提示词" },
  { key: "spalling_prompt", label: "剥落单独提示词" },
  { key: "thermal_prompt", label: "热成像照片提示词" },
  { key: "photo_guard_prompt", label: "建筑照片相关性判断提示词" },
  { key: "tile_crack_prompt", label: "面砖 · 裂缝" },
  { key: "tile_spalling_prompt", label: "面砖 · 剥落" },
  { key: "tile_visible_prompt", label: "面砖 · 裂缝 + 剥落" },
  { key: "tile_thermal_prompt", label: "面砖 · 空鼓（热成像）" },
  { key: "coating_crack_prompt", label: "涂料 · 裂缝" },
  { key: "coating_spalling_prompt", label: "涂料 · 剥落" },
  { key: "coating_visible_prompt", label: "涂料 · 裂缝 + 剥落" },
  { key: "coating_thermal_prompt", label: "涂料 · 空鼓（热成像）" },
  { key: "stone_crack_prompt", label: "石材 · 裂缝" },
  { key: "stone_spalling_prompt", label: "石材 · 剥落" },
  { key: "stone_visible_prompt", label: "石材 · 裂缝 + 剥落" },
  { key: "stone_thermal_prompt", label: "石材 · 空鼓（热成像）" }
];

const PROVIDER_RECOMMENDATION_SCORE: Record<TrialInferenceProvider, number> = {
  qwen: 4,
  qwen3_vl_flash: 3,
  local_qwen: 3,
  zhipu: 2
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "保存失败，请稍后重试。";
}

function runtimeStatusLabel(status: TrialInferenceSetting["options"][number]["runtime_status"]) {
  if (status === "running") return "运行中";
  if (status === "starting") return "正在启动";
  if (status === "stopped") return "已停止";
  if (status === "error") return "运行异常";
  if (status === "disabled") return "自动启停未开启";
  return "";
}

function formFromSetting(setting: TrialInferenceSetting): SettingsForm {
  return {
    provider: setting.provider,
    global_job_concurrency: setting.global_job_concurrency,
    request_concurrency: setting.request_concurrency,
    daily_api_request_limit: setting.daily_api_request_limit ?? 800,
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
    daily_api_request_limit: Number(form.daily_api_request_limit),
    generate_limit_per_user: Number(form.generate_limit_per_user),
    visible_prompt: form.visible_prompt,
    crack_prompt: form.crack_prompt,
    spalling_prompt: form.spalling_prompt,
    thermal_prompt: form.thermal_prompt,
    photo_guard_prompt: form.photo_guard_prompt,
    formal_prompts: {
      tile_crack_prompt: form.tile_crack_prompt,
      tile_spalling_prompt: form.tile_spalling_prompt,
      tile_visible_prompt: form.tile_visible_prompt,
      tile_thermal_prompt: form.tile_thermal_prompt,
      coating_crack_prompt: form.coating_crack_prompt,
      coating_spalling_prompt: form.coating_spalling_prompt,
      coating_visible_prompt: form.coating_visible_prompt,
      coating_thermal_prompt: form.coating_thermal_prompt,
      stone_crack_prompt: form.stone_crack_prompt,
      stone_spalling_prompt: form.stone_spalling_prompt,
      stone_visible_prompt: form.stone_visible_prompt,
      stone_thermal_prompt: form.stone_thermal_prompt
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

  const activePromptOption = PROMPT_SETTING_OPTIONS.find((option) => option.key === activePromptKey)
    ?? PROMPT_SETTING_OPTIONS[0];

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
            <RouterLink className="button secondary report-back-button system-settings-home-link" to="/">
              <ArrowLeft aria-hidden="true" />
              <span>返回首页</span>
            </RouterLink>
            <button
              className="button primary report-back-button system-settings-save-button"
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
                  const recommendationScore = PROVIDER_RECOMMENDATION_SCORE[option.provider];
                  const showRuntimeInTitle = option.provider === "local_qwen" && (
                    option.runtime_status === "running"
                    || option.runtime_status === "starting"
                    || option.runtime_status === "stopped"
                  );
                  return (
                    <button key={option.provider} aria-checked={selected} className={`provider-option ${selected ? "is-selected" : ""}`} role="radio" type="button" onClick={() => setForm({ ...form, provider: option.provider })}>
                      <span className="provider-option-radio" aria-hidden="true"><span /></span>
                      <span className="provider-option-content">
                        <span className="provider-option-title">
                          <strong>{option.label}</strong>
                          <span className="provider-option-title-badges">
                            {option.provider === settingQuery.data.provider ? <em><CheckCircle2 aria-hidden="true" />当前使用</em> : null}
                            {showRuntimeInTitle ? <span className={`provider-option-status is-${option.runtime_status} is-title-badge`} title={option.runtime_message || undefined}>{runtimeStatusLabel(option.runtime_status)}</span> : null}
                          </span>
                        </span>
                        <span className="provider-option-recommendation" aria-label={`推荐指数：5 星满分，${recommendationScore} 星`}>
                          <span>推荐指数</span>
                          <span className="provider-option-stars" aria-hidden="true">
                            {Array.from({ length: 5 }, (_, index) => <Star className={index < recommendationScore ? "is-filled" : ""} key={index} />)}
                          </span>
                        </span>
                        {option.runtime_status && !showRuntimeInTitle ? <span className={`provider-option-status is-${option.runtime_status}`} title={option.runtime_message || undefined}>{runtimeStatusLabel(option.runtime_status)}</span> : null}
                        {!option.configured ? <span className="provider-option-status is-missing">服务端配置缺失</span> : null}
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
                  <label className="system-setting-field"><span>每账号每日模型请求额度<small>按北京时间每天 00:00 重置，按图片切片实际请求数计费。</small></span><input min="1" max="1000000" type="number" value={form.daily_api_request_limit} onChange={(event) => setForm({ ...form, daily_api_request_limit: Number(event.target.value) })} /></label>
                  <label className="system-setting-field"><span>每账号检测次数上限<small>每 10 分钟允许发起的检测任务数。</small></span><input min="1" max="10000" type="number" value={form.generate_limit_per_user} onChange={(event) => setForm({ ...form, generate_limit_per_user: Number(event.target.value) })} /></label>
                </div>
              </div>

              <div className="system-setting-block prompt-setting-block">
                <div className="prompt-setting-heading">
                  <span>
                    <h3>检测提示词</h3>
                    <small>{PROMPT_SETTING_OPTIONS.length} 项高级配置</small>
                  </span>
                </div>
                <div className="prompt-setting-workspace" id="prompt-setting-workspace">
                  <div className="prompt-setting-list" role="tablist" aria-label="检测提示词类型" aria-orientation="vertical">
                    {PROMPT_SETTING_OPTIONS.map((option) => {
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
