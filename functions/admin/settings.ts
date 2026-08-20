import { verifyAdminToken, getClientIp, SECURITY_HEADERS } from "../_utils/security.js";

import { getSetting, setSetting, logAudit, ensureInitialized, initDb } from "../_utils/db-service.js";

export const onRequest = async (context: any) => { const req = context.request;
  // 初始化数据库连接（从 context.env 获取环境变量，兼容 Cloudflare Pages Functions）
  initDb(context.env.DATABASE_URL);

  const clientIp = getClientIp(req);
  const userAgent = req.headers.get("user-agent") || "unknown";

  // Verify Admin authorization
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "") || "";
  const session = verifyAdminToken(token);

  if (!session) {
    return new Response(JSON.stringify({ ok: false, message: "未授权或登录已过期" }), {
      status: 401,
      headers: SECURITY_HEADERS,
    });
  }

  try {
    await ensureInitialized();

    // GET /api/admin/settings - Read current settings
    if (req.method === "GET") {
      const allowQuery = await getSetting("allow_query", "true");
      const announcement = await getSetting("announcement", "");
      const maintenanceReason = await getSetting(
        "maintenance_reason",
        "系统正在进行成绩复核与安全维护，成绩查询通道暂时关闭。"
      );
      const allowedClasses = await getSetting("allowed_classes", "ALL");
      const rateLimitMax = await getSetting("rate_limit_max_attempts", "5");
      const rateLimitLockout = await getSetting("rate_limit_lockout_minutes", "15");

      return new Response(
        JSON.stringify({
          ok: true,
          settings: {
            allowQuery: allowQuery === "true",
            announcement,
            maintenanceReason,
            allowedClasses,
            rateLimitMax: Number(rateLimitMax),
            rateLimitLockout: Number(rateLimitLockout),
          },
        }),
        { status: 200, headers: SECURITY_HEADERS }
      );
    }

    // POST /api/admin/settings - Update settings
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));

      if (typeof body.allowQuery === "boolean") {
        await setSetting("allow_query", body.allowQuery ? "true" : "false");
      }
      if (typeof body.announcement === "string") {
        await setSetting("announcement", body.announcement);
      }
      if (typeof body.maintenanceReason === "string") {
        await setSetting("maintenance_reason", body.maintenanceReason);
      }
      if (typeof body.allowedClasses === "string") {
        await setSetting("allowed_classes", body.allowedClasses);
      }
      if (typeof body.rateLimitMax !== "undefined") {
        await setSetting("rate_limit_max_attempts", String(body.rateLimitMax));
      }
      if (typeof body.rateLimitLockout !== "undefined") {
        await setSetting("rate_limit_lockout_minutes", String(body.rateLimitLockout));
      }

      await logAudit({
        ip: clientIp,
        action: "UPDATE_SETTINGS",
        target: "SystemSettings",
        status: "SUCCESS",
        details: `Updated settings: allowQuery=${body.allowQuery}, allowedClasses=${body.allowedClasses}`,
        userAgent,
      });

      return new Response(
        JSON.stringify({
          ok: true,
          message: "系统设置已更新",
        }),
        { status: 200, headers: SECURITY_HEADERS }
      );
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: SECURITY_HEADERS,
    });
  } catch (err: any) {
    console.error("Admin settings error:", err);
    return new Response(
      JSON.stringify({ ok: false, message: "设置更新失败" }),
      { status: 500, headers: SECURITY_HEADERS }
    );
  }
};

