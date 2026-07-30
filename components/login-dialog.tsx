"use client";

import { ArrowRight, Eye, EyeOff, LockKeyhole, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

export function LoginDialog({ authenticated }: { authenticated: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    document.body.classList.add("modal-open");
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("modal-open");
      triggerRef.current?.focus();
    };
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "登录失败");
      router.push("/workspace");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "登录失败",
      );
      setSubmitting(false);
    }
  }

  if (authenticated) {
    return (
      <Link className="button button-primary button-small" href="/workspace">
        进入工作台
        <ArrowRight size={15} />
      </Link>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        className="button button-dark button-small"
        type="button"
        onClick={() => setOpen(true)}
      >
        管理员登录
        <ArrowRight size={15} />
      </button>

      {portalReady &&
        open &&
        createPortal(
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) setOpen(false);
            }}
          >
            <section
              className="login-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="login-title"
            >
              <button
                className="icon-button modal-close"
                type="button"
                aria-label="关闭"
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>

              <div className="login-icon">
                <LockKeyhole size={24} />
              </div>
              <span className="eyebrow">安全访问</span>
              <h2 id="login-title">欢迎回来</h2>
              <p>登录后即可导入、编辑和导出用例数据。</p>

              <form onSubmit={submit}>
                <label>
                  <span>用户名</span>
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    placeholder="请输入用户名"
                    required
                    autoFocus
                  />
                </label>
                <label>
                  <span>密码</span>
                  <span className="password-input">
                    <input
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="请输入密码"
                      required
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </span>
                </label>

                {error && <div className="form-error">{error}</div>}

                <button
                  className="button button-primary login-submit"
                  type="submit"
                  disabled={submitting}
                >
                  {submitting ? "正在验证…" : "登录工作台"}
                  {!submitting && <ArrowRight size={17} />}
                </button>
              </form>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
