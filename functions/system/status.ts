import { getSetting, ensureInitialized, initDb, getDb } from "../_utils/db-service.js";

import * as schema from "../../db/schema.js";
import { SECURITY_HEADERS } from "../_utils/security.js";
import { sql } from "drizzle-orm";

export const onRequest = async (context: any) => { const req = context.request;
  // 初始化数据库连接（从 context.env 获取环境变量，兼容 Cloudflare Pages Functions）
  initDb(context.env.DATABASE_URL);

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: SECURITY_HEADERS,
    });
  }

  try {
    const db = getDb();
    await ensureInitialized();

    const allowQueryStr = await getSetting("allow_query", "true");
    const announcement = await getSetting("announcement", "2024-2025学年第二学期期末成绩已发布，请输入班级、姓名及出生年月（8位）查询。");
    const maintenanceReason = await getSetting("maintenance_reason", "系统正在进行成绩复核与安全维护，成绩查询通道暂时关闭，请稍后再试。");
    const allowedClassesStr = await getSetting("allowed_classes", "ALL");

    // Fetch total student count and list of classes
    const countResult = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(schema.students);
    const totalStudents = Number(countResult[0]?.count || 0);

    const classesResult = await db
      .selectDistinct({ className: schema.students.className })
      .from(schema.students);
    const classes = classesResult.map(c => c.className).sort();

    const responseData = {
      ok: true,
      allowQuery: allowQueryStr === "true",
      announcement,
      maintenanceReason,
      allowedClasses: allowedClassesStr === "ALL" ? ["ALL"] : allowedClassesStr.split(",").map(s => s.trim()),
      totalStudents,
      classes,
      serverTime: new Date().toISOString(),
    };

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: SECURITY_HEADERS,
    });
  } catch (err: any) {
    console.error("System status error:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Failed to retrieve system status",
        allowQuery: true,
      }),
      { status: 500, headers: SECURITY_HEADERS }
    );
  }
};
