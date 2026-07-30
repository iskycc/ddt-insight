export type CellValue = string | number | boolean | null;

export type CaseData = Record<string, CellValue>;

export interface CaseListItem {
  caseId: string;
  srNum: string;
  updatedAt: string;
  sourceName: string;
}

export interface ImportResult {
  fileName: string;
  imported: number;
  inserted: number;
  updated: number;
  srNums: number;
  durationMs: number;
}

export interface DashboardStats {
  totalCases: number;
  totalGroups: number;
  totalFiles: number;
  importedToday: number;
  updatedToday: number;
  groups: Array<{ srNum: string; count: number }>;
  timeline: Array<{ date: string; count: number }>;
  recentImports: Array<{
    id: string;
    fileName: string;
    rowCount: number;
    importedAt: string;
  }>;
}

export type UserRole = "admin" | "editor";
export type UserProvider = "local" | "ldap";

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  provider: UserProvider;
  role: UserRole;
  enabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  userId: string;
  username: string;
  displayName: string;
  provider: UserProvider;
  role: UserRole;
  expiresAt: number;
}

export interface LdapConfigPublic {
  enabled: boolean;
  url: string;
  bindDn: string;
  hasBindPassword: boolean;
  userBaseDn: string;
  userFilter: string;
  displayNameAttribute: string;
  defaultRole: UserRole;
  tlsRejectUnauthorized: boolean;
  connectTimeoutMs: number;
  updatedAt: string | null;
  updatedBy: string;
}

export interface AuditLogItem {
  id: number;
  actorUsername: string;
  actorProvider: string;
  action: string;
  resourceType: string;
  resourceId: string;
  result: "success" | "failure";
  ipAddress: string;
  userAgent: string;
  detail: Record<string, unknown>;
  createdAt: string;
}
