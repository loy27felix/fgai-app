import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { query } from "@/lib/local/db";
import { hashPassword, verifyPassword } from "@/lib/local/password";
import type { LocalUser } from "@/lib/local/types";

export const SESSION_COOKIE = "fg_session";
const SESSION_DAYS = 30;

function sessionExpiry() {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

export async function createAccount(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await query<{ id: string }>("select id from app_users where email = $1", [normalizedEmail]);
  if (existing.rowCount) throw new Error("该邮箱已经注册");
  const result = await query<LocalUser>(
    "insert into app_users (email, password_hash, email_verified_at) values ($1, $2, now()) returning id, email, created_at",
    [normalizedEmail, hashPassword(password)],
  );
  const user = result.rows[0];
  await query("insert into profiles (id, email) values ($1, $2)", [user.id, user.email]);
  await createSession(user.id);
  return user;
}

export async function signIn(email: string, password: string) {
  const result = await query<LocalUser & { password_hash: string }>("select id, email, password_hash, created_at from app_users where email = $1", [email.trim().toLowerCase()]);
  const user = result.rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) throw new Error("邮箱或密码不正确");
  await createSession(user.id);
  return { id: user.id, email: user.email, created_at: user.created_at };
}

export async function createSession(userId: string) {
  const id = randomBytes(32).toString("hex");
  const expiresAt = sessionExpiry();
  await query("insert into sessions (id, user_id, expires_at) values ($1, $2, $3)", [id, userId, expiresAt]);
  cookies().set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.SESSION_COOKIE_SECURE !== "false",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSession() {
  const sessionId = cookies().get(SESSION_COOKIE)?.value;
  if (sessionId) await query("delete from sessions where id = $1", [sessionId]);
  cookies().delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<LocalUser | null> {
  const sessionId = cookies().get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  const result = await query<LocalUser>(
    `select u.id, u.email, p.platform_role, u.created_at
     from sessions s
     join app_users u on u.id = s.user_id
     left join profiles p on p.id = u.id
     where s.id = $1 and s.expires_at > now()` ,
    [sessionId],
  );
  return result.rows[0] || null;
}
