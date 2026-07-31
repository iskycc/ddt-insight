import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/security";
import type { UserRecord, UserRole } from "@/lib/types";

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  email: string;
  groups_json: string;
  provider: "local" | "ldap";
  role: UserRole;
  enabled: number;
  is_bootstrap_admin: number;
  password_hash: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

function parseGroups(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    groups: parseGroups(row.groups_json),
    provider: row.provider,
    role: row.role,
    enabled: Boolean(row.enabled),
    isBootstrapAdmin: Boolean(row.is_bootstrap_admin),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateUsername(username: string) {
  const value = username.trim();
  if (!value) throw new Error("用户名不能为空");
  if (value.length > 128) throw new Error("用户名不能超过 128 个字符");
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("用户名包含不支持的字符");
  }
  return value;
}

export function validatePassword(password: string) {
  if (password.length < 8) throw new Error("密码至少需要 8 个字符");
  if (password.length > 512) throw new Error("密码不能超过 512 个字符");
}

export function ensureBootstrapAdmin() {
  const username = validateUsername(process.env.ADMIN_USERNAME ?? "admin");
  type BootstrapCandidate = {
    id: string;
    role: UserRole;
    enabled: number;
    is_bootstrap_admin: number;
  };
  const marked = db
    .prepare(`
      SELECT id, role, enabled, is_bootstrap_admin FROM users
      WHERE is_bootstrap_admin = 1
      LIMIT 1
    `)
    .get() as BootstrapCandidate | undefined;
  const candidate =
    marked ??
    (db
      .prepare(`
        SELECT id, role, enabled, is_bootstrap_admin FROM users
        WHERE provider = 'local' AND username = ? COLLATE NOCASE
        LIMIT 1
      `)
      .get(username) as BootstrapCandidate | undefined) ??
    (db
      .prepare(`
        SELECT id, role, enabled, is_bootstrap_admin FROM users
        WHERE provider = 'local'
        ORDER BY created_at, id
        LIMIT 1
      `)
      .get() as BootstrapCandidate | undefined);

  if (candidate) {
    if (
      candidate.role !== "admin" ||
      !candidate.enabled ||
      !candidate.is_bootstrap_admin
    ) {
      db.prepare(`
        UPDATE users
        SET role = 'admin', enabled = 1, is_bootstrap_admin = 1
        WHERE id = ?
      `).run(candidate.id);
    }
    return;
  }

  const password = process.env.ADMIN_PASSWORD ?? "insight-admin";
  validatePassword(password);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (
      id, username, display_name, provider, role, enabled, is_bootstrap_admin,
      password_hash, created_at, updated_at
    ) VALUES (?, ?, ?, 'local', 'admin', 1, 1, ?, ?, ?)
  `).run(randomUUID(), username, username, hashPassword(password), now, now);
}

export function listUsers() {
  ensureBootstrapAdmin();
  return (
    db
      .prepare(`
        SELECT id, username, display_name, email, groups_json,
               provider, role, enabled, is_bootstrap_admin,
               password_hash, last_login_at, created_at, updated_at
        FROM users
        ORDER BY
          CASE role WHEN 'admin' THEN 0 ELSE 1 END,
          username COLLATE NOCASE
      `)
      .all() as UserRow[]
  ).map(toRecord);
}

export function findUserById(id: string) {
  ensureBootstrapAdmin();
  const row = db
    .prepare(`
      SELECT id, username, display_name, email, groups_json,
             provider, role, enabled, is_bootstrap_admin,
             password_hash, last_login_at, created_at, updated_at
      FROM users WHERE id = ? LIMIT 1
    `)
    .get(id) as UserRow | undefined;
  return row ? toRecord(row) : null;
}

export function findUserForAuthentication(username: string) {
  ensureBootstrapAdmin();
  return db
    .prepare(`
      SELECT id, username, display_name, email, groups_json,
             provider, role, enabled, is_bootstrap_admin,
             password_hash, last_login_at, created_at, updated_at
      FROM users WHERE username = ? COLLATE NOCASE LIMIT 1
    `)
    .get(username.trim()) as UserRow | undefined;
}

export function authenticateLocalUser(username: string, password: string) {
  const row = findUserForAuthentication(username);
  if (
    !row ||
    row.provider !== "local" ||
    !row.enabled ||
    !verifyPassword(password, row.password_hash)
  ) {
    return null;
  }
  return toRecord(row);
}

export function createLocalUser(input: {
  username: string;
  displayName?: string;
  password: string;
  role: UserRole;
}) {
  const username = validateUsername(input.username);
  const displayName = input.displayName?.trim() || username;
  if (displayName.length > 128) throw new Error("显示名称不能超过 128 个字符");
  validatePassword(input.password);
  if (!["admin", "editor", "viewer"].includes(input.role)) {
    throw new Error("用户角色不正确");
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    db.prepare(`
      INSERT INTO users (
        id, username, display_name, provider, role, enabled,
        password_hash, created_at, updated_at
      ) VALUES (?, ?, ?, 'local', ?, 1, ?, ?, ?)
    `).run(
      id,
      username,
      displayName,
      input.role,
      hashPassword(input.password),
      now,
      now,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("UNIQUE constraint failed")
    ) {
      throw new Error(`用户名“${username}”已经存在`);
    }
    throw error;
  }
  return findUserById(id)!;
}

export function upsertLdapUser(input: {
  username: string;
  displayName: string;
  email: string;
  groups: string[];
  defaultRole: UserRole;
}) {
  const username = validateUsername(input.username);
  const existing = findUserForAuthentication(username);
  const now = new Date().toISOString();
  const displayName = (input.displayName.trim() || username).slice(0, 128);
  const email = input.email.trim().slice(0, 320);
  const groups = [
    ...new Set(
      input.groups
        .map((group) => group.trim().slice(0, 2048))
        .filter(Boolean),
    ),
  ].slice(0, 512);
  const groupsJson = JSON.stringify(groups);

  if (existing) {
    if (existing.provider !== "ldap") {
      throw new Error("该用户名已被本地账户占用");
    }
    if (!existing.enabled) throw new Error("该账户已被停用");
    db.prepare(`
      UPDATE users
      SET display_name = ?, email = ?, groups_json = ?,
          last_login_at = ?, updated_at = ?
      WHERE id = ?
    `).run(displayName, email, groupsJson, now, now, existing.id);
    return findUserById(existing.id)!;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO users (
      id, username, display_name, email, groups_json,
      provider, role, enabled,
      password_hash, last_login_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'ldap', ?, 1, NULL, ?, ?, ?)
  `).run(
    id,
    username,
    displayName,
    email,
    groupsJson,
    input.defaultRole,
    now,
    now,
    now,
  );
  return findUserById(id)!;
}

function enabledAdminCount() {
  const row = db
    .prepare(`
      SELECT COUNT(*) AS count FROM users
      WHERE role = 'admin' AND enabled = 1
    `)
    .get() as { count: number };
  return row.count;
}

export function updateUser(
  id: string,
  input: {
    displayName?: string;
    role?: UserRole;
    enabled?: boolean;
    password?: string;
  },
) {
  const current = findUserById(id);
  if (!current) throw new Error("用户不存在");

  const displayName =
    input.displayName === undefined
      ? current.displayName
      : input.displayName.trim() || current.username;
  if (displayName.length > 128) throw new Error("显示名称不能超过 128 个字符");
  const role = input.role ?? current.role;
  const enabled = input.enabled ?? current.enabled;
  if (!["admin", "editor", "viewer"].includes(role)) throw new Error("用户角色不正确");
  if (current.isBootstrapAdmin && (role !== "admin" || !enabled)) {
    throw new Error("默认管理员必须保持管理员角色并处于启用状态");
  }

  if (
    current.role === "admin" &&
    current.enabled &&
    (role !== "admin" || !enabled) &&
    enabledAdminCount() <= 1
  ) {
    throw new Error("至少需要保留一个启用的管理员");
  }

  let passwordHash: string | null | undefined;
  if (input.password !== undefined) {
    if (current.provider !== "local") {
      throw new Error("LDAP 用户的密码由目录服务管理");
    }
    validatePassword(input.password);
    passwordHash = hashPassword(input.password);
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE users
    SET display_name = ?, role = ?, enabled = ?,
        password_hash = COALESCE(?, password_hash), updated_at = ?
    WHERE id = ?
  `).run(
    displayName,
    role,
    enabled ? 1 : 0,
    passwordHash ?? null,
    now,
    id,
  );
  return findUserById(id)!;
}

export function updateOwnProfile(
  id: string,
  input: {
    displayName?: string;
    email?: string;
  },
) {
  const current = findUserById(id);
  if (!current) throw new Error("用户不存在");
  if (current.provider === "ldap") {
    throw new Error("LDAP 用户资料由目录服务同步，不能在平台修改");
  }

  const displayName =
    input.displayName === undefined
      ? current.displayName
      : input.displayName.trim();
  if (!displayName) throw new Error("显示名称不能为空");
  if (displayName.length > 128) throw new Error("显示名称不能超过 128 个字符");

  const email =
    input.email === undefined ? current.email : input.email.trim();
  if (email.length > 320) throw new Error("邮箱不能超过 320 个字符");
  if (
    email &&
    (!/^[^\s@]+@[^\s@]+$/.test(email) ||
      /[\u0000-\u001f\u007f]/.test(email))
  ) {
    throw new Error("邮箱格式不正确");
  }

  db.prepare(`
    UPDATE users
    SET display_name = ?, email = ?, updated_at = ?
    WHERE id = ?
  `).run(displayName, email, new Date().toISOString(), id);
  return findUserById(id)!;
}

export function deleteUser(id: string, actorId: string) {
  if (id === actorId) throw new Error("不能删除当前登录账户");
  const current = findUserById(id);
  if (!current) throw new Error("用户不存在");
  if (current.isBootstrapAdmin) {
    throw new Error("默认管理员不能删除");
  }
  if (
    current.role === "admin" &&
    current.enabled &&
    enabledAdminCount() <= 1
  ) {
    throw new Error("至少需要保留一个启用的管理员");
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  return current;
}

export function markUserLogin(id: string) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?
  `).run(now, now, id);
}
