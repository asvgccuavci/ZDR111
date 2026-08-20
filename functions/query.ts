import crypto from "node:crypto";
import { eq, and } from "drizzle-orm";
import {
  initDb,
  getDb,
  getSetting,
  logAudit,
  checkRateLimit,
  recordFailedAttempt,
  resetFailedAttempts,
  ensureInitialized,
} from "./_utils/db-service.js";
import * as schema from "../db/schema.js";
import { getClientIp, timingSafeCompare, SECURITY_HEADERS } from "./_utils/security.js";


export const onRequest = async (context: any) => { const req = context.request;
  // 初始化数据库连接（从 context.env 获取环境变量，兼容 Cloudflare Pages Functions）
  initDb(context.env.DATABASE_URL);

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: SECURITY_HEADERS,
    });
  }
  const clientIp = getClientIp(req);
  const userAgent = req.headers.get("user-agent") || "unknown";
  try {
    await ensureInitialized();
    // 1. Check IP rate-limiting & anti-brute-force
    const rateLimit = await checkRateLimit(clientIp);
    if (rateLimit.isBlocked) {
      await logAudit({
        ip: clientIp,
        action: "STUDENT_QUERY",
        status: "RATE_LIMITED",
        details: `IP blocked for excessive attempts. Remaining seconds: ${rateLimit.remainingLockoutSeconds}`,
        userAgent,
      });
      return new Response(
        JSON.stringify({
          ok: false,
          code: "RATE_LIMITED",
          message: `请求过于频繁或尝试密码错误次数过多，请在 ${rateLimit.remainingLockoutSeconds} 秒后再试。`,
          remainingSeconds: rateLimit.remainingLockoutSeconds,
        }),
        { status: 429, headers: SECURITY_HEADERS }
      );
    }
    // 2. Parse request body
    const body = await req.json().catch(() => ({}));
    const className = String(body.className || "").trim();
    const name = String(body.name || "").trim();
    const password = String(body.password || "").trim();
    if (!className || !name || !password) {
      return new Response(
        JSON.stringify({
          ok: false,
          code: "INVALID_INPUT",
          message: "请完整填写班级、姓名和密码（出生年月8位）",
        }),
        { status: 400, headers: SECURITY_HEADERS }
      );
    }
    // Input sanity checks
    if (className.length > 30 || name.length > 20 || password.length > 20) {
      return new Response(
        JSON.stringify({
          ok: false,
          code: "INVALID_INPUT",
          message: "输入内容超出允许长度",
        }),
        { status: 400, headers: SECURITY_HEADERS }
      );
    }
    // 3. Check Global Switch (allow_query)
    const allowQuery = await getSetting("allow_query", "true");
    const maintenanceReason = await getSetting(
      "maintenance_reason",
      "系统正在进行成绩复核与安全维护，成绩查询通道暂时关闭。"
    );
    if (allowQuery !== "true") {
      await logAudit({
        ip: clientIp,
        action: "STUDENT_QUERY",
        target: `${className} ${name}`,
        status: "BLOCKED",
        details: "Query blocked by administrator global toggle",
        userAgent,
      });
      return new Response(
        JSON.stringify({
          ok: false,
          code: "QUERY_DISABLED",
          message: maintenanceReason,
        }),
        { status: 403, headers: SECURITY_HEADERS }
      );
    }
    // 4. Check Class-level permission
    const allowedClassesStr = await getSetting("allowed_classes", "ALL");
    if (allowedClassesStr !== "ALL") {
      const allowedList = allowedClassesStr.split(",").map(c => c.trim());
      if (!allowedList.includes(className)) {
        await logAudit({
          ip: clientIp,
          action: "STUDENT_QUERY",
          target: `${className} ${name}`,
          status: "BLOCKED",
          details: `Class ${className} is not in allowed classes list: ${allowedClassesStr}`,
          userAgent,
        });
        return new Response(
          JSON.stringify({
            ok: false,
            code: "CLASS_QUERY_DISABLED",
            message: `班级「${className}」的成绩查询通道暂未开放，请留意学院通知。`,
          }),
          { status: 403, headers: SECURITY_HEADERS }
        );
      }
    }
    // 5. Query student in database
    const db = getDb();
    const studentsFound = await db
      .select()
      .from(schema.students)
      .where(and(eq(schema.students.className, className), eq(schema.students.name, name)))
      .limit(1);
    if (studentsFound.length === 0) {
      await recordFailedAttempt(clientIp);
      await logAudit({
        ip: clientIp,
        action: "STUDENT_QUERY",
        target: `${className} ${name}`,
        status: "NOT_FOUND",
        details: "Student record not found in specified class",
        userAgent,
      });
      return new Response(
        JSON.stringify({
          ok: false,
          code: "NOT_FOUND",
          message: "未找到该学生，请确认输入的班级和姓名是否完全正确。",
        }),
        { status: 404, headers: SECURITY_HEADERS }
      );
    }
    const student = studentsFound[0];
    // 6. Check individual student query lock
    if (!student.queryEnabled) {
      await logAudit({
        ip: clientIp,
        action: "STUDENT_QUERY",
        target: `${className} ${name}`,
        status: "BLOCKED",
        details: "Student query individual lock enabled by admin",
        userAgent,
      });
      return new Response(
        JSON.stringify({
          ok: false,
          code: "STUDENT_LOCKED",
          message: "该学生的成绩信息已被锁定或处于单独审核状态，请联系辅导员或教务老师。",
        }),
        { status: 403, headers: SECURITY_HEADERS }
      );
    }
    // 7. Verify password with timing-safe comparison
    const isPwCorrect = timingSafeCompare(student.password, password);
    if (!isPwCorrect) {
      await recordFailedAttempt(clientIp);
      await logAudit({
        ip: clientIp,
        action: "STUDENT_QUERY",
        target: `${className} ${name}`,
        status: "FAILED_PASSWORD",
        details: "Password verification failed",
        userAgent,
      });
      return new Response(
        JSON.stringify({
          ok: false,
          code: "WRONG_PASSWORD",
          message: "密码错误，请确认出生年月（8位数字，如20060119）。",
        }),
        { status: 401, headers: SECURITY_HEADERS }
      );
    }
    // 8. Password matches! Reset failed attempts for this IP
    await resetFailedAttempts(clientIp);
    // Parse courses
    let courses: any[] = [];
    try {
      courses = JSON.parse(student.coursesJson);
    } catch {
      courses = [];
    }
    const timestamp = new Date().toISOString();
    // Digital verification code generated using HMAC of student ID + timestamp
    const verificationCode = crypto
      .createHmac("sha256", "neepu-auto-grade-verify-2026")
      .update(`${student.studentId}_${timestamp}`)
      .digest("hex")
      .slice(0, 16)
      .toUpperCase();
    // Mask student ID for privacy display (e.g. 2023303010113 -> 20233030***13)
    const rawId = student.studentId;
    const maskedId = rawId.length > 6 ? `${rawId.slice(0, 7)}****${rawId.slice(-2)}` : rawId;
    await logAudit({
      ip: clientIp,
      action: "STUDENT_QUERY",
      target: `${className} ${name}`,
      status: "SUCCESS",
      details: `Successful query. Returned ${courses.length} courses.`,
      userAgent,
    });
    return new Response(
      JSON.stringify({
        ok: true,
        student: {
          name: student.name,
          className: student.className,
          studentId: rawId,
          maskedStudentId: maskedId,
          courses,
          queryTimestamp: timestamp,
          verificationCode,
        },
      }),
      { status: 200, headers: SECURITY_HEADERS }
    );
  } catch (err: any) {
    console.error("Student query execution error:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        code: "SERVER_ERROR",
        message: "服务器查询异常，请稍后重试。",
      }),
      { status: 500, headers: SECURITY_HEADERS }
    );
  }
};
