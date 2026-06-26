const navMenu = document.querySelector(".nav-menu");
const navMenuTrigger = document.querySelector(".nav-menu-trigger");

const refreshLucideIcons = () => {
  if (window.lucide) {
    window.lucide.createIcons({
      attrs: {
        "stroke-width": 2.1,
      },
    });
  }
};

if (navMenu && navMenuTrigger) {
  const setMenuOpen = (open) => {
    navMenu.classList.toggle("is-open", open);
    navMenuTrigger.setAttribute("aria-expanded", String(open));
  };

  navMenu.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") setMenuOpen(true);
  });
  navMenu.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse") setMenuOpen(false);
  });
  navMenu.addEventListener("focusin", () => setMenuOpen(true));
  navMenu.addEventListener("focusout", (event) => {
    if (!navMenu.contains(event.relatedTarget)) {
      setMenuOpen(false);
    }
  });

  navMenuTrigger.addEventListener("click", () => setMenuOpen(true));

  navMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setMenuOpen(false);
      navMenuTrigger.focus();
    }
  });

  navMenu.querySelectorAll(".nav-submenu a").forEach((link) => {
    link.addEventListener("click", () => setMenuOpen(false));
  });

  document.addEventListener("click", (event) => {
    if (!navMenu.contains(event.target)) {
      setMenuOpen(false);
    }
  });
}

const initAuthModal = () => {
  const siteHeader = document.querySelector(".site-header");

  if (!siteHeader) return;
  if (siteHeader.querySelector(".auth-trigger") || document.getElementById("auth-modal")) return;

  const authButton = document.createElement("button");
  authButton.className = "nav-cta auth-trigger";
  authButton.type = "button";
  authButton.setAttribute("aria-haspopup", "dialog");
  authButton.setAttribute("aria-expanded", "false");
  authButton.setAttribute("aria-controls", "auth-modal");
  authButton.innerHTML = '<i data-lucide="user" aria-hidden="true"></i><span>登录</span>';
  siteHeader.appendChild(authButton);

  const authModal = document.createElement("div");
  authModal.className = "auth-modal";
  authModal.id = "auth-modal";
  authModal.hidden = true;
  authModal.innerHTML = `
    <div class="auth-modal-backdrop" data-auth-close></div>
    <section class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button class="auth-close" type="button" data-auth-close aria-label="关闭登录弹窗">
        <i data-lucide="x" aria-hidden="true"></i>
      </button>
      <div class="auth-dialog-heading">
        <h2 id="auth-title">账号登录</h2>
      </div>
      <form class="auth-form" id="auth-login-form" aria-labelledby="auth-title" data-auth-form="login">
        <label class="auth-field">
          <span>手机号</span>
          <input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="请输入手机号" required />
        </label>
        <label class="auth-field">
          <span>密码</span>
          <input name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required />
        </label>
        <label class="auth-check">
          <input type="checkbox" name="remember" />
          <span>保持登录状态</span>
        </label>
        <button class="button primary auth-submit" type="submit">登录</button>
        <p class="auth-status" role="status" aria-live="polite"></p>
        <p class="auth-switch-line">还没有账号？<button type="button" data-auth-switch="register">立即注册</button></p>
      </form>
      <form class="auth-form" id="auth-register-form" aria-labelledby="auth-title" data-auth-form="register" hidden>
        <label class="auth-field">
          <span>姓名</span>
          <input name="name" autocomplete="name" placeholder="请输入姓名" required />
        </label>
        <label class="auth-field">
          <span>手机号</span>
          <input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="请输入手机号" required />
        </label>
        <label class="auth-field">
          <span>设置密码</span>
          <input name="password" type="password" autocomplete="new-password" placeholder="至少 6 位密码" minlength="6" required />
        </label>
        <label class="auth-check">
          <input type="checkbox" name="agreement" required />
          <span>我已阅读并同意平台服务条款</span>
        </label>
        <button class="button primary auth-submit" type="submit">注册账号</button>
        <p class="auth-status" role="status" aria-live="polite"></p>
        <p class="auth-switch-line">已有账号？<button type="button" data-auth-switch="login">返回登录</button></p>
      </form>
    </section>
  `;
  document.body.appendChild(authModal);

  const title = authModal.querySelector("#auth-title");
  const forms = Array.from(authModal.querySelectorAll("[data-auth-form]"));
  let activeMode = "login";
  let lastFocusedElement = null;

  const focusFirstField = () => {
    const activeForm = authModal.querySelector(`[data-auth-form="${activeMode}"]`);
    const firstInput = activeForm?.querySelector("input");
    firstInput?.focus();
  };

  const setMode = (mode, shouldFocus = true) => {
    activeMode = mode;
    const isRegister = mode === "register";

    title.textContent = isRegister ? "账号注册" : "账号登录";

    forms.forEach((form) => {
      const visible = form.dataset.authForm === mode;
      form.hidden = !visible;
      form.querySelector(".auth-status").textContent = "";
    });

    if (shouldFocus) focusFirstField();
  };

  const openModal = () => {
    lastFocusedElement = document.activeElement;
    authModal.hidden = false;
    document.body.classList.add("auth-modal-open");
    authButton.setAttribute("aria-expanded", "true");
    setMode("login", false);

    window.requestAnimationFrame(() => {
      authModal.classList.add("is-open");
      focusFirstField();
    });
  };

  const closeModal = () => {
    authModal.classList.remove("is-open");
    document.body.classList.remove("auth-modal-open");
    authButton.setAttribute("aria-expanded", "false");

    window.setTimeout(() => {
      authModal.hidden = true;
      lastFocusedElement?.focus();
    }, 180);
  };

  authButton.addEventListener("click", openModal);

  authModal.querySelectorAll("[data-auth-close]").forEach((control) => {
    control.addEventListener("click", closeModal);
  });

  authModal.querySelectorAll("[data-auth-switch]").forEach((control) => {
    control.addEventListener("click", () => setMode(control.dataset.authSwitch));
  });

  forms.forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const status = form.querySelector(".auth-status");

      if (form.dataset.authForm === "register") {
        status.textContent = "注册成功，可使用手机号登录。";
        window.setTimeout(() => setMode("login"), 700);
        return;
      }

      status.textContent = "登录成功，欢迎回来。";
      authButton.classList.add("is-authenticated");
      authButton.innerHTML = '<i data-lucide="user-check" aria-hidden="true"></i><span>已登录</span>';
      refreshLucideIcons();
      window.setTimeout(closeModal, 650);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !authModal.hidden) {
      closeModal();
    }
  });
};

initAuthModal();
refreshLucideIcons();
