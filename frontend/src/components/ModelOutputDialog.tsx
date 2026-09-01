import { X } from "lucide-react";

interface ModelOutputDialogProps {
  text: string;
  tileTokenText?: string | null;
  onClose: () => void;
}

export function ModelOutputDialog({ text, tileTokenText, onClose }: ModelOutputDialogProps) {
  return (
    <div
      className="model-output-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-output-dialog-title"
      onClick={onClose}
    >
      <section className="model-output-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="model-output-dialog-header">
          <h2 id="model-output-dialog-title">模型原始输出</h2>
          <button type="button" aria-label="关闭模型原始输出" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <pre>{text}</pre>
        {tileTokenText ? (
          <details className="model-output-token-details">
            <summary>查看每个 tile 的 Token 明细</summary>
            <pre>{tileTokenText}</pre>
          </details>
        ) : null}
      </section>
    </div>
  );
}
