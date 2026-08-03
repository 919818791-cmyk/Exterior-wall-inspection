import { ArrowLeft, FolderKanban, X } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function ProjectWorkbenchShell({
  actionLabel,
  children,
  headerActions,
  hideHeader = false,
  title = "检测工作台"
}: {
  actionLabel: "返回" | "取消";
  children: ReactNode;
  headerActions?: ReactNode;
  hideHeader?: boolean;
  title?: string;
}) {
  const ActionIcon = actionLabel === "取消" ? X : ArrowLeft;

  return (
    <div className="management-list-page project-editor-management-page">
      <div className="project-workspace">
        {!hideHeader ? <section className="project-hero">
          <div className="management-page-title">
            <FolderKanban aria-hidden="true" className="management-page-title-icon" />
            <h1>{title}</h1>
          </div>
          <div className="project-hero-action">
            <Link className="button secondary report-back-button project-workbench-nav-button" to="/projects">
              <ActionIcon aria-hidden="true" />
              {actionLabel}
            </Link>
            {headerActions}
          </div>
        </section> : null}
        {children}
      </div>
    </div>
  );
}
