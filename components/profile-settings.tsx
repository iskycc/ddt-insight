"use client";

import {
  Activity,
  AtSign,
  CalendarDays,
  Clock3,
  Globe2,
  LoaderCircle,
  Mail,
  Save,
  ShieldCheck,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import type {
  ApiCallStatistics,
  UserRecord,
} from "@/lib/types";
import { displayInitial } from "@/lib/display-text";
import { ldapGroupLabel } from "@/lib/ldap-group";

type ProfileResponse = UserRecord & {
  authenticated: true;
  apiStats: ApiCallStatistics;
};

const countFormatter = new Intl.NumberFormat("zh-CN");

function formattedCount(value: number | undefined) {
  return countFormatter.format(value ?? 0);
}

async function responseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

function localDate(value: string | null) {
  if (!value) return "暂无记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ProfileSettings({
  onProfileUpdated,
  onToast,
}: {
  onProfileUpdated: (profile: ProfileResponse) => void;
  onToast: (message: string) => void;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const applyProfile = useCallback((next: ProfileResponse) => {
    setProfile(next);
    setDisplayName(next.displayName);
    setEmail(next.email);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (response.status === 401) {
        router.push("/");
        router.refresh();
        return;
      }
      if (!response.ok) {
        throw new Error(await responseError(response, "读取个人资料失败"));
      }
      applyProfile((await response.json()) as ProfileResponse);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "读取个人资料失败",
      );
    } finally {
      setLoading(false);
    }
  }, [applyProfile, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!profile || profile.provider === "ldap") return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, email }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "保存个人资料失败"));
      }
      const next = (await response.json()) as ProfileResponse;
      applyProfile(next);
      onProfileUpdated(next);
      onToast("个人资料已更新");
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "保存个人资料失败",
      );
    } finally {
      setSaving(false);
    }
  }

  const stats = profile?.apiStats;

  return (
    <div className="workspace-page admin-page profile-page">
      <div className="workspace-page-heading">
        <div>
          <span className="eyebrow">MY ACCOUNT</span>
          <h1>个人信息</h1>
          <p>查看账户资料、维护本地个人信息并了解 API 调用情况。</p>
        </div>
        <button
          className="button button-quiet button-small"
          type="button"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? <LoaderCircle className="spin" size={15} /> : <Activity size={15} />}
          刷新数据
        </button>
      </div>

      {error && (
        <div className="admin-alert error">
          <X size={16} />
          <span>{error}</span>
          <button type="button" aria-label="关闭错误提示" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="workspace-stat-grid profile-stat-grid">
        <article>
          <span className="workspace-stat-icon blue">
            <Activity size={19} />
          </span>
          <div>
            <small>平台累计 API 调用</small>
            <strong title={formattedCount(stats?.platformTotal)}>
              {formattedCount(stats?.platformTotal)}
            </strong>
          </div>
        </article>
        <article>
          <span className="workspace-stat-icon green">
            <Clock3 size={19} />
          </span>
          <div>
            <small>今日 API 调用</small>
            <strong title={formattedCount(stats?.platformToday)}>
              {formattedCount(stats?.platformToday)}
            </strong>
          </div>
        </article>
        <article>
          <span className="workspace-stat-icon purple">
            <Globe2 size={19} />
          </span>
          <div>
            <small>开放 API 调用</small>
            <strong title={formattedCount(stats?.openTotal)}>
              {formattedCount(stats?.openTotal)}
            </strong>
          </div>
        </article>
        <article>
          <span className="workspace-stat-icon orange">
            <UserRound size={19} />
          </span>
          <div>
            <small>我的认证 API 调用</small>
            <strong title={formattedCount(stats?.currentUserTotal)}>
              {formattedCount(stats?.currentUserTotal)}
            </strong>
          </div>
        </article>
      </div>

      <div className="profile-content-grid">
        <article className="admin-card profile-identity-card">
          <div className="admin-card-heading">
            <div>
              <h2>账户概览</h2>
              <p>角色和登录来源由系统管理员维护。</p>
            </div>
          </div>
          {loading || !profile ? (
            <div className="profile-loading">
              <LoaderCircle className="spin" size={20} />
              正在读取个人资料…
            </div>
          ) : (
            <div className="profile-identity-body">
              <div className="profile-avatar">
                {displayInitial(profile.displayName)}
              </div>
              <div className="profile-primary">
                <strong title={profile.displayName}>
                  {profile.displayName}
                </strong>
                <span>@{profile.username}</span>
                <div>
                  <em className={`provider-pill ${profile.provider}`}>
                    {profile.provider === "local" ? "本地账户" : "LDAP"}
                  </em>
                  <em className="profile-role-pill">
                    {profile.role === "admin" ? "系统管理员" : "用例编辑员"}
                  </em>
                  {profile.isBootstrapAdmin && (
                    <em className="profile-bootstrap-pill">默认管理员</em>
                  )}
                </div>
              </div>
              <dl className="profile-details">
                <div>
                  <dt><AtSign size={14} />用户名</dt>
                  <dd>{profile.username}</dd>
                </div>
                <div>
                  <dt><Mail size={14} />邮箱</dt>
                  <dd>{profile.email || "未设置"}</dd>
                </div>
                <div>
                  <dt><CalendarDays size={14} />创建时间</dt>
                  <dd>{localDate(profile.createdAt)}</dd>
                </div>
                <div>
                  <dt><Clock3 size={14} />最后登录</dt>
                  <dd>{localDate(profile.lastLoginAt)}</dd>
                </div>
              </dl>
              {profile.provider === "ldap" && (
                <div className="profile-groups">
                  <span><UsersRound size={14} />目录 Group</span>
                  <div>
                    {profile.groups.length ? (
                      profile.groups.map((group) => (
                        <em key={group}>{ldapGroupLabel(group)}</em>
                      ))
                    ) : (
                      <small>目录未返回 Group</small>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </article>

        <article className="admin-card profile-edit-card">
          <div className="admin-card-heading">
            <div>
              <h2>基本信息</h2>
              <p>
                {profile?.provider === "ldap"
                  ? "名称和邮箱由 LDAP 目录同步。"
                  : "修改后会立即用于工作台和操作记录。"}
              </p>
            </div>
            <ShieldCheck size={18} />
          </div>
          <form className="admin-form profile-form" onSubmit={save}>
            <label>
              <span>显示名称</span>
              <input
                value={displayName}
                maxLength={128}
                disabled={loading || profile?.provider === "ldap"}
                onChange={(event) => setDisplayName(event.target.value)}
                required
              />
            </label>
            <label>
              <span>邮箱</span>
              <input
                value={email}
                type="email"
                maxLength={320}
                disabled={loading || profile?.provider === "ldap"}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.local"
              />
            </label>
            {profile?.provider === "ldap" && (
              <div className="profile-directory-note">
                LDAP 用户请在目录服务中修改个人资料，下次登录时平台会自动同步。
              </div>
            )}
            <button
              className="button button-primary"
              type="submit"
              disabled={
                loading ||
                saving ||
                !profile ||
                profile.provider === "ldap"
              }
            >
              {saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
              {saving ? "正在保存" : "保存基本信息"}
            </button>
          </form>
        </article>
      </div>

      {stats && (
        <p className="profile-stats-note">
          认证调用仅归属登录后的管理 API；开放 API 保持匿名并计入平台统计。
          最近调用：{localDate(stats.lastCalledAt)}
        </p>
      )}
    </div>
  );
}
