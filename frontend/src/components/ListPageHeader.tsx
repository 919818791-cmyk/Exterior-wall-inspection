import { ArrowLeft, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export interface ListPageHeaderConfig {
  actionClassName?: "back-cancel-button" | "primary-action-button";
  actionIcon?: ReactNode;
  actionLabel?: string;
  actionTo?: string;
  icon?: ReactNode;
  title: string;
  subtitle?: string;
}

export function getListPageHeader(pathname: string): ListPageHeaderConfig | null {
  switch (pathname) {
    case "/photos":
      return {
        title: "照片管理"
      };
    case "/system-settings":
      return { title: "推理设置" };
    case "/detection-prompts":
      return { title: "检测策略" };
    case "/model-management":
      return { title: "模型管理" };
    case "/detections":
      return {
        actionClassName: "primary-action-button",
        actionIcon: <Plus aria-hidden="true" />,
        actionLabel: "开始检测",
        actionTo: "/detections/new",
        title: "专业检测"
      };
    case "/trials":
      return {
        actionClassName: "primary-action-button",
        actionIcon: <Plus aria-hidden="true" />,
        actionLabel: "开始体验",
        actionTo: "/trials/new",
        title: "快速体验"
      };
    case "/review":
      return {
        actionClassName: "back-cancel-button",
        actionIcon: <ArrowLeft aria-hidden="true" />,
        actionLabel: "返回首页",
        actionTo: "/",
        title: "工作台",
      };
    default:
      if (pathname.startsWith("/recognition-quality")) return { title: "识别质量" };
      if (!pathname.startsWith("/accounts")) return null;
      return {
        actionClassName: "primary-action-button",
        actionIcon: <Plus aria-hidden="true" />,
        actionLabel: "新建账号",
        actionTo: "/accounts?create=1",
        title: "账号管理",
      };
  }
}

export function ListPageHeader({ config, action }: { config: ListPageHeaderConfig; action?: ReactNode }) {
  return (
    <>
      <div className="list-page-header-copy">
        <h1>
          {config.title}
          {config.icon}
        </h1>
        {config.subtitle ? <p>{config.subtitle}</p> : null}
      </div>

      <div className="list-page-header-action-slot">
        {action ?? (config.actionTo ? <Link className={`list-page-header-action ${config.actionClassName}`} to={config.actionTo}>
          {config.actionIcon}
          {config.actionLabel}
        </Link> : null)}
      </div>
    </>
  );
}
