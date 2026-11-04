import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function WorkspaceTitleBar({
  actions,
  backLabel,
  backTo,
  className = "",
  eyebrow,
  meta,
  title,
  titleId
}: {
  actions?: ReactNode;
  backLabel: string;
  backTo: string;
  className?: string;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  title: string;
  titleId?: string;
}) {
  return (
    <header className={`building-model-page-header workspace-title-bar ${className}`.trim()}>
      <Link className="building-model-back-button back-cancel-button" to={backTo}>
        <ArrowLeft aria-hidden="true" />
        <span>{backLabel}</span>
      </Link>
      <div className="building-model-page-heading">
        {eyebrow ? <span>{eyebrow}</span> : null}
        <h1 id={titleId}>{title}</h1>
        {meta ? <div className="workspace-title-bar-meta">{meta}</div> : null}
      </div>
      <div className="workspace-title-bar-actions">{actions}</div>
    </header>
  );
}
