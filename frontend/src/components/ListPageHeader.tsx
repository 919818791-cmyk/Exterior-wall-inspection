import { ArrowLeft, Plus, Sparkles } from "lucide-react";
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
        title: "照片管理",
        subtitle: "集中检索检测照片，按墙面与缺陷分类管理"
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
        icon: (
          <img
            alt=""
            aria-hidden="true"
            className="list-page-header-icon list-page-header-icon-image"
            src="/icons/detections.png"
          />
        ),
        title: "专业检测",
        subtitle: "更准确的检测结果，更全面的数据分析"
      };
    case "/trials":
      return {
        actionClassName: "primary-action-button",
        actionIcon: <Plus aria-hidden="true" />,
        actionLabel: "开始体验",
        actionTo: "/trials/new",
        icon: <Sparkles aria-hidden="true" className="list-page-header-icon" />,
        title: "快速体验",
        subtitle: "上传照片即可体验 AI 外墙缺陷检测"
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
