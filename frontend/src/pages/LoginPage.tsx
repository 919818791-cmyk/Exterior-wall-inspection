import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { AuthPanel } from "@/components/auth/AuthModal";
import { HeroVideoPlaylist } from "@/components/HeroVideoPlaylist";
import { useAuthStore } from "@/stores/useAuthStore";

const loginHeroVideos = ["/videos/N3.mp4"];

function safeRedirectPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) return "/";
  return value;
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const authStatus = useAuthStore((state) => state.status);
  const initialMode = searchParams.get("mode") === "register" ? "trial-application" : "login";
  const redirect = safeRedirectPath(searchParams.get("redirect"));
  const passwordChanged = searchParams.get("notice") === "password-changed";

  useEffect(() => {
    if (authStatus === "authenticated") navigate(redirect, { replace: true });
  }, [authStatus, navigate, redirect]);

  const handleAuthenticated = () => {
    queryClient.removeQueries({ queryKey: ["reports"] });
    queryClient.removeQueries({ queryKey: ["current-account-usage"] });
    navigate(redirect, { replace: true });
  };

  return (
    <main className="auth-page">
      <section aria-label="外墙巡检平台介绍" className="auth-page-hero">
        <HeroVideoPlaylist videos={loginHeroVideos} />
        <Link className="auth-page-hero-brand" to="/" aria-label="外墙智能巡检平台首页">
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <span className="brand-name">外墙智能巡检平台</span>
        </Link>
        <div className="auth-page-hero-copy">
          <h1>新用户注册即享<br />免费检测，立即体验</h1>
        </div>
      </section>
      <section aria-label="账号登录与注册" className="auth-page-form-region">
        <Link className="auth-page-home-link" to="/">返回首页</Link>
        <div className="auth-page-form-stack">
          {passwordChanged ? (
            <p className="auth-page-notice" role="status">密码已修改，请使用新密码重新登录。</p>
          ) : null}
          <AuthPanel key={initialMode} initialMode={initialMode} onAuthenticated={handleAuthenticated} />
        </div>
      </section>
    </main>
  );
}
