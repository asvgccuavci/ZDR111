import { desc, sql, eq } from "drizzle-orm";

import { verifyAdminToken, getClientIp, SECURITY_HEADERS } from "../_utils/security.js";
import { initDb, getDb, logAudit, ensureInitialized } from "../_utils/db-service.js";
import * as schema from "../../db/schema.js";

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
    const db = getDb();
    await ensureInitialized();

    // 1. GET /api/admin/logs - Retrieve security audit logs & stats
    if (req.method === "GET") {
      const url = new URL(req.url);
      const limit = Math.min(200, Math.max(10, parseInt(url.searchParams.get("limit") || "50", 10)));
      const statusFilter = url.searchParams.get("status") || "";

      let query = db.select().from(schema.auditLogs);
      if (statusFilter) {
        query = query.where(eq(schema.auditLogs.status, statusFilter as any)) as any;
      }
      const logs = await query.orderBy(desc(schema.auditLogs.timestamp)).limit(limit);

      // Compute summary metrics
      const totalLogsResult = await db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(schema.auditLogs);
      const totalLogs = Number(totalLogsResult[0]?.count || 0);

      const successCountResult = await db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.status, "SUCCESS"));
      const successCount = Number(successCountResult[0]?.count || 0);

      const failedCountResult = await db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.status, "FAILED_PASSWORD"));
      const failedCount = Number(failedCountResult[0]?.count || 0);

      const blockedCountResult = await db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.status, "BLOCKED"));
      const blockedCount = Number(blockedCountResult[0]?.count || 0);

      const rateLimitedResult = await db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.status, "RATE_LIMITED"));
      const rateLimitedCount = Number(rateLimitedResult[0]?.count || 0);

      return new Response(
        JSON.stringify({
          ok: true,
          stats: {
            totalQueries: totalLogs,
            successCount,
            failedCount,
            blockedCount,
            rateLimitedCount,
            successRate: totalLogs > 0 ? `${((successCount / totalLogs) * 100).toFixed(1)}%` : "100%",
          },
          logs,
        }),
        { status: 200, headers: SECURITY_HEADERS }
      );
    }

    // 2. POST /api/admin/logs - Clear logs or reset IP limits
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.action === "clear_logs") {
        await db.delete(schema.auditLogs);
        await logAudit({
          ip: clientIp,
          action: "CLEAR_LOGS",
          target: "AuditLogs",
          status: "SUCCESS",
          details: "Administrator cleared audit logs",
          userAgent,
        });

        return new Response(JSON.stringify({ ok: true, message: "审计日志已清空" }), {
          status: 200,
          headers: SECURITY_HEADERS,
        });
      }

      if (body.action === "unblock_all_ips") {
        await db.delete(schema.ipRateLimits);
        await logAudit({
          ip: clientIp,
          action: "UNBLOCK_IPS",
          target: "IpRateLimits",
          status: "SUCCESS",
          details: "Administrator unblocked all rate-limited IPs",
          userAgent,
        });

        return new Response(JSON.stringify({ ok: true, message: "所有IP封锁已解除" }), {
          status: 200,
          headers: SECURITY_HEADERS,
        });
      }
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: SECURITY_HEADERS,
    });
  } catch (err: any) {
    console.error("Admin logs error:", err);
    return new Response(
      JSON.stringify({ ok: false, message: "日志获取异常" }),
      { status: 500, headers: SECURITY_HEADERS }
    );
  }
};

