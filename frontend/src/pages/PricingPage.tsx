import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Minus, X } from "lucide-react";
import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";

import { pricingQuotaSettingQueryOptions } from "@/api/systemSettings";
import { submitProfessionalApplication } from "@/api/accounts";
import { ErrorNoticeModal } from "@/components/project/PhotoLimitModal";
import { useAuthStore } from "@/stores/useAuthStore";
import type { PricingQuotaSetting } from "@/types/systemSettings";

type PlanFeature = {
  label: string;
  unavailable?: boolean;
};

type Plan = {
  actionLabel: string;
  description: string;
  features: PlanFeature[];
  name: string;
  quotas: string[];
};

const defaultPricingQuotas: PricingQuotaSetting = {
  monthly_photo_upload_limit: 50,
  basic_formal_monthly_photo_upload_limit: 50,
  professional_monthly_photo_upload_limit: 1000,
  professional_trial_monthly_photo_upload_limit: 500
};

function pricingPlans(quotas: PricingQuotaSetting): Plan[] {
  return [
    {
      name: "基础版",
      actionLabel: "获取基础版",
      description: "限时免费体验基础检测功能",
      quotas: [
        `快速体验可用 ${quotas.monthly_photo_upload_limit} 张照片额度。`,
        `专业检测可用 ${quotas.basic_formal_monthly_photo_upload_limit} 张照片额度。`
      ],
      features: [
        { label: "识别裂缝、脱落、空鼓等外墙缺陷" },
        { label: "照片质量预检与检测结果归档" },
        { label: "不支持生成三维模型", unavailable: true },
        { label: "一次性额度，不自动重置", unavailable: true }
      ]
    },
    {
      name: "专业版",
      actionLabel: "获取专业版",
      description: "适合持续巡检、批量检测和专业项目团队。",
      quotas: [
        `快速体验可用 ${quotas.professional_trial_monthly_photo_upload_limit} 张照片额度。`,
        `专业检测可用 ${quotas.professional_monthly_photo_upload_limit} 张照片额度。`
      ],
      features: [
        { label: "识别裂缝、脱落、空鼓等外墙缺陷" },
        { label: "照片质量预检与检测结果归档" },
        { label: "支持生成三维模型" },
        { label: "每月自动刷新两项照片额度" },
        { label: "更高质量的检测结果" }
      ]
    }
  ];
}

export function PricingPage() {
  const pricingQuotaQuery = useQuery(pricingQuotaSettingQueryOptions);
  const authStatus = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);
  const [noticeMessage, setNoticeMessage] = useState("");
  const { requestRegistration } = useOutletContext<{
    requestRegistration: () => void;
  }>();
  const plans = pricingPlans(pricingQuotaQuery.data ?? defaultPricingQuotas);
  const professionalApplicationMutation = useMutation({
    mutationFn: submitProfessionalApplication,
    onSuccess: () => {
      if (user) updateUser({ ...user, professional_application_status: "pending" });
      setNoticeMessage("专业版申请已提交，我们将在24小时内回复。");
    },
    onError: (error) => {
      setNoticeMessage(error instanceof Error ? error.message : "专业版申请提交失败，请稍后重试。");
    }
  });

  return (
    <div className="pricing-page">
      <Link aria-label="关闭定价页面" className="back-cancel-button pricing-close-button" title="关闭" to="/">
        <X aria-hidden="true" />
      </Link>

      <section aria-labelledby="pricing-title" className="pricing-hero">
        <h1 id="pricing-title">定价方案</h1>
      </section>

      <section aria-label="套餐功能" className="pricing-plan-grid">
        {plans.map((plan) => {
          const isBasicPlan = plan.name === "基础版";
          const isProfessionalPlan = plan.name === "专业版";

          return <article className="pricing-plan-card" key={plan.name}>
            <header className="pricing-plan-heading">
              <h2>{plan.name}</h2>
            </header>

            <p className="pricing-plan-description">{plan.description}</p>

            <div className="pricing-plan-action">
              <button
                className="pricing-plan-button"
                disabled={isProfessionalPlan && professionalApplicationMutation.isPending}
                type="button"
                onClick={() => {
                  if (isBasicPlan) {
                    if (authStatus === "anonymous") requestRegistration();
                    else if (authStatus === "authenticated") {
                      setNoticeMessage(user?.account_plan === "professional"
                        ? "当前帐号已经是专业版套餐"
                        : "当前帐号已经是基础版套餐");
                    }
                  } else if (isProfessionalPlan) {
                    if (authStatus === "anonymous") {
                      requestRegistration();
                    } else if (authStatus === "authenticated") {
                      if (user?.account_plan === "professional") {
                        setNoticeMessage("当前帐号已经是专业版套餐");
                      } else if (user?.professional_application_status === "pending") {
                        setNoticeMessage("专业版申请正在审核中，请耐心等待。");
                      } else {
                        professionalApplicationMutation.mutate();
                      }
                    }
                  }
                }}
              >
                <span>{isProfessionalPlan && professionalApplicationMutation.isPending ? "正在提交…" : plan.actionLabel}</span>
                <ChevronRight aria-hidden="true" />
              </button>
            </div>

            <div className="pricing-quota-grid">
              {plan.quotas.map((quota) => (
                <div className="pricing-quota-item" key={quota}>
                  <Check aria-hidden="true" />
                  <span>{quota}</span>
                </div>
              ))}
            </div>

            <div className="pricing-feature-section">
              <ul>
                {plan.features.map((feature) => (
                  <li className={feature.unavailable ? "is-unavailable" : undefined} key={feature.label}>
                    {feature.unavailable ? <Minus aria-hidden="true" /> : <Check aria-hidden="true" />}
                    <span>{feature.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </article>;
        })}
      </section>

      <ErrorNoticeModal
        closeLabel="关闭提示"
        message={noticeMessage}
        messageClassName="text-base"
        title="提示"
        onOpenChange={(isOpen) => {
          if (!isOpen) setNoticeMessage("");
        }}
      />

    </div>
  );
}
