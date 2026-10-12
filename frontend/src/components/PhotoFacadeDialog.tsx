import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { FacadeType } from "@/types/projects";

export function PhotoFacadeDialog({ initialValue, labels, pending, error, onClose, onSubmit }: {
  initialValue: FacadeType | "";
  labels: Record<FacadeType, string>;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (type: FacadeType) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState<FacadeType | "">(initialValue);
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  const close = () => { if (!pending) onClose(); };
  return <dialog className="project-dialog" aria-labelledby="photo-facade-dialog-title" ref={dialog}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <form onSubmit={(event) => { event.preventDefault(); if (value && !pending) onSubmit(value); }}>
      <div className="dialog-heading"><h2 id="photo-facade-dialog-title">修改墙面类型</h2>
        <button aria-label="关闭墙面类型修改" className="back-cancel-button" disabled={pending} onClick={close} type="button"><X aria-hidden="true" /></button>
      </div>
      <label className="photo-library-field"><span>指定墙面类型</span><select aria-label="指定墙面类型" disabled={pending}
        onChange={(event) => setValue(event.target.value as FacadeType | "")} value={value}>
        <option value="" disabled>请选择墙面类型</option>
        {Object.entries(labels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
      </select></label>
      {error ? <div className="photo-library-notice is-error" role="alert">{error}</div> : null}
      <div className="dialog-actions">
        <button className="back-cancel-button" disabled={pending} onClick={close} type="button">取消</button>
        <button className="primary-action-button" disabled={!value || pending} type="submit">{pending ? "正在保存…" : "保存修改"}</button>
      </div>
    </form>
  </dialog>;
}
