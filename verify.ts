import {
  verifyAdminToken,
  initSecurity,
  SECURITY_HEADERS,
} from "../_utils/security.js";
import { ensureInitialized, initDb } from "../_utils/db-service.js";

export const onRequest = async (context: any) => {
  const req = context.request;
  // 初始化数据库连接和安全配置
  initDb(context.env.DATABASE_URL);
  initSecurity({
    ADMIN_USERNAME: context.env.ADMIN_USERNAME,
    ADMIN_PASSWORD: context.env.ADMIN_PASSWORD,
    ADMIN_TOKEN_SECRET: context.env.ADMIN_TOKEN_SECRET,
  });

  try {
    await ensureInitialized();
    if (req.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: SECURITY_HEADERS,
      });
    }
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "") || "";
    const session = await verifyAdminToken(token);
    if (!session) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: SECURITY_HEADERS,
      });
    }
    return new Response(
      JSON.stringify({
        ok: true,
        username: session.username,
        role: session.role,
        expiresAt: new Date(session.exp * 1000).toISOString(),
      }),
      { status: 200, headers: SECURITY_HEADERS }
    );
  } catch (err: any) {
    console.error("Admin verify error:", err);
    return new Response(
      JSON.stringify({ ok: false, message: "认证服务异常" }),
      { status: 500, headers: SECURITY_HEADERS }
    );
  }
};
