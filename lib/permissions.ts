import type { UserRole } from "@/lib/types";

export function canEditCases(role: UserRole) {
  return role === "admin" || role === "editor";
}

export function canManageSystem(role: UserRole) {
  return role === "admin";
}

export function userRoleLabel(role: UserRole) {
  if (role === "admin") return "系统管理员";
  if (role === "editor") return "用例编辑员";
  return "只读查看者";
}
