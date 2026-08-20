import { verifyAdminToken, initSecurity, getClientIp, SECURITY_HEADERS } from "../_utils/security.js";
import { initDb, logAudit, ensureInitialized } from "../_utils/db-service.js";
import { query, queryOne } from "../../db/index.js";

export const onRequest = async (context: any) => {
  const req = context.request;
  // 初始化数据库连接和安全配置
  initDb(context.env?.DATABASE_URL);
  initSecurity({
    ADMIN_USERNAME: context.env.ADMIN_USERNAME,
    ADMIN_PASSWORD: context.env.ADMIN_PASSWORD,
    ADMIN_TOKEN_SECRET: context.env.ADMIN_TOKEN_SECRET,
  });
  const clientIp = getClientIp(req);
  const userAgent = req.headers.get("user-agent") || "unknown";

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "") || "";
  const session = await verifyAdminToken(token);
  if (!session) {
    return new Response(JSON.stringify({ ok: false, message: "未授权或登录已过期" }), { status: 401, headers: SECURITY_HEADERS });
  }

  try {
    await ensureInitialized();

    // GET - Retrieve logs & stats
    if (req.method === "GET") {
      const url = new URL(req.url);
      const limit = Math.min(200, Math.max(10, parseInt(url.searchParams.get("limit") || "50", 10)));
      const statusFilter = url.searchParams.get("status") || "";

      let whereSql = "";
      let params: any[] = [];
      if (statusFilter) {
        whereSql = "WHERE status = $1";
        params = [statusFilter];
      }

      const logs = await query<any>(
        `SELECT * FROM audit_logs ${whereSql} ORDER BY timestamp DESC LIMIT $${params.length + 1}`,
        [...params, limit]
      );

      const totalLogs = Number((await queryOne<{ count: string }>("SELECT count(*) as count FROM audit_logs"))?.count || 0);
      const successCount = Number((await queryOne<{ count: string }>("SELECT count(*) as count FROM audit_logs WHERE status = 'SUCCESS'"))?.count || 0);
      const failedCount = Number((await queryOne<{ count: string }>("SELECT count(*) as count FROM audit_logs WHERE status = 'FAILED_PASSWORD'"))?.count || 0);
      const blockedCount = Number((await queryOne<{ count: string }>("SELECT count(*) as count FROM audit_logs WHERE status = 'BLOCKED'"))?.count || 0);
      const rateLimitedCount = Number((await queryOne<{ count: string }>("SELECT count(*) as count FROM audit_logs WHERE status = 'RATE_LIMITED'"))?.count || 0);

      return new Response(JSON.stringify({
        ok: true,
        stats: {
          totalQueries: totalLogs, successCount, failedCount, blockedCount, rateLimitedCount,
          successRate: totalLogs > 0 ? `${((successCount / totalLogs) * 100).toFixed(1)}%` : "100%",
        },
        logs,
      }), { status: 200, headers: SECURITY_HEADERS });
    }

    // POST - Clear logs or unblock IPs
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.action === "clear_logs") {
        await query("DELETE FROM audit_logs");
        await logAudit({ ip: clientIp, action: "CLEAR_LOGS", target: "AuditLogs", status: "SUCCESS", details: "Admin cleared logs", userAgent });
        return new Response(JSON.stringify({ ok: true, message: "审计日志已清空" }), { status: 200, headers: SECURITY_HEADERS });
      }
      if (body.action === "unblock_all_ips") {
        await query("DELETE FROM ip_rate_limits");
        await logAudit({ ip: clientIp, action: "UNBLOCK_IPS", target: "IpRateLimits", status: "SUCCESS", details: "Admin unblocked all IPs", userAgent });
        return new Response(JSON.stringify({ ok: true, message: "所有IP封锁已解除" }), { status: 200, headers: SECURITY_HEADERS });
      }
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: SECURITY_HEADERS });
  } catch (err: any) {
    console.error("Admin logs error:", err);
    return new Response(JSON.stringify({ ok: false, message: "日志获取异常" }), { status: 500, headers: SECURITY_HEADERS });
  }
};
