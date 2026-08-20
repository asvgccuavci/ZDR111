import { getSetting, ensureInitialized, initDb } from "../_utils/db-service.js";
import { query, queryOne } from "../../db/index.js";
import { SECURITY_HEADERS } from "../_utils/security.js";

export const onRequest = async (context: any) => {
  const req = context.request;

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: SECURITY_HEADERS,
    });
  }

  try {
    initDb(context.env?.DATABASE_URL);
    await ensureInitialized();

    const allowQueryStr = await getSetting("allow_query", "true");
    const announcement = await getSetting("announcement", "2024-2025学年第二学期期末成绩已发布，请输入班级、姓名及出生年月（8位）查询。");
    const maintenanceReason = await getSetting("maintenance_reason", "系统正在进行成绩复核与安全维护，成绩查询通道暂时关闭，请稍后再试。");
    const allowedClassesStr = await getSetting("allowed_classes", "ALL");

    const countResult = await queryOne<{ count: string }>("SELECT count(*) as count FROM students");
    const totalStudents = Number(countResult?.count || 0);

    const classesResult = await query<{ class_name: string }>("SELECT DISTINCT class_name FROM students ORDER BY class_name");
    const classes = classesResult.map(c => c.class_name).sort();

    return new Response(JSON.stringify({
      ok: true,
      allowQuery: allowQueryStr === "true",
      announcement,
      maintenanceReason,
      allowedClasses: allowedClassesStr === "ALL" ? ["ALL"] : allowedClassesStr.split(",").map(s => s.trim()),
      totalStudents,
      classes,
      serverTime: new Date().toISOString(),
    }), { status: 200, headers: SECURITY_HEADERS });
  } catch (err: any) {
    console.error("System status error:", err);
    return new Response(JSON.stringify({
      ok: false,
      error: "Failed to retrieve system status",
      detail: err?.message || String(err),
      allowQuery: true,
    }), { status: 500, headers: SECURITY_HEADERS });
  }
};
