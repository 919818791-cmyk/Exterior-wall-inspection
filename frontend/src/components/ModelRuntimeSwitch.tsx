interface ModelRuntimeSwitchProps {
  label: string;
  status: string;
  message: string;
  supported: boolean;
  active?: boolean;
  pendingAction?: "start" | "stop";
  disabled?: boolean;
  onChange: (action: "start" | "stop") => void;
}

export function ModelRuntimeSwitch({ label, status, message, supported, active, pendingAction, disabled = false, onChange }: ModelRuntimeSwitchProps) {
  const checked = active ?? ["running", "starting", "stopping"].includes(status);
  const busy = Boolean(pendingAction) || status === "stopping";
  const text = pendingAction === "start" || status === "starting" ? "启动中" : pendingAction === "stop" || status === "stopping" ? "停止中" : !supported ? null : checked ? "开启" : "关闭";
  return <button
    aria-label={`${label}运行开关`}
    aria-checked={checked}
    aria-busy={busy || status === "starting"}
    className="model-runtime-switch"
    disabled={!supported || disabled || busy}
    onClick={() => onChange(checked ? "stop" : "start")}
    role="switch"
    title={message}
    type="button"
  ><span aria-hidden="true" className="model-runtime-switch-track" />{text ? <span aria-hidden="true">{text}</span> : null}</button>;
}
