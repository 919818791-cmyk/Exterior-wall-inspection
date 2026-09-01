import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, ChevronDown, Database, Gauge, HardDrive, Image, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";

import { dataUsageQueryOptions } from "@/api/dataManagement";
import type { DataUsagePeriod, UsagePeriodMetrics } from "@/types/dataManagement";

type MetricKey = "photo_count" | "storage_mb" | "api_request_count" | "token_count" | "trial_task_count";
type TokenMetricKey = "input_token_count" | "output_token_count";
type MetricValues = Pick<UsagePeriodMetrics, MetricKey | TokenMetricKey>;

interface MetricDefinition {
  key: MetricKey;
  label: string;
  unit: string;
  icon: ReactNode;
  color: string;
  format: (value: number) => string;
  split?: Array<{ key: TokenMetricKey; label: string }>;
}

const integerFormatter = new Intl.NumberFormat("zh-CN");
const metricDefinitions: MetricDefinition[] = [
  { key: "photo_count", label: "照片数量", unit: "张", icon: <Image aria-hidden="true" />, color: "blue", format: (value) => integerFormatter.format(value) },
  { key: "storage_mb", label: "上传数据量", unit: "MB", icon: <HardDrive aria-hidden="true" />, color: "cyan", format: (value) => value.toFixed(2) },
  { key: "api_request_count", label: "模型 API 请求", unit: "次", icon: <Database aria-hidden="true" />, color: "violet", format: (value) => integerFormatter.format(value) },
  {
    key: "token_count",
    label: "Token 消耗",
    unit: "Token",
    icon: <Gauge aria-hidden="true" />,
    color: "orange",
    format: (value) => integerFormatter.format(value),
    split: [
      { key: "input_token_count", label: "输入" },
      { key: "output_token_count", label: "输出" }
    ]
  },
  { key: "trial_task_count", label: "Trial 任务", unit: "次", icon: <Bot aria-hidden="true" />, color: "green", format: (value) => integerFormatter.format(value) }
];

function MetricCard({ definition, values }: { definition: MetricDefinition; values: MetricValues }) {
  return (
    <article className={`data-metric-card ${definition.color}`}>
      <div className="data-metric-heading">
        <span className="data-metric-icon">{definition.icon}</span>
        <span>{definition.label}</span>
      </div>
      {definition.split ? (
        <div className="data-token-metric-values">
          {definition.split.map((item) => (
            <div key={item.key}>
              <strong>{definition.format(values[item.key])}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="data-metric-value">
          <strong>{definition.format(values[definition.key])}</strong><span>{definition.unit}</span>
        </div>
      )}
    </article>
  );
}

export function DataManagementPage() {
  const [period, setPeriod] = useState<DataUsagePeriod>("week");
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(true);
  const usageQuery = useQuery(dataUsageQueryOptions(period));
  const history = usageQuery.data?.history ?? [];
  const current = usageQuery.data?.current;
  const allTime = usageQuery.data?.all_time;
  const visibleHistory = [...history].reverse().filter((item) => (
    item.photo_count > 0
    || item.storage_bytes > 0
    || item.api_request_count > 0
    || item.token_count > 0
    || item.trial_task_count > 0
  ));
  return (
    <div className="data-management-page management-list-page">
      <div className="project-workspace">
        <div className="data-management-shell">
          <section className="project-hero">
            <div className="management-page-title">
              <Database aria-hidden="true" className="management-page-title-icon" />
              <h1>数据管理</h1>
            </div>
            <div className="project-hero-action standalone-management-actions">
              <RouterLink className="back-cancel-button standalone-management-home-link" to="/">
                <ArrowLeft aria-hidden="true" />
                <span>返回首页</span>
              </RouterLink>
              <div className="data-period-switch" aria-label="统计周期">
                <button className={period === "week" ? "active" : ""} type="button" onClick={() => setPeriod("week")}>按周</button>
                <button className={period === "month" ? "active" : ""} type="button" onClick={() => setPeriod("month")}>按月</button>
              </div>
            </div>
          </section>

          <div className="data-usage-content">
            {usageQuery.isError ? (
              <section className="data-usage-state" role="alert">
                <Database aria-hidden="true" />
                <strong>数据统计加载失败</strong>
                <span>请检查服务连接后重试。</span>
                <button type="button" onClick={() => void usageQuery.refetch()}><RefreshCw aria-hidden="true" />重新加载</button>
              </section>
            ) : usageQuery.isLoading || !current || !allTime ? (
              <section className="data-usage-state"><span className="data-loading-ring" /><strong>正在汇总数据…</strong></section>
            ) : (
              <>
                <section className="data-history-section" aria-label="历史统计">
                  <div className="data-usage-summary">
                    <div>
                      <strong>历史统计</strong>
                      <span>全部历史累计</span>
                    </div>
                    <button
                      aria-controls="history-metric-grid"
                      aria-expanded={isHistoryExpanded}
                      className="data-history-toggle"
                      type="button"
                      onClick={() => setIsHistoryExpanded((expanded) => !expanded)}
                    >
                      <span>{isHistoryExpanded ? "收起" : "展开"}</span>
                      <ChevronDown aria-hidden="true" />
                    </button>
                  </div>
                  {isHistoryExpanded ? (
                    <div className="data-metric-grid" id="history-metric-grid" aria-label="历史累计用量概览">
                      {metricDefinitions.map((definition) => (
                        <MetricCard key={`history-${definition.key}`} definition={definition} values={allTime} />
                      ))}
                    </div>
                  ) : null}
                </section>

                <div className="data-usage-summary">
                  <div>
                    <strong>{period === "week" ? "本周数据" : "本月数据"}</strong>
                    <span>{current.start_date} 至 {current.end_date}</span>
                  </div>
                  <span>数据更新时间：刚刚</span>
                </div>

                <section className="data-history-panel" aria-label="历史明细">
                  <div className="data-history-table-wrap">
                    <table className="data-history-table">
                      <thead><tr><th>周期</th><th className="data-history-first-collapse">照片数量</th><th className="data-history-second-collapse">上传数据量</th><th>模型 API 请求</th><th className="data-history-second-collapse">Token 消耗</th><th className="data-history-first-collapse">Trial 任务</th></tr></thead>
                      <tbody>
                        {visibleHistory.map((item) => (
                          <tr key={item.start_date} className={item.start_date === current.start_date ? "current" : ""}>
                            <td><strong>{item.label}</strong>{item.start_date === current.start_date ? <small>当前</small> : null}</td>
                            <td className="data-history-first-collapse">{integerFormatter.format(item.photo_count)} 张</td>
                            <td className="data-history-second-collapse">{item.storage_mb.toFixed(2)} MB</td>
                            <td>{integerFormatter.format(item.api_request_count)} 次</td>
                            <td className="data-history-token-cell data-history-second-collapse">
                              <span>输入 {integerFormatter.format(item.input_token_count)}</span>
                              <span>输出 {integerFormatter.format(item.output_token_count)}</span>
                            </td>
                            <td className="data-history-first-collapse">{integerFormatter.format(item.trial_task_count)} 次</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
