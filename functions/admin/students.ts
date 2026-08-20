import { verifyAdminToken, getClientIp, SECURITY_HEADERS } from "../_utils/security.js";
import { initDb, logAudit, ensureInitialized } from "../_utils/db-service.js";
import { query, queryOne } from "../../db/index.js";

export const onRequest = async (context: any) => { const req = context.request;
  initDb(context.env?.DATABASE_URL);
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
    const url = new URL(req.url);

    // GET - List & search students
    if (req.method === "GET") {
      const search = url.searchParams.get("search")?.trim() || "";
      const className = url.searchParams.get("class")?.trim() || "";
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const pageSize = Math.min(100, Math.max(10, parseInt(url.searchParams.get("pageSize") || "30", 10)));
      const offset = (page - 1) * pageSize;

      let whereSql = "";
      let params: any[] = [];
      if (className && search) {
        whereSql = "WHERE class_name = $1 AND (name ILIKE $2 OR student_id ILIKE $2 OR class_name ILIKE $2)";
        params = [className, `%${search}%`];
      } else if (className) {
        whereSql = "WHERE class_name = $1";
        params = [className];
      } else if (search) {
        whereSql = "WHERE name ILIKE $1 OR student_id ILIKE $1 OR class_name ILIKE $1";
        params = [`%${search}%`];
      }

      const countResult = await queryOne<{ count: string }>(`SELECT count(*) as count FROM students ${whereSql}`, params);
      const total = Number(countResult?.count || 0);

      const rows = await query<any>(`SELECT * FROM students ${whereSql} ORDER BY class_name, name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, pageSize, offset]);

      const students = rows.map((r: any) => {
        let courses = [];
        try { courses = JSON.parse(r.courses_json || "[]"); } catch {}
        return {
          id: r.id, studentId: r.student_id, name: r.name, className: r.class_name,
          password: r.password, courses, queryEnabled: r.query_enabled, updatedAt: r.updated_at,
        };
      });

      return new Response(JSON.stringify({ ok: true, total, page, pageSize, students }), { status: 200, headers: SECURITY_HEADERS });
    }

    // POST - Create or Update student
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { id, studentId, name, className, password, courses, queryEnabled } = body;
      if (!studentId || !name || !className) {
        return new Response(JSON.stringify({ ok: false, message: "学号、姓名、班级为必填项" }), { status: 400, headers: SECURITY_HEADERS });
      }
      const targetId = id || `${className}_${name}_${studentId}`;
      const coursesJson = JSON.stringify(courses || []);
      const pw = String(password || "20060101").trim();

      await query(
        `INSERT INTO students (id, student_id, name, class_name, password, courses_json, query_enabled, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET
           student_id = EXCLUDED.student_id, name = EXCLUDED.name, class_name = EXCLUDED.class_name,
           password = EXCLUDED.password, courses_json = EXCLUDED.courses_json,
           query_enabled = EXCLUDED.query_enabled, updated_at = CURRENT_TIMESTAMP`,
        [targetId, String(studentId).trim(), String(name).trim(), String(className).trim(), pw, coursesJson, queryEnabled !== false]
      );

      await logAudit({ ip: clientIp, action: "UPDATE_STUDENT", target: `${className} ${name}`, status: "SUCCESS", details: `Saved ${name} (${studentId})`, userAgent });
      return new Response(JSON.stringify({ ok: true, message: "学生信息保存成功" }), { status: 200, headers: SECURITY_HEADERS });
    }

    // DELETE - Delete student
    if (req.method === "DELETE") {
      const body = await req.json().catch(() => ({}));
      const { id } = body;
      if (!id) {
        return new Response(JSON.stringify({ ok: false, message: "缺少学生ID" }), { status: 400, headers: SECURITY_HEADERS });
      }
      await query("DELETE FROM students WHERE id = $1", [id]);
      await logAudit({ ip: clientIp, action: "DELETE_STUDENT", target: id, status: "SUCCESS", details: `Deleted ${id}`, userAgent });
      return new Response(JSON.stringify({ ok: true, message: "学生记录已删除" }), { status: 200, headers: SECURITY_HEADERS });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: SECURITY_HEADERS });
  } catch (err: any) {
    console.error("Admin student error:", err);
    return new Response(JSON.stringify({ ok: false, message: "学生管理操作失败" }), { status: 500, headers: SECURITY_HEADERS });
  }
};
