import {
  initDb,
  getSetting,
  logAudit,
  checkRateLimit,
  recordFailedAttempt,
  resetFailedAttempts,
  ensureInitialized,
} from "./_utils/db-service.js";
import { queryOne } from "../db/index.js";
import { getClientIp, timingSafeCompare, SECURITY_HEADERS } from "./_utils/security.js";

async function hmacSha256Hex(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const ck = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", ck, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export const onRequest = async (context: any) => { const req = context.request;
  initDb(context.env?.DATABASE_URL);

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405, headers: SECURITY_HEADERS });
  }
  const clientIp = getClientIp(req);
  const userAgent = req.headers.get("user-agent") || "unknown";
  try {
    await ensureInitialized();

    const rateLimit = await checkRateLimit(clientIp);
    if (rateLimit.isBlocked) {
      await logAudit({ ip: clientIp, action: "STUDENT_QUERY", status: "RATE_LIMITED", details: `IP blocked, remaining: ${rateLimit.remainingLockoutSeconds}s`, userAgent });
      return new Response(JSON.stringify({ ok: false, code: "RATE_LIMITED", message: `请求过于频繁，请在 ${rateLimit.remainingLockoutSeconds} 秒后再试。`, remainingSeconds: rateLimit.remainingLockoutSeconds }), { status: 429, headers: SECURITY_HEADERS });
    }

    const body = await req.json().catch(() => ({}));
    const className = String(body.className || "").trim();
    const name = String(body.name || "").trim();
    const password = String(body.password || "").trim();
    if (!className || !name || !password) {
      return new Response(JSON.stringify({ ok: false, code: "INVALID_INPUT", message: "请完整填写班级、姓名和密码（出生年月8位）" }), { status: 400, headers: SECURITY_HEADERS });
    }
    if (className.length > 30 || name.length > 20 || password.length > 20) {
      return new Response(JSON.stringify({ ok: false, code: "INVALID_INPUT", message: "输入内容超出允许长度" }), { status: 400, headers: SECURITY_HEADERS });
    }

    const allowQuery = await getSetting("allow_query", "true");
    const maintenanceReason = await getSetting("maintenance_reason", "系统正在进行成绩复核与安全维护，成绩查询通道暂时关闭。");
    if (allowQuery !== "true") {
      await logAudit({ ip: clientIp, action: "STUDENT_QUERY", target: `${className} ${name}`, status: "BLOCKED", details: "Global toggle disabled", userAgent });
      return new Response(JSON.stringify({ ok: false, code: "QUERY_DISABLED", message: maintenanceReason }), { status: 403, headers: SECURITY_HEADERS });
    }

    const allowedClassesStr = await getSetting("allowed_classes", "ALL");
    if (allowedClassesStr !== "ALL") {
      const allowedList = allowedClassesStr.split(",").map(c => c.trim());
      if (!allowedList.includes(className)) {
        await logAudit({ ip: clientIp, action: "STUDENT_QUERY", target: `${className} ${name}`, status: "BLOCKED", details: `Class not allowed: ${className}`, userAgent });
        return new Response(JSON.stringify({ ok: false, code: "CLASS_QUERY_DISABLED", message: `班级「${className}」的成绩查询通道暂未开放。` }), { status: 403, headers: SECURITY_HEADERS });
      }
    }

    const student = await queryOne<any>(
      "SELECT * FROM students WHERE class_name = $1 AND name = $2 LIMIT 1",
      [className, name]
    );
    if (!student) {
      await recordFailedAttempt(clientIp);
      await logAudit({ ip: clientIp, action: "STUDENT_QUERY", target: `${className} ${name}`, status: "NOT_FOUND", details: "Student not found", userAgent });
      return new Response(JSON.stringify({ ok: false, code: "NOT_FOUND", message: "未找到该学生，请确认班级和姓名是否正确。" }), { status: 404, headers: SECURITY_HEADERS });
    }

    if (student.query_enabled === false || student.query_enabled === 0) {
      await logAudit({ ip: clientIp, action: "STUDENT_QUERY", target: `${className} ${name}`, status: "BLOCKED", details: "Individual lock enabled", userAgent });
      return new Response(JSON.stringify({ ok: false, code: "STUDENT_LOCKED", message: "该学生的成绩信息已被锁定，请联系辅导员。" }), { status: 403, headers: SECURITY_HEADERS });
    }

    const isPwCorrect = timingSafeCompare(String(student.password), password);
    if (!isPwCorrect) {
      await recordFailedAttempt(clientIp);
      await logAudit({ ip: clientIp, action: "STUDENT_QUERY", target: `${className} ${name}`, status: "FAILED_PASSWORD", details: "Wrong password", userAgent });
      return new Response(JSON.stringify({ ok: false, code: "WRONG_PASSWORD", message: "密码错误，请确认出生年月（8位数字，如20060119）。" }), { status: 401, headers: SECURITY_HEADERS });
    }

    await resetFailedAttempts(clientIp);
    let courses: any[] = [];
    try { courses = JSON.parse(student.courses_json || "[]"); } catch { courses = []; }
    const timestamp = new Date().toISOString();
    const verificationCode = (await hmacSha256Hex("neepu-auto-grade-verify-2026", `${student.student_id}_${timestamp}`)).slice(0, 16).toUpperCase();
    const rawId = String(student.student_id || "");
    const maskedId = rawId.length > 6 ? `${rawId.slice(0, 7)}****${rawId.slice(-2)}` : rawId;

    await logAudit({ ip: clientIp, action: "STUDENT_QUERY", target: `${className} ${name}`, status: "SUCCESS", details: `Returned ${courses.length} courses`, userAgent });

    return new Response(JSON.stringify({
      ok: true,
      student: { name: student.name, className: student.class_name, studentId: rawId, maskedStudentId: maskedId, courses, queryTimestamp: timestamp, verificationCode },
    }), { status: 200, headers: SECURITY_HEADERS });
  } catch (err: any) {
    console.error("Query error:", err);
    return new Response(JSON.stringify({ ok: false, code: "SERVER_ERROR", message: "服务器查询异常，请稍后重试。" }), { status: 500, headers: SECURITY_HEADERS });
  }
};
