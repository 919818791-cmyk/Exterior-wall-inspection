import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Save } from "lucide-react";
import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useOutletContext } from "react-router-dom";

import { trialInferenceDisclosureQueryOptions, trialInferenceSettingQueryOptions, updateTrialInferenceSettings } from "@/api/systemSettings";
import type { TrialInferenceSetting } from "@/types/systemSettings";

type SettingsForm = Pick<TrialInferenceSetting,
  | "global_job_concurrency"
  | "request_concurrency"
  | "generate_limit_per_user"
  | "trial_photo_detection_limit"
  | "formal_photo_detection_limit"
>;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "保存失败，请稍后重试。";
}

function formFromSetting(setting: TrialInferenceSetting): SettingsForm {
  return {
    global_job_concurrency: setting.global_job_concurrency,
    request_concurrency: setting.request_concurrency,
    generate_limit_per_user: setting.generate_limit_per_user ?? 5,
    trial_photo_detection_limit: setting.trial_photo_detection_limit ?? 1000,
    formal_photo_detection_limit: setting.formal_photo_detection_limit ?? 1000
  };
}

function updatePayload(form: SettingsForm): SettingsForm {
  return {
    global_job_concurrency: Number(form.global_job_concurrency),
    request_concurrency: Number(form.request_concurrency),
    generate_limit_per_user: Number(form.generate_limit_per_user),
    trial_photo_detection_limit: Number(form.trial_photo_detection_limit),
    formal_photo_detection_limit: Number(form.formal_photo_detection_limit)
  };
}

export function SystemSettingsPage() {
  const { setListPageHeaderAction } = useOutletContext<{ setListPageHeaderAction: Dispatch<SetStateAction<ReactNode>> }>();
  const queryClient = useQueryClient();
  const settingQuery = useQuery(trialInferenceSettingQueryOptions);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [notice, setNotice] = useState("");

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
      setNotice("推理设置已保存。");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trialInferenceSettingQueryOptions.queryKey }),
        queryClient.invalidateQueries({ queryKey: trialInferenceDisclosureQueryOptions.queryKey }),
        queryClient.invalidateQueries({ queryKey: ["current-account-usage"] })
      ]);
    }
  });

  const hasForm = form !== null;

  useEffect(() => {
    setListPageHeaderAction(
      <button
        className="list-page-header-action primary-action-button"
        disabled={!hasForm || updateMutation.isPending}
        form="system-settings-form"
        type="submit"
      >
        <Save aria-hidden="true" />
        {updateMutation.isPending ? "正在保存…" : "保存配置"}
      </button>
    );
    return () => setListPageHeaderAction(null);
  }, [hasForm, updateMutation.isPending, setListPageHeaderAction]);

  function save() {
    if (!form || updateMutation.isPending) return;
    setNotice("");
    updateMutation.reset();
    updateMutation.mutate(updatePayload(form));
  }

  return (
    <div className="system-settings-page management-list-page">
      {notice ? (
        <div className="system-settings-toast" role="status" aria-live="polite" aria-atomic="true">
          <CheckCircle2 aria-hidden="true" />
          <span>{notice}</span>
        </div>
      ) : null}
      <div className="project-workspace">
        <form className="project-list-panel" id="system-settings-form" aria-label="平台 AI 推理设置配置项" onSubmit={(event) => { event.preventDefault(); save(); }}>
          {settingQuery.isLoading ? <div className="system-settings-loading">正在读取配置…</div> : null}
          {settingQuery.isError ? <div className="system-settings-message is-error">配置加载失败，请稍后刷新页面。</div> : null}

          {form && settingQuery.data ? (
            <>
              <div className="system-setting-block">
                <h3>任务调度</h3>
                <div className="scheduler-setting-grid">
                  <label className="system-setting-field"><span>全局并发任务数<small>所有账号同时执行的检测任务上限，范围 1–10。</small></span><input min="1" max="10" type="number" value={form.global_job_concurrency} onChange={(event) => setForm({ ...form, global_job_concurrency: Number(event.target.value) })} /></label>
                  <label className="system-setting-field"><span>单任务并发请求数<small>一个检测任务同时发往模型服务的请求数，范围 1–10；本地模型还会受服务端显存安全上限约束。</small></span><input min="1" max="10" type="number" value={form.request_concurrency} onChange={(event) => setForm({ ...form, request_concurrency: Number(event.target.value) })} /></label>
                  <label className="system-setting-field"><span>每账号检测次数上限<small>每 10 分钟允许发起的检测任务数。</small></span><input min="1" max="10000" type="number" value={form.generate_limit_per_user} onChange={(event) => setForm({ ...form, generate_limit_per_user: Number(event.target.value) })} /></label>
                </div>
              </div>

              <div className="system-setting-block">
                <h3>检测额度</h3>
                <div className="scheduler-setting-grid">
                  <label className="system-setting-field"><span>基础版额度<small>快速体验的默认照片检测额度，账号单独设置优先。</small></span><input min="1" max="100000" step="1" required type="number" value={form.trial_photo_detection_limit} onChange={(event) => setForm({ ...form, trial_photo_detection_limit: Number(event.target.value) })} /></label>
                  <label className="system-setting-field"><span>专业版额度<small>专业检测的默认照片检测额度，账号单独设置优先。</small></span><input min="1" max="100000" step="1" required type="number" value={form.formal_photo_detection_limit} onChange={(event) => setForm({ ...form, formal_photo_detection_limit: Number(event.target.value) })} /></label>
                </div>
              </div>

              {updateMutation.isError ? <div className="system-settings-message is-error">{errorMessage(updateMutation.error)}</div> : null}
            </>
          ) : null}
        </form>
      </div>
    </div>
  );
}
