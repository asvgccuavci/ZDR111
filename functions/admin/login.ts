import {
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  createAdminToken,
  timingSafeCompare,
  getClientIp,
  SECURITY_HEADERS,
} from "../_utils/security.js";
import { logAudit, ensureInitialized, initDb } from "../_utils/db-service.js";

export const onRequest = async (context: any) => { const req = context.request;
  // 初始化数据库连接（从 context.env 获取环境变量，兼容 Cloudflare Pages Functions）
  initDb(context.env.DATABASE_URL);

  const clientIp = getClientIp(req);
  const userAgent = req.headers.get("user-agent") || "unknown";
  try {
    await ensureInitialized();
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: SECURITY_HEADERS,
      });
    }
    const body = await req.json().catch(() => ({}));
    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();
    const isUsernameCorrect = timingSafeCompare(username, ADMIN_USERNAME);
    const isPasswordCorrect = timingSafeCompare(password, ADMIN_PASSWORD);
    if (!isUsernameCorrect || !isPasswordCorrect) {
      await logAudit({
        ip: clientIp,
        action: "ADMIN_LOGIN",
        target: username || "unknown",
        status: "FAILED_PASSWORD",
        details: "Failed admin login attempt",
        userAgent,
      });
      return new Response(
        JSON.stringify({
          ok: false,
          message: "管理员账号或密码错误",
        }),
        { status: 401, headers: SECURITY_HEADERS }
      );
    }
    const token = createAdminToken(username);
    await logAudit({
      ip: clientIp,
      action: "ADMIN_LOGIN",
      target: username,
      status: "SUCCESS",
      details: "Administrator logged in successfully",
      userAgent,
    });
    return new Response(
      JSON.stringify({
        ok: true,
        token,
        username,
        role: "admin",
        message: "管理员登录成功",
      }),
      { status: 200, headers: SECURITY_HEADERS }
    );
  } catch (err: any) {
    console.error("Admin auth error:", err);
    return new Response(
      JSON.stringify({ ok: false, message: "认证服务异常" }),
      { status: 500, headers: SECURITY_HEADERS }
    );
  }
};
