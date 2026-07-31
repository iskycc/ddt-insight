import { Client, type Entry } from "ldapts";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/security";
import type {
  LdapConfigPublic,
  UserRecord,
  UserRole,
} from "@/lib/types";
import {
  findUserForAuthentication,
  upsertLdapUser,
} from "@/lib/users";

interface LdapConfigRow {
  enabled: number;
  url: string;
  bind_dn: string;
  bind_password_encrypted: string;
  user_base_dn: string;
  user_filter: string;
  display_name_attribute: string;
  mail_attribute: string;
  group_attribute: string;
  group_search_base: string;
  group_search_filter: string;
  group_name_attribute: string;
  default_role: UserRole;
  tls_reject_unauthorized: number;
  connect_timeout_ms: number;
  updated_at: string;
  updated_by: string;
}

const defaultConfig = {
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
  defaultRole: "editor" as UserRole,
  tlsRejectUnauthorized: true,
  connectTimeoutMs: 5000,
  updatedAt: null,
  updatedBy: "",
} satisfies LdapConfigPublic;

const implicitTlsPorts = new Set(["636", "3269"]);

function getConfigRow() {
  return db
    .prepare(`
      SELECT enabled, url, bind_dn, bind_password_encrypted, user_base_dn,
             user_filter, display_name_attribute, mail_attribute,
             group_attribute, group_search_base, group_search_filter,
             group_name_attribute, default_role,
             tls_reject_unauthorized, connect_timeout_ms, updated_at, updated_by
      FROM ldap_config WHERE id = 1
    `)
    .get() as LdapConfigRow | undefined;
}

export function getLdapConfig(): LdapConfigPublic {
  const row = getConfigRow();
  if (!row) return defaultConfig;
  return {
    enabled: Boolean(row.enabled),
    url: row.url,
    bindDn: row.bind_dn,
    hasBindPassword: Boolean(row.bind_password_encrypted),
    userBaseDn: row.user_base_dn,
    userFilter: row.user_filter,
    displayNameAttribute: row.display_name_attribute,
    mailAttribute: row.mail_attribute,
    groupAttribute: row.group_attribute,
    groupSearchBase: row.group_search_base,
    groupSearchFilter: row.group_search_filter,
    groupNameAttribute: row.group_name_attribute,
    defaultRole: row.default_role,
    tlsRejectUnauthorized: Boolean(row.tls_reject_unauthorized),
    connectTimeoutMs: row.connect_timeout_ms,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function validateLdapUrl(value: string) {
  if (value.length > 2048) throw new Error("LDAP 服务地址过长");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("LDAP 服务地址格式不正确");
  }
  if (!["ldap:", "ldaps:"].includes(parsed.protocol)) {
    throw new Error("LDAP 服务地址必须使用 ldap:// 或 ldaps://");
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error("LDAP 服务地址不能包含用户名或密码");
  }
  if (
    (parsed.pathname && parsed.pathname !== "/") ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("LDAP 服务地址只能包含协议、主机和端口");
  }
  return parsed;
}

function normalizeLdapUrl(value: string) {
  if (!value) return value;
  const parsed = validateLdapUrl(value);
  if (
    parsed.protocol === "ldap:" &&
    implicitTlsPorts.has(parsed.port)
  ) {
    return value.replace(/^ldap:/i, "ldaps:");
  }
  return value;
}

function validateConfig(input: {
  enabled: boolean;
  url: string;
  userBaseDn: string;
  userFilter: string;
  displayNameAttribute: string;
  mailAttribute: string;
  groupAttribute: string;
  groupSearchBase: string;
  groupSearchFilter: string;
  groupNameAttribute: string;
  defaultRole: UserRole;
  connectTimeoutMs: number;
  bindDn?: string;
  bindPassword?: string;
}) {
  if ((input.bindDn?.length ?? 0) > 2048) throw new Error("Bind DN 过长");
  if ((input.bindPassword?.length ?? 0) > 4096) {
    throw new Error("Bind 密码过长");
  }
  if (input.userBaseDn.length > 2048) throw new Error("用户 Base DN 过长");
  if (input.enabled || input.url) validateLdapUrl(input.url);
  if (input.enabled && !input.userBaseDn.trim()) {
    throw new Error("启用 LDAP 时必须填写用户搜索 Base DN");
  }
  if (!input.userFilter.includes("{{username}}")) {
    throw new Error("用户过滤器必须包含 {{username}} 占位符");
  }
  if (input.userFilter.length > 1024) throw new Error("用户过滤器过长");
  if (input.groupSearchBase.length > 2048) {
    throw new Error("Group Base DN 过长");
  }
  if (input.groupSearchFilter.length > 1024) {
    throw new Error("Group 过滤器过长");
  }
  if (
    input.groupSearchBase &&
    !input.groupSearchFilter.includes("{{userDn}}") &&
    !input.groupSearchFilter.includes("{{username}}")
  ) {
    throw new Error(
      "Group 过滤器必须包含 {{userDn}} 或 {{username}} 占位符",
    );
  }
  const attributes = [
    ["显示名称", input.displayNameAttribute, true],
    ["邮箱", input.mailAttribute, false],
    ["Group", input.groupAttribute, false],
    ["Group 名称", input.groupNameAttribute, Boolean(input.groupSearchBase)],
  ] as const;
  for (const [label, attribute, required] of attributes) {
    if (required && !attribute) throw new Error(`${label}属性不能为空`);
    if (attribute.length > 128) throw new Error(`${label}属性过长`);
    if (attribute && !/^[a-zA-Z][a-zA-Z0-9;-]*$/.test(attribute)) {
      throw new Error(`${label}属性格式不正确`);
    }
  }
  if (!["admin", "editor", "viewer"].includes(input.defaultRole)) {
    throw new Error("默认角色不正确");
  }
  if (
    !Number.isInteger(input.connectTimeoutMs) ||
    input.connectTimeoutMs < 1000 ||
    input.connectTimeoutMs > 30000
  ) {
    throw new Error("连接超时必须在 1000–30000 毫秒之间");
  }
}

export function saveLdapConfig(
  input: {
    enabled: boolean;
    url: string;
    bindDn: string;
    bindPassword?: string;
    clearBindPassword?: boolean;
    userBaseDn: string;
    userFilter: string;
    displayNameAttribute: string;
    mailAttribute: string;
    groupAttribute: string;
    groupSearchBase: string;
    groupSearchFilter: string;
    groupNameAttribute: string;
    defaultRole: UserRole;
    tlsRejectUnauthorized: boolean;
    connectTimeoutMs: number;
  },
  updatedBy: string,
) {
  const normalized = {
    ...input,
    url: normalizeLdapUrl(input.url.trim()),
    bindDn: input.bindDn.trim(),
    userBaseDn: input.userBaseDn.trim(),
    userFilter: input.userFilter.trim(),
    displayNameAttribute: input.displayNameAttribute.trim(),
    mailAttribute: input.mailAttribute.trim(),
    groupAttribute: input.groupAttribute.trim(),
    groupSearchBase: input.groupSearchBase.trim(),
    groupSearchFilter: input.groupSearchFilter.trim(),
    groupNameAttribute: input.groupNameAttribute.trim(),
  };
  validateConfig(normalized);

  const current = getConfigRow();
  let encryptedPassword = current?.bind_password_encrypted ?? "";
  if (input.clearBindPassword) encryptedPassword = "";
  if (input.bindPassword) encryptedPassword = encryptSecret(input.bindPassword);
  if (normalized.bindDn && !encryptedPassword) {
    throw new Error("填写 Bind DN 时必须提供 Bind 密码");
  }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ldap_config (
      id, enabled, url, bind_dn, bind_password_encrypted, user_base_dn,
      user_filter, display_name_attribute, mail_attribute, group_attribute,
      group_search_base, group_search_filter, group_name_attribute, default_role,
      tls_reject_unauthorized, connect_timeout_ms, updated_at, updated_by
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled,
      url = excluded.url,
      bind_dn = excluded.bind_dn,
      bind_password_encrypted = excluded.bind_password_encrypted,
      user_base_dn = excluded.user_base_dn,
      user_filter = excluded.user_filter,
      display_name_attribute = excluded.display_name_attribute,
      mail_attribute = excluded.mail_attribute,
      group_attribute = excluded.group_attribute,
      group_search_base = excluded.group_search_base,
      group_search_filter = excluded.group_search_filter,
      group_name_attribute = excluded.group_name_attribute,
      default_role = excluded.default_role,
      tls_reject_unauthorized = excluded.tls_reject_unauthorized,
      connect_timeout_ms = excluded.connect_timeout_ms,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(
    normalized.enabled ? 1 : 0,
    normalized.url,
    normalized.bindDn,
    encryptedPassword,
    normalized.userBaseDn,
    normalized.userFilter,
    normalized.displayNameAttribute,
    normalized.mailAttribute,
    normalized.groupAttribute,
    normalized.groupSearchBase,
    normalized.groupSearchFilter,
    normalized.groupNameAttribute,
    normalized.defaultRole,
    normalized.tlsRejectUnauthorized ? 1 : 0,
    normalized.connectTimeoutMs,
    now,
    updatedBy,
  );
  return getLdapConfig();
}

function escapeFilterValue(value: string) {
  return value.replace(/[\0()*\\]/g, (character) => {
    const code = character.charCodeAt(0).toString(16).padStart(2, "0");
    return `\\${code}`;
  });
}

function groupSearchFilter(
  template: string,
  input: { username: string; userDn: string },
) {
  return template
    .replaceAll("{{username}}", escapeFilterValue(input.username))
    .replaceAll("{{userDn}}", escapeFilterValue(input.userDn));
}

function privateConfig() {
  const row = getConfigRow();
  if (!row) return null;
  return {
    ...getLdapConfig(),
    bindPassword: decryptSecret(row.bind_password_encrypted),
  };
}

function usesImplicitTls(url: string) {
  const parsed = new URL(url);
  return (
    parsed.protocol === "ldaps:" ||
    (parsed.protocol === "ldap:" && implicitTlsPorts.has(parsed.port))
  );
}

function createClient(config: {
  url: string;
  tlsRejectUnauthorized: boolean;
  connectTimeoutMs: number;
}) {
  return new Client({
    url: config.url,
    timeout: config.connectTimeoutMs,
    connectTimeout: config.connectTimeoutMs,
    ...(usesImplicitTls(config.url)
      ? {
          tlsOptions: {
            minVersion: "TLSv1.2" as const,
            rejectUnauthorized: config.tlsRejectUnauthorized,
          },
        }
      : {}),
  });
}

function ldapConnectionError(error: unknown, url: string) {
  const message = error instanceof Error ? error.message : String(error);
  const bindWasReset =
    /0x60/i.test(message) &&
    /(ECONNRESET|connection closed)/i.test(message);
  if (bindWasReset) {
    const parsed = new URL(url);
    if (parsed.protocol === "ldap:" && !usesImplicitTls(url)) {
      return new Error(
        "LDAP 服务在 Bind 阶段重置了明文连接；目录若要求加密，请改用 ldaps:// 地址和 LDAPS 端口（通常为 636）",
      );
    }
    return new Error(
      "LDAP 服务在 Bind 阶段重置了连接；请检查服务地址、端口、Bind DN 及目录服务器的加密访问策略",
    );
  }
  return error instanceof Error ? error : new Error(message);
}

async function unbindQuietly(client: Client) {
  try {
    await client.unbind();
  } catch {
    // The connection may already have been closed by the directory server.
  }
}

async function bindService(
  client: Client,
  config: { bindDn: string; bindPassword: string },
) {
  if (config.bindDn) {
    await client.bind(config.bindDn, config.bindPassword);
  }
}

function attributeTexts(entry: Entry, attribute: string) {
  if (!attribute) return [];
  const expected = attribute.toLocaleLowerCase("en-US");
  const matches = Object.entries(entry)
    .filter(([key]) => {
      const normalized = key.toLocaleLowerCase("en-US");
      return normalized === expected || normalized.startsWith(`${expected};`);
    })
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]));

  return matches
    .map((value) =>
      Buffer.isBuffer(value) ? value.toString("utf8") : String(value ?? ""),
    )
    .map((value) => value.trim())
    .filter(Boolean);
}

function attributeText(entry: Entry, attribute: string) {
  const values = attributeTexts(entry, attribute);
  return values[0] ?? "";
}

function uniqueAttributes(values: string[]) {
  const unique = new Map<string, string>();
  for (const value of values) {
    const normalized = value.toLocaleLowerCase("en-US");
    if (!unique.has(normalized)) unique.set(normalized, value);
    if (unique.size >= 512) break;
  }
  return [...unique.values()];
}

export async function testLdapConnection() {
  const config = privateConfig();
  if (!config?.url) throw new Error("请先保存 LDAP 服务地址");
  validateConfig(config);

  const client = createClient(config);
  try {
    await bindService(client, config);
    await client.search(config.userBaseDn, {
      scope: "base",
      filter: "(objectClass=*)",
      sizeLimit: 1,
      attributes: ["1.1"],
    });
    if (config.groupSearchBase) {
      await client.search(config.groupSearchBase, {
        scope: "base",
        filter: "(objectClass=*)",
        sizeLimit: 1,
        attributes: ["1.1"],
      });
    }
    return {
      ok: true,
      userBaseValidated: true,
      groupBaseValidated: Boolean(config.groupSearchBase),
    };
  } catch (error) {
    throw ldapConnectionError(error, config.url);
  } finally {
    await unbindQuietly(client);
  }
}

export async function authenticateLdapUser(
  username: string,
  password: string,
): Promise<UserRecord | null> {
  if (!password) return null;
  const existing = findUserForAuthentication(username);
  if (existing?.provider === "local" || (existing && !existing.enabled)) {
    return null;
  }

  const config = privateConfig();
  if (!config?.enabled) return null;
  validateConfig(config);

  const client = createClient(config);
  try {
    await bindService(client, config);
    const filter = config.userFilter.replaceAll(
      "{{username}}",
      escapeFilterValue(username),
    );
    const { searchEntries } = await client.search(config.userBaseDn, {
      scope: "sub",
      filter,
      sizeLimit: 2,
      attributes: [
        ...new Set(
          [
            config.displayNameAttribute,
            config.mailAttribute,
            config.groupSearchBase ? "" : config.groupAttribute,
          ].filter(Boolean),
        ),
      ],
    });
    if (searchEntries.length !== 1) return null;

    const entry = searchEntries[0];
    const directGroups = uniqueAttributes(
      attributeTexts(entry, config.groupAttribute),
    );
    await client.bind(entry.dn, password);

    let groups = directGroups;
    if (config.groupSearchBase) {
      await bindService(client, config);
      const { searchEntries: groupEntries } = await client.search(
        config.groupSearchBase,
        {
          scope: "sub",
          filter: groupSearchFilter(config.groupSearchFilter, {
            username,
            userDn: entry.dn,
          }),
          sizeLimit: 512,
          attributes: [config.groupNameAttribute],
        },
      );
      groups = uniqueAttributes(
        groupEntries.flatMap((group) =>
          attributeTexts(group, config.groupNameAttribute),
        ),
      );
    }

    return upsertLdapUser({
      username,
      displayName: attributeText(entry, config.displayNameAttribute) || username,
      email: attributeText(entry, config.mailAttribute),
      groups,
      defaultRole: config.defaultRole,
    });
  } catch {
    return null;
  } finally {
    await unbindQuietly(client);
  }
}
