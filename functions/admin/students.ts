import { eq, like, or, and, sql } from "drizzle-orm";

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

    const url = new URL(req.url);

    // 1. GET /api/admin/students - List & search students
    if (req.method === "GET") {
      const search = url.searchParams.get("search")?.trim() || "";
      const className = url.searchParams.get("class")?.trim() || "";
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const pageSize = Math.min(100, Math.max(10, parseInt(url.searchParams.get("pageSize") || "30", 10)));
      const offset = (page - 1) * pageSize;

      let conditions: any[] = [];
      if (className) {
        conditions.push(eq(schema.students.className, className));
      }
      if (search) {
        conditions.push(
          or(
            like(schema.students.name, `%${search}%`),
            like(schema.students.studentId, `%${search}%`),
            like(schema.students.className, `%${search}%`)
          )
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const totalResult = await db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(schema.students)
        .where(whereClause);
      const total = Number(totalResult[0]?.count || 0);

      const rows = await db
        .select()
        .from(schema.students)
        .where(whereClause)
        .limit(pageSize)
        .offset(offset);

      const students = rows.map((r: any) => {
        let courses = [];
        try {
          courses = JSON.parse(r.coursesJson);
        } catch {}
        return {
          id: r.id,
          studentId: r.studentId,
          name: r.name,
          className: r.className,
          password: r.password, // Admin can view/edit password for support
          courses,
          queryEnabled: r.queryEnabled,
          updatedAt: r.updatedAt,
        };
      });

      return new Response(
        JSON.stringify({
          ok: true,
          total,
          page,
          pageSize,
          students,
        }),
        { status: 200, headers: SECURITY_HEADERS }
      );
    }

    // 2. POST /api/admin/students - Create or Update student
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { id, studentId, name, className, password, courses, queryEnabled } = body;

      if (!studentId || !name || !className) {
        return new Response(
          JSON.stringify({ ok: false, message: "学号、姓名、班级为必填项" }),
          { status: 400, headers: SECURITY_HEADERS }
        );
      }

      const targetId = id || `${className}_${name}_${studentId}`;
      const coursesJson = JSON.stringify(courses || []);
      const pw = String(password || "20060101").trim();

      await db
        .insert(schema.students)
        .values({
          id: targetId,
          studentId: String(studentId).trim(),
          name: String(name).trim(),
          className: String(className).trim(),
          password: pw,
          coursesJson,
          queryEnabled: queryEnabled !== false,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.students.id,
          set: {
            studentId: String(studentId).trim(),
            name: String(name).trim(),
            className: String(className).trim(),
            password: pw,
            coursesJson,
            queryEnabled: queryEnabled !== false,
            updatedAt: new Date(),
          },
        });

      await logAudit({
        ip: clientIp,
        action: "UPDATE_STUDENT",
        target: `${className} ${name}`,
        status: "SUCCESS",
        details: `Saved student record for ${name} (${studentId})`,
        userAgent,
      });

      return new Response(
        JSON.stringify({ ok: true, message: "学生信息保存成功" }),
        { status: 200, headers: SECURITY_HEADERS }
      );
    }

    // 3. DELETE /api/admin/students - Delete student
    if (req.method === "DELETE") {
      const body = await req.json().catch(() => ({}));
      const { id } = body;

      if (!id) {
        return new Response(JSON.stringify({ ok: false, message: "缺少学生ID" }), {
          status: 400,
          headers: SECURITY_HEADERS,
        });
      }

      await db.delete(schema.students).where(eq(schema.students.id, id));

      await logAudit({
        ip: clientIp,
        action: "DELETE_STUDENT",
        target: id,
        status: "SUCCESS",
        details: `Deleted student ${id}`,
        userAgent,
      });

      return new Response(
        JSON.stringify({ ok: true, message: "学生记录已删除" }),
        { status: 200, headers: SECURITY_HEADERS }
      );
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: SECURITY_HEADERS,
    });
  } catch (err: any) {
    console.error("Admin student management error:", err);
    return new Response(
      JSON.stringify({ ok: false, message: "学生管理操作失败" }),
      { status: 500, headers: SECURITY_HEADERS }
    );
  }
};

