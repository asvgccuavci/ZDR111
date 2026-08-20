// Cloudflare Workers 兼容版本：使用 Web Crypto API 替代 node:crypto，使用 TextEncoder/TextDecoder 替代 Buffer

// Configured Administrator Credentials
export const ADMIN_USERNAME = "张东然";
export const ADMIN_PASSWORD = "FhsigJgajgsigy453483";

// Secret for signing admin session tokens（延迟初始化，兼容 Cloudflare Workers）
let TOKEN_SECRET = "neepu-auto-grade-secret-key-2026-secure-token";

/**
 * 初始化安全配置（从 context.env 读取环境变量）
 */
export function initSecurity(env: { ADMIN_TOKEN_SECRET?: string }) {
  if (env.ADMIN_TOKEN_SECRET) {
    TOKEN_SECRET = env.ADMIN_TOKEN_SECRET;
  }
}

export interface AdminSession {
  username: string;
  role: "admin";
  iat: number;
  exp: number;
}

// ========== Web Crypto API 工具函数 ==========

const te = new TextEncoder();
const td = new TextDecoder();

/** 将字符串或二进制数据转为 base64url 编码 */
function toB64Url(data: string | ArrayBuffer | Uint8Array): string {
  let bytes: Uint8Array;
  if (typeof data === "string") {
    bytes = te.encode(data);
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else {
    bytes = new Uint8Array(data);
  }
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 将 base64url 字符串解码为 Uint8Array */
function fromB64Url(str: string): Uint8Array {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/** 使用 HMAC-SHA256 签名，返回 base64url 编码的签名 */
async function hmacSign(key: string, data: string): Promise<string> {
  const ck = await crypto.subtle.importKey(
    "raw",
    te.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", ck, te.encode(data));
  return toB64Url(sig);
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const ba = te.encode(a);
  const bb = te.encode(b);
  if (ba.length !== bb.length) {
    return false;
  }
  let r = 0;
  for (let i = 0; i < ba.length; i++) {
    r |= ba[i] ^ bb[i];
  }
  return r === 0;
}

/**
 * Generate a signed session token for admin
 */
export async function createAdminToken(username: string): Promise<string> {
  const payload: AdminSession = {
    username,
    role: "admin",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 2 * 60 * 60, // 2 hours
  };
  const payloadB64 = toB64Url(JSON.stringify(payload));
  const signature = await hmacSign(TOKEN_SECRET, payloadB64);
  return `${payloadB64}.${signature}`;
}

/**
 * Verify and parse admin session token
 */
export async function verifyAdminToken(token: string | null | undefined): Promise<AdminSession | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  const expectedSignature = await hmacSign(TOKEN_SECRET, payloadB64);
  if (!timingSafeCompare(signature, expectedSignature)) {
    return null;
  }
  try {
    const payloadBytes = fromB64Url(payloadB64);
    const payloadJson = td.decode(payloadBytes);
    const session: AdminSession = JSON.parse(payloadJson);
    if (session.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    if (session.username !== ADMIN_USERNAME || session.role !== "admin") {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

/**
 * Extract client IP from request headers
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "127.0.0.1";
}

/**
 * Standard security headers
 */
export const SECURITY_HEADERS = {
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};
