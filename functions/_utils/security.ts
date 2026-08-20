import crypto from "node:crypto";

// Configured Administrator Credentials
export const ADMIN_USERNAME = "张东然";
export const ADMIN_PASSWORD = "FhsigJgajgsigy453483";

// Secret for signing admin session tokens
const TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET || "neepu-auto-grade-secret-key-2026-secure-token";

export interface AdminSession {
  username: string;
  role: "admin";
  iat: number;
  exp: number;
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // compare with self to prevent short-circuiting timing leaks
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generate a signed session token for admin
 */
export function createAdminToken(username: string): string {
  const payload: AdminSession = {
    username,
    role: "admin",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 2 * 60 * 60, // 2 hours
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", TOKEN_SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${signature}`;
}

/**
 * Verify and parse admin session token
 */
export function verifyAdminToken(token: string | null | undefined): AdminSession | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  const expectedSignature = crypto.createHmac("sha256", TOKEN_SECRET).update(payloadB64).digest("base64url");
  if (!timingSafeCompare(signature, expectedSignature)) {
    return null;
  }
  try {
    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
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
