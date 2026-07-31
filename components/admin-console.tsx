"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  CustomCheckbox,
  CustomSelect,
} from "@/components/custom-controls";
import type {
  AuditCategory,
  AuditLogItem,
  LdapConfigPublic,
  UserRecord,
  UserRole,
} from "@/lib/types";
import { displayInitial } from "@/lib/display-text";
import { ldapGroupLabel } from "@/lib/ldap-group";

type ToastHandler = (message: string) => void;
const roleOptions = [
  { value: "editor", label: "编辑员 — 管理用例" },
  { value: "admin", label: "管理员 — 管理用例与系统" },
];
const compactRoleOptions = [
  { value: "admin", label: "管理员" },
  { value: "editor", label: "编辑员" },
];

async function responseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

function localDate(value: string | null) {
  if (!value) return "从未登录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function UserManagement({
  currentUserId,
  onToast,
}: {
  currentUserId: string;
  onToast: ToastHandler;
}) {
  const router = useRouter();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRecord | null>(null);
  const [resetUser, setResetUser] = useState<UserRecord | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserRecord | null>(null);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response, "读取用户失败"));
      const body = (await response.json()) as { items: UserRecord[] };
      setUsers(body.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取用户失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function update(
    user: UserRecord,
    changes: Partial<Pick<UserRecord, "displayName" | "role" | "enabled">>,
  ) {
    setBusyId(user.id);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!response.ok) throw new Error(await responseError(response, "更新用户失败"));
      const next = (await response.json()) as UserRecord;
      setUsers((current) =>
        current.map((item) => (item.id === next.id ? next : item)),
      );
      onToast(`已更新用户 ${next.username}`);
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : "更新用户失败",
      );
    } finally {
      setBusyId("");
    }
  }

  async function remove(user: UserRecord) {
    setBusyId(user.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await responseError(response, "删除用户失败"));
      setUsers((current) => current.filter((item) => item.id !== user.id));
      setDeleteUser(null);
      onToast(`已删除用户 ${user.username}`);
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : "删除用户失败",
      );
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="workspace-page admin-page">
      <div className="workspace-page-heading">
        <div>
          <span className="eyebrow">IDENTITY & ACCESS</span>
          <h1>用户管理</h1>
          <p>管理本地与 LDAP 用户的角色、状态和登录权限。</p>
        </div>
        <button
          className="button button-primary"
          type="button"
          onClick={() => setCreateOpen(true)}
        >
          <Plus size={16} />
          新建本地用户
        </button>
      </div>

      <div className="admin-summary-grid">
        <article>
          <span className="admin-summary-icon blue">
            <Users size={19} />
          </span>
          <p>
            <small>全部用户</small>
            <strong>{users.length}</strong>
          </p>
        </article>
        <article>
          <span className="admin-summary-icon green">
            <ShieldCheck size={19} />
          </span>
          <p>
            <small>启用账户</small>
            <strong>{users.filter((user) => user.enabled).length}</strong>
          </p>
        </article>
        <article>
          <span className="admin-summary-icon purple">
            <Network size={19} />
          </span>
          <p>
            <small>LDAP 用户</small>
            <strong>{users.filter((user) => user.provider === "ldap").length}</strong>
          </p>
        </article>
      </div>

      {error && (
        <div className="admin-alert error">
          <CircleAlert size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}

      <article className="admin-card">
        <div className="admin-card-heading">
          <div>
            <h2>账户目录</h2>
            <p>LDAP 用户首次成功登录后会自动出现在这里。</p>
          </div>
          <button
            className="button button-quiet button-small"
            type="button"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className={loading ? "spin" : ""} size={14} />
            刷新
          </button>
        </div>

        <div className="admin-table user-table">
          <div className="admin-table-head">
            <span>用户</span>
            <span>目录信息</span>
            <span>来源</span>
            <span>角色</span>
            <span>最后登录</span>
            <span>状态</span>
            <span>操作</span>
          </div>
          {loading ? (
            <div className="admin-table-empty">
              <LoaderCircle className="spin" size={20} />
              正在读取账户目录…
            </div>
          ) : users.length ? (
            users.map((user) => (
              <div className="admin-table-row" key={user.id}>
                <span className="user-identity">
                  <i>{displayInitial(user.displayName)}</i>
                  <p>
                    <strong>
                      {user.displayName}
                      {user.id === currentUserId && <em>当前用户</em>}
                      {user.isBootstrapAdmin && <em>默认管理员</em>}
                    </strong>
                    <small>{user.username}</small>
                  </p>
                </span>
                <span className="directory-profile">
                  {user.provider === "ldap" ? (
                    <>
                      <strong title={user.email || "LDAP 未返回邮箱"}>
                        {user.email || "未获取 mail"}
                      </strong>
                      <small
                        title={user.groups.map(ldapGroupLabel).join("\n")}
                      >
                        {user.groups.length
                          ? `${user.groups
                              .slice(0, 2)
                              .map(ldapGroupLabel)
                              .join(" · ")}${
                              user.groups.length > 2
                                ? ` 等 ${user.groups.length} 个 Group`
                                : ""
                            }`
                          : "未获取 Group"}
                      </small>
                    </>
                  ) : (
                    <>
                      <strong>本地账户</strong>
                      <small>不从目录同步属性</small>
                    </>
                  )}
                </span>
                <span>
                  <em className={`provider-pill ${user.provider}`}>
                    {user.provider === "local" ? "本地" : "LDAP"}
                  </em>
                </span>
                <span>
                  <CustomSelect
                    value={user.role}
                    ariaLabel={`修改 ${user.username} 的角色`}
                    disabled={
                      busyId === user.id ||
                      user.id === currentUserId ||
                      user.isBootstrapAdmin
                    }
                    options={compactRoleOptions}
                    onChange={(value) =>
                      void update(user, {
                        role: value as UserRole,
                      })
                    }
                  />
                </span>
                <span className="admin-muted">{localDate(user.lastLoginAt)}</span>
                <span>
                  <button
                    className={`status-switch ${user.enabled ? "enabled" : ""}`}
                    type="button"
                    role="switch"
                    aria-checked={user.enabled}
                    disabled={
                      busyId === user.id ||
                      user.id === currentUserId ||
                      user.isBootstrapAdmin
                    }
                    onClick={() => void update(user, { enabled: !user.enabled })}
                  >
                    <i />
                    {user.enabled ? "已启用" : "已停用"}
                  </button>
                </span>
                <span className="admin-row-actions">
                  <button
                    className="icon-button"
                    type="button"
                    title="修改显示名称"
                    aria-label={`修改 ${user.username} 的显示名称`}
                    disabled={busyId === user.id}
                    onClick={() => setEditUser(user)}
                  >
                    <Pencil size={15} />
                  </button>
                  {user.provider === "local" && (
                    <button
                      className="icon-button"
                      type="button"
                      title="重置密码"
                      aria-label={`重置 ${user.username} 的密码`}
                      disabled={busyId === user.id}
                      onClick={() => setResetUser(user)}
                    >
                      <KeyRound size={15} />
                    </button>
                  )}
                  <button
                    className="icon-button danger"
                    type="button"
                    title={
                      user.isBootstrapAdmin
                        ? "默认管理员不能删除"
                        : "删除用户"
                    }
                    aria-label={`删除用户 ${user.username}`}
                    disabled={
                      busyId === user.id ||
                      user.id === currentUserId ||
                      user.isBootstrapAdmin
                    }
                    onClick={() => setDeleteUser(user)}
                  >
                    <Trash2 size={15} />
                  </button>
                </span>
              </div>
            ))
          ) : (
            <div className="admin-table-empty">暂无用户</div>
          )}
        </div>
      </article>

      {createOpen && (
        <UserDialog
          mode="create"
          onClose={() => setCreateOpen(false)}
          onComplete={(user) => {
            setUsers((current) => [...current, user]);
            setCreateOpen(false);
            onToast(`已创建用户 ${user.username}`);
          }}
        />
      )}

      {editUser && (
        <UserDialog
          mode="edit"
          user={editUser}
          onClose={() => setEditUser(null)}
          onComplete={(user) => {
            setUsers((current) =>
              current.map((item) => (item.id === user.id ? user : item)),
            );
            setEditUser(null);
            if (user.id === currentUserId) router.refresh();
            onToast(`已更新 ${user.username} 的显示名称`);
          }}
        />
      )}

      {resetUser && (
        <UserDialog
          mode="reset"
          user={resetUser}
          onClose={() => setResetUser(null)}
          onComplete={(user) => {
            setUsers((current) =>
              current.map((item) => (item.id === user.id ? user : item)),
            );
            setResetUser(null);
            onToast(`已重置 ${user.username} 的密码`);
          }}
        />
      )}

      {deleteUser && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (
              !busyId &&
              event.currentTarget === event.target
            ) {
              setDeleteUser(null);
            }
          }}
        >
          <section
            className="case-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="user-delete-title"
            aria-describedby="user-delete-description"
          >
            <span className="case-delete-icon">
              <Trash2 size={22} />
            </span>
            <h2 id="user-delete-title">删除这个用户？</h2>
            <p id="user-delete-description">
              用户 <strong>{deleteUser.username}</strong> 将被永久删除，
              其现有会话会立即失效。本次操作不可撤销，并会写入审计日志。
            </p>
            <div>
              <button
                className="button button-quiet"
                type="button"
                disabled={busyId === deleteUser.id}
                onClick={() => setDeleteUser(null)}
              >
                取消
              </button>
              <button
                className="button button-danger"
                type="button"
                disabled={busyId === deleteUser.id}
                onClick={() => void remove(deleteUser)}
              >
                {busyId === deleteUser.id ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Trash2 size={16} />
                )}
                {busyId === deleteUser.id ? "正在删除" : "确认删除"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function UserDialog({
  mode,
  user,
  onClose,
  onComplete,
}: {
  mode: "create" | "edit" | "reset";
  user?: UserRecord;
  onClose: () => void;
  onComplete: (user: UserRecord) => void;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [role, setRole] = useState<UserRole>("editor");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(
        mode === "create" ? "/api/admin/users" : `/api/admin/users/${user!.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "create"
              ? { username, displayName, role, password }
              : mode === "edit"
                ? { displayName }
                : { password },
          ),
        },
      );
      if (!response.ok) {
        throw new Error(
          await responseError(
            response,
            mode === "create"
              ? "创建用户失败"
              : mode === "edit"
                ? "修改显示名称失败"
                : "重置密码失败",
          ),
        );
      }
      onComplete((await response.json()) as UserRecord);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "操作失败",
      );
      setSubmitting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (!submitting && event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="admin-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-dialog-title"
      >
        <button
          className="icon-button modal-close"
          type="button"
          disabled={submitting}
          aria-label="关闭"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <span className="admin-modal-icon">
          {mode === "create" ? (
            <UserRound size={22} />
          ) : mode === "edit" ? (
            <Pencil size={22} />
          ) : (
            <KeyRound size={22} />
          )}
        </span>
        <h2 id="user-dialog-title">
          {mode === "create"
            ? "新建本地用户"
            : mode === "edit"
              ? `修改 ${user?.username} 的显示名称`
              : `重置 ${user?.username} 的密码`}
        </h2>
        <p>
          {mode === "create"
            ? "创建后用户可立即登录工作台。"
            : mode === "edit"
              ? "用户名保持不变，新的显示名称会用于工作台和操作记录。"
              : "新密码保存后立即生效，旧密码将不可使用。"}
        </p>

        <form className="admin-form" onSubmit={submit}>
          {mode === "create" && (
            <>
              <div className="form-grid two">
                <label>
                  <span>用户名</span>
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="off"
                    placeholder="例如 zhangsan"
                    required
                    autoFocus
                  />
                </label>
                <label>
                  <span>显示名称</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="例如 张三"
                  />
                </label>
              </div>
              <div className="admin-field">
                <span>角色</span>
                <CustomSelect
                  value={role}
                  ariaLabel="选择用户角色"
                  options={roleOptions}
                  onChange={(value) => setRole(value as UserRole)}
                />
              </div>
            </>
          )}
          {mode === "edit" && (
            <label>
              <span>显示名称</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={user?.username}
                maxLength={128}
                required
                autoFocus
              />
            </label>
          )}
          {mode !== "edit" && (
            <label>
              <span>{mode === "create" ? "初始密码" : "新密码"}</span>
              <span className="password-input">
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="至少 8 个字符"
                  minLength={8}
                  required
                  autoFocus={mode === "reset"}
                />
                <button
                  type="button"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
          )}

          {error && <div className="form-error">{error}</div>}

          <div className="admin-modal-actions">
            <button
              className="button button-quiet"
              type="button"
              disabled={submitting}
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="button button-primary"
              type="submit"
              disabled={submitting}
            >
              {submitting ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
              {submitting ? "正在保存" : "确认保存"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

const emptyLdapConfig: LdapConfigPublic = {
  enabled: false,
  url: "",
  bindDn: "",
  hasBindPassword: false,
  userBaseDn: "",
  userFilter: "(uid={{username}})",
  displayNameAttribute: "displayName",
  mailAttribute: "mail",
  groupAttribute: "memberOf",
  groupSearchBase: "",
  groupSearchFilter: "(member={{userDn}})",
  groupNameAttribute: "cn",
  defaultRole: "editor",
  tlsRejectUnauthorized: true,
  connectTimeoutMs: 5000,
  updatedAt: null,
  updatedBy: "",
};

export function LdapSettings({ onToast }: { onToast: ToastHandler }) {
  const [config, setConfig] = useState<LdapConfigPublic>(emptyLdapConfig);
  const [bindPassword, setBindPassword] = useState("");
  const [clearBindPassword, setClearBindPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/ldap", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await responseError(response, "读取 LDAP 配置失败"));
      }
      setConfig((await response.json()) as LdapConfigPublic);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "读取 LDAP 配置失败",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function field<K extends keyof LdapConfigPublic>(
    key: K,
    value: LdapConfigPublic[K],
  ) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  async function save(showToast = true) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/ldap", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...config,
          bindPassword: bindPassword || undefined,
          clearBindPassword,
        }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "保存 LDAP 配置失败"));
      }
      const next = (await response.json()) as LdapConfigPublic;
      setConfig(next);
      setBindPassword("");
      setClearBindPassword(false);
      if (showToast) onToast("LDAP 配置已保存");
      return true;
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "保存 LDAP 配置失败",
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    if (!(await save(false))) return;
    setTesting(true);
    setError("");
    try {
      const response = await fetch("/api/admin/ldap/test", { method: "POST" });
      if (!response.ok) {
        throw new Error(await responseError(response, "LDAP 连接测试失败"));
      }
      onToast(
        config.groupSearchBase
          ? "LDAP 连接、用户与 Group Base DN 验证成功"
          : "LDAP 连接与用户 Base DN 验证成功",
      );
    } catch (testError) {
      setError(
        testError instanceof Error ? testError.message : "LDAP 连接测试失败",
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="workspace-page admin-page ldap-page">
      <div className="workspace-page-heading">
        <div>
          <span className="eyebrow">DIRECTORY SERVICE</span>
          <h1>LDAP 目录服务</h1>
          <p>连接内网 LDAP 或 Active Directory，首次登录时自动创建平台用户。</p>
        </div>
        <span className={`ldap-state ${config.enabled ? "enabled" : ""}`}>
          <i />
          {config.enabled ? "已启用" : "未启用"}
        </span>
      </div>

      {error && (
        <div className="admin-alert error">
          <CircleAlert size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}

      <article className="admin-card ldap-card">
        <div className="admin-card-heading">
          <div>
            <h2>连接与认证</h2>
            <p>配置仅保存在本机数据库，绑定密码使用本机密钥加密。</p>
          </div>
          {loading && <LoaderCircle className="spin" size={18} />}
        </div>

        <div className="ldap-enable-row">
          <span className="admin-summary-icon purple">
            <Network size={20} />
          </span>
          <p>
            <strong>允许 LDAP 登录</strong>
            <small>本地管理员账户始终保留，可用于目录服务故障恢复。</small>
          </p>
          <button
            className={`toggle-control ${config.enabled ? "enabled" : ""}`}
            type="button"
            role="switch"
            aria-checked={config.enabled}
            disabled={loading}
            onClick={() => field("enabled", !config.enabled)}
          >
            <i />
          </button>
        </div>

        <div className="admin-form ldap-form">
          <div className="form-section-heading">
            <span>01</span>
            <div>
              <strong>服务器</strong>
              <small>推荐生产环境使用 LDAPS 和受信任证书。</small>
            </div>
          </div>
          <div className="form-grid two">
            <label>
              <span>LDAP 服务地址</span>
              <input
                value={config.url}
                onChange={(event) => field("url", event.target.value)}
                placeholder="ldaps://ldap.example.local:636"
              />
              <small>
                389 通常使用 ldap://；636 和 AD 全局编录 3269
                会按 LDAPS 处理并自动规范地址。
              </small>
            </label>
            <label>
              <span>连接超时（毫秒）</span>
              <input
                value={config.connectTimeoutMs}
                type="number"
                min={1000}
                max={30000}
                step={500}
                onChange={(event) =>
                  field("connectTimeoutMs", Number(event.target.value))
                }
              />
            </label>
          </div>
          <CustomCheckbox
            checked={config.tlsRejectUnauthorized}
            label="校验 TLS 服务器证书"
            description="仅在使用自签名证书且已评估风险时关闭。"
            onChange={(checked) => field("tlsRejectUnauthorized", checked)}
          />

          <div className="form-section-heading">
            <span>02</span>
            <div>
              <strong>服务账户</strong>
              <small>用于搜索用户 DN；留空表示匿名搜索。</small>
            </div>
          </div>
          <div className="form-grid two">
            <label>
              <span>Bind DN</span>
              <input
                value={config.bindDn}
                onChange={(event) => field("bindDn", event.target.value)}
                autoComplete="off"
                placeholder="cn=service,ou=system,dc=example,dc=local"
              />
            </label>
            <label>
              <span>
                Bind 密码
                {config.hasBindPassword && <em>已安全保存</em>}
              </span>
              <input
                value={bindPassword}
                onChange={(event) => setBindPassword(event.target.value)}
                type="password"
                autoComplete="new-password"
                placeholder={config.hasBindPassword ? "留空则保持不变" : "请输入绑定密码"}
              />
            </label>
          </div>
          {config.hasBindPassword && (
            <CustomCheckbox
              checked={clearBindPassword}
              compact
              label="清除已保存的 Bind 密码"
              onChange={setClearBindPassword}
            />
          )}

          <div className="form-section-heading">
            <span>03</span>
            <div>
              <strong>用户检索与纳管</strong>
              <small>过滤器中的用户名会按 RFC 4515 安全转义。</small>
            </div>
          </div>
          <label>
            <span>用户 Base DN</span>
            <input
              value={config.userBaseDn}
              onChange={(event) => field("userBaseDn", event.target.value)}
              placeholder="ou=users,dc=example,dc=local"
            />
          </label>
          <div className="form-grid two">
            <label>
              <span>用户过滤器</span>
              <input
                value={config.userFilter}
                onChange={(event) => field("userFilter", event.target.value)}
                placeholder="(&(objectClass=person)(uid={{username}}))"
              />
              <small>必须包含 {"{{username}}"} 占位符</small>
            </label>
            <label>
              <span>显示名称属性</span>
              <input
                value={config.displayNameAttribute}
                onChange={(event) =>
                  field("displayNameAttribute", event.target.value)
                }
                placeholder="displayName"
              />
            </label>
          </div>
          <div className="form-grid two">
            <label>
              <span>邮箱属性</span>
              <input
                value={config.mailAttribute}
                onChange={(event) =>
                  field("mailAttribute", event.target.value)
                }
                placeholder="mail"
              />
              <small>留空则不读取邮箱；常见属性为 mail。</small>
            </label>
            <div className="admin-field">
              <span>新 LDAP 用户默认角色</span>
              <CustomSelect
                value={config.defaultRole}
                ariaLabel="选择新 LDAP 用户默认角色"
                options={roleOptions}
                onChange={(value) =>
                  field("defaultRole", value as UserRole)
                }
              />
            </div>
          </div>

          <div className="form-section-heading">
            <span>04</span>
            <div>
              <strong>Group 检索与展示</strong>
              <small>
                配置独立检索后只保存 Group 名称，不再展示完整 OU/CN 路径。
              </small>
            </div>
          </div>
          <label>
            <span>Group Search Base</span>
            <input
              value={config.groupSearchBase}
              onChange={(event) =>
                field("groupSearchBase", event.target.value)
              }
              placeholder="ou=groups,dc=example,dc=local"
            />
            <small>留空时使用下方用户 Group 属性兼容读取。</small>
          </label>
          <div className="form-grid two">
            <label>
              <span>Group Search Filter</span>
              <input
                value={config.groupSearchFilter}
                onChange={(event) =>
                  field("groupSearchFilter", event.target.value)
                }
                placeholder="(&(objectClass=group)(member={{userDn}}))"
              />
              <small>
                必须包含 {"{{userDn}}"} 或 {"{{username}}"} 占位符。
              </small>
            </label>
            <label>
              <span>Group 名称属性</span>
              <input
                value={config.groupNameAttribute}
                onChange={(event) =>
                  field("groupNameAttribute", event.target.value)
                }
                placeholder="cn"
              />
              <small>查询结果中用于展示和同步的属性，通常为 cn。</small>
            </label>
          </div>
          <label>
            <span>用户 Group 属性（兼容模式）</span>
            <input
              value={config.groupAttribute}
              onChange={(event) =>
                field("groupAttribute", event.target.value)
              }
              placeholder="memberOf"
            />
            <small>
              未设置 Group Search Base 时读取用户条目的多值属性；AD 通常为 memberOf。
            </small>
          </label>
        </div>

        <div className="ldap-actions">
          <p>
            {config.updatedAt
              ? `上次由 ${config.updatedBy || "管理员"} 更新于 ${localDate(config.updatedAt)}`
              : "尚未保存 LDAP 配置"}
          </p>
          <div>
            <button
              className="button button-quiet"
              type="button"
              disabled={saving || testing || loading}
              onClick={() => void test()}
            >
              {testing ? <LoaderCircle className="spin" size={15} /> : <Network size={15} />}
              {testing ? "正在测试" : "保存并测试"}
            </button>
            <button
              className="button button-primary"
              type="button"
              disabled={saving || testing || loading}
              onClick={() => void save()}
            >
              {saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
              {saving ? "正在保存" : "保存配置"}
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

const actionLabels: Record<string, string> = {
  "auth.login": "用户登录",
  "auth.logout": "退出登录",
  "case.import": "导入用例",
  "case.update": "修改用例",
  "case.delete": "删除用例",
  "case.export": "导出用例",
  "user.create": "创建用户",
  "user.update": "更新用户",
  "user.password": "重置密码",
  "user.delete": "删除用户",
  "ldap.update": "修改 LDAP",
  "ldap.test": "测试 LDAP",
};

const auditCategoryLabels: Record<AuditCategory, string> = {
  auth: "身份认证",
  case: "用例操作",
  user: "用户管理",
  ldap: "LDAP 配置",
  system: "系统事件",
};

export function AuditLogView() {
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [action, setAction] = useState("");
  const [result, setResult] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedDetails, setExpandedDetails] = useState<Set<number>>(
    () => new Set(),
  );
  const limit = 50;

  const parameters = useMemo(() => {
    const value = new URLSearchParams({
      query,
      category,
      action,
      result,
      limit: String(limit),
      offset: String(offset),
    });
    return value.toString();
  }, [action, category, offset, query, result]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/audit?${parameters}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "读取审计日志失败"));
      }
      const body = (await response.json()) as {
        items: AuditLogItem[];
        hasMore: boolean;
      };
      setItems(body.items);
      setHasMore(body.hasMore);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "读取审计日志失败",
      );
    } finally {
      setLoading(false);
    }
  }, [parameters]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 160);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="workspace-page admin-page audit-page">
      <div className="workspace-page-heading">
        <div>
          <span className="eyebrow">SECURITY AUDIT</span>
          <h1>审计日志</h1>
          <p>追踪登录、用例删除、导出和系统配置变更；用例内容变动在详情页独立留存。</p>
        </div>
        <button
          className="button button-quiet"
          type="button"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw className={loading ? "spin" : ""} size={15} />
          刷新日志
        </button>
      </div>

      {error && (
        <div className="admin-alert error">
          <CircleAlert size={16} />
          <span>{error}</span>
        </div>
      )}

      <article className="admin-card audit-card">
        <div className="audit-filters">
          <label className="audit-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setOffset(0);
              }}
              placeholder="搜索人员、资源、操作、IP 或事件详情"
            />
          </label>
          <CustomSelect
            value={category}
            ariaLabel="审计分类"
            options={[
              { value: "", label: "全部分类" },
              ...Object.entries(auditCategoryLabels).map(
                ([value, label]) => ({ value, label }),
              ),
            ]}
            onChange={(value) => {
              setCategory(value);
              setOffset(0);
            }}
          />
          <CustomSelect
            value={action}
            ariaLabel="操作类型"
            options={[
              { value: "", label: "全部操作" },
              ...Object.entries(actionLabels).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
            onChange={(value) => {
              setAction(value);
              setOffset(0);
            }}
          />
          <CustomSelect
            value={result}
            ariaLabel="操作结果"
            options={[
              { value: "", label: "全部结果" },
              { value: "success", label: "成功" },
              { value: "failure", label: "失败" },
            ]}
            onChange={(value) => {
              setResult(value);
              setOffset(0);
            }}
          />
        </div>

        <div className="admin-table audit-table">
          <div className="admin-table-head">
            <span>时间</span>
            <span>操作者</span>
            <span>操作</span>
            <span>资源</span>
            <span>来源 IP</span>
            <span>结果</span>
          </div>
          {loading ? (
            <div className="admin-table-empty">
              <LoaderCircle className="spin" size={20} />
              正在查询审计日志…
            </div>
          ) : items.length ? (
            items.map((item) => (
              <div className="admin-table-row audit-row" key={item.id}>
                <span className="admin-muted">{localDate(item.createdAt)}</span>
                <span className="audit-actor">
                  <strong>{item.actorUsername}</strong>
                  <small>{item.actorProvider || "—"}</small>
                </span>
                <span>
                  <strong>{actionLabels[item.action] ?? item.action}</strong>
                  <small>
                    {auditCategoryLabels[item.category]} · {item.action}
                  </small>
                </span>
                <span className="audit-resource">
                  <strong>{item.resourceType}</strong>
                  <small title={item.resourceId}>{item.resourceId || "—"}</small>
                </span>
                <span className="admin-muted">{item.ipAddress || "—"}</span>
                <span>
                  <em className={`result-pill ${item.result}`}>
                    {item.result === "success" ? (
                      <Check size={11} />
                    ) : (
                      <CircleAlert size={11} />
                    )}
                    {item.result === "success" ? "成功" : "失败"}
                  </em>
                </span>
                {Object.keys(item.detail).length > 0 && (
                  <div className="audit-detail">
                    <button
                      className="audit-detail-toggle"
                      type="button"
                      aria-expanded={expandedDetails.has(item.id)}
                      onClick={() =>
                        setExpandedDetails((current) => {
                          const next = new Set(current);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        })
                      }
                    >
                      {expandedDetails.has(item.id)
                        ? "收起事件详情"
                        : "查看事件详情"}
                      <ChevronRight size={12} />
                    </button>
                    {expandedDetails.has(item.id) && (
                      <pre>{JSON.stringify(item.detail, null, 2)}</pre>
                    )}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="admin-table-empty">没有符合筛选条件的日志</div>
          )}
        </div>

        <div className="audit-pagination">
          <span>
            第 {Math.floor(offset / limit) + 1} 页 · 每页最多 {limit} 条
          </span>
          <div>
            <button
              className="button button-quiet button-small"
              type="button"
              disabled={offset === 0 || loading}
              onClick={() => setOffset((current) => Math.max(0, current - limit))}
            >
              <ChevronLeft size={14} />
              上一页
            </button>
            <button
              className="button button-quiet button-small"
              type="button"
              disabled={!hasMore || loading}
              onClick={() => setOffset((current) => current + limit)}
            >
              下一页
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}
