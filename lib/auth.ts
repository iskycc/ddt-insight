import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { authenticateLdapUser } from "@/lib/ldap";
import { getApplicationSecret } from "@/lib/security";
import type { AuthSession, UserRecord } from "@/lib/types";
import {
  authenticateLocalUser,
  findUserById,
  findUserForAuthentication,
  markUserLogin,
} from "@/lib/users";

const COOKIE_NAME = "ddt_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function signatureFor(payload: string) {
  return createHmac("sha256", getApplicationSecret())
    .update(payload)
    .digest("base64url");
}

export async function authenticateCredentials(
  username: string,
  password: string,
) {
  const local = authenticateLocalUser(username, password);
  const user = local ?? (await authenticateLdapUser(username, password));
  if (!user) return null;
  markUserLogin(user.id);
  return findUserById(user.id);
}

export function authenticationProviderFor(username: string) {
  return findUserForAuthentication(username)?.provider ?? "unknown";
}

export function createSessionToken(user: UserRecord) {
  const payload: AuthSession = {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    provider: user.provider,
    role: user.role,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signatureFor(encoded)}`;
}

export function verifySessionToken(token: string | undefined) {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expectedSignature = signatureFor(encoded);
  const received = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as AuthSession;
    if (
      payload.expiresAt <= Date.now() ||
      !payload.userId ||
      !payload.username ||
      !["local", "ldap"].includes(payload.provider) ||
      !["admin", "editor", "viewer"].includes(payload.role)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function getSession() {
  const cookieStore = await cookies();
  const payload = verifySessionToken(cookieStore.get(COOKIE_NAME)?.value);
  if (!payload) return null;

  const user = findUserById(payload.userId);
  if (
    !user?.enabled ||
    user.username !== payload.username ||
    user.provider !== payload.provider ||
    user.role !== payload.role
  ) {
    return null;
  }
  return {
    ...payload,
    displayName: user.displayName,
    email: user.email,
    groups: user.groups,
  };
}

export async function setSessionCookie(user: UserRecord) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, createSessionToken(user), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: 0,
  });
}
