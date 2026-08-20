import { initDb, query, queryOne } from "../../db/index.js";
export { initDb };
import { seedStudents } from "../_data/students-seed.js";

let basicInitDone = false;

async function basicInit() {
  if (basicInitDone) return;
  try {
    await query(`CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL, name TEXT NOT NULL,
      class_name TEXT NOT NULL, password TEXT NOT NULL, courses_json TEXT NOT NULL,
      query_enabled BOOLEAN DEFAULT true NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`);
    await query(`CREATE TABLE IF NOT EXISTS system_settings (
      id SERIAL PRIMARY KEY, key TEXT UNIQUE NOT NULL, value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`);
    await query(`CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      ip TEXT NOT NULL, action TEXT NOT NULL, target TEXT, status TEXT NOT NULL,
      details TEXT, user_agent TEXT
    )`);
    await query(`CREATE TABLE IF NOT EXISTS ip_rate_limits (
      id SERIAL PRIMARY KEY, ip TEXT UNIQUE NOT NULL, failed_attempts INTEGER DEFAULT 0 NOT NULL,
      last_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, blocked_until TIMESTAMP
    )`);
    const defaults: [string, string][] = [
      ["allow_query", "true"],
      ["announcement", "2024-2025学年第二学期期末成绩已发布，请各位同学输入准确的班级、姓名及出生年月（8位）进行查询。"],
      ["maintenance_reason", "系统正在进行成绩复核与安全维护，成绩查询通道暂时关闭，请稍后再试。"],
      ["allowed_classes", "ALL"],
      ["rate_limit_max_attempts", "5"],
      ["rate_limit_lockout_minutes", "15"],
    ];
    for (const [key, value] of defaults) {
      await query(`INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [key, value]);
    }
    basicInitDone = true;
  } catch (e: any) {
    console.error("[Init] error:", e?.message || String(e));
  }
}

export async function seedAllStudents(): Promise<{ total: number; inserted: number; errors: number }> {
  await basicInit();
  const total = Array.isArray(seedStudents) ? seedStudents.length : 0;
  if (total === 0) return { total: 0, inserted: 0, errors: 0 };
  await query("DELETE FROM students");
  let inserted = 0, errors = 0;
  const batchSize = 20;
  for (let i = 0; i < seedStudents.length; i += batchSize) {
    const batch = seedStudents.slice(i, i + batchSize);
    const values: string[] = [];
    const params: any[] = [];
    batch.forEach((s, idx) => {
      const base = idx * 7;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`);
      params.push(s.id, s.studentId, s.name, s.className, s.password, JSON.stringify(s.courses), true);
    });
    const sql = `INSERT INTO students (id, student_id, name, class_name, password, courses_json, query_enabled) VALUES ${values.join(", ")} ON CONFLICT (id) DO NOTHING`;
    try {
      await query(sql, params);
      inserted += batch.length;
    } catch (e: any) {
      console.error(`[Seed] batch error at ${i}:`, e?.message || String(e));
      errors += batch.length;
    }
  }
  console.log(`[Seed] imported ${inserted}/${total}, errors: ${errors}`);
  return { total, inserted, errors };
}

export async function ensureInitialized() {
  await basicInit();
}

export async function getSetting(key: string, defaultValue: string = ""): Promise<string> {
  try {
    await basicInit();
    const row = await queryOne<{ value: string }>("SELECT value FROM system_settings WHERE key = $1 LIMIT 1", [key]);
    if (row) return row.value;
  } catch (err) { console.error("Error reading setting:", key, err); }
  return defaultValue;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await basicInit();
  await query(`INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`, [key, value]);
}

export async function logAudit(entry: { ip: string; action: string; target?: string; status: string; details?: string; userAgent?: string; }) {
  try {
    await basicInit();
    await query(`INSERT INTO audit_logs (ip, action, target, status, details, user_agent) VALUES ($1, $2, $3, $4, $5, $6)`, [entry.ip, entry.action, entry.target || null, entry.status, entry.details || null, entry.userAgent || null]);
  } catch (err) { console.error("Failed to write audit log:", err); }
}

export async function checkRateLimit(ip: string): Promise<{ isBlocked: boolean; remainingLockoutSeconds?: number }> {
  try {
    await basicInit();
    const row = await queryOne<any>("SELECT failed_attempts, blocked_until FROM ip_rate_limits WHERE ip = $1 LIMIT 1", [ip]);
    if (row && row.blocked_until) {
      const now = new Date();
      const blockedUntil = new Date(row.blocked_until);
      if (now < blockedUntil) {
        return { isBlocked: true, remainingLockoutSeconds: Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000) };
      } else {
        await query("UPDATE ip_rate_limits SET failed_attempts = 0, blocked_until = NULL, last_attempt = CURRENT_TIMESTAMP WHERE ip = $1", [ip]);
      }
    }
  } catch (err) { console.error("Rate limit check error:", err); }
  return { isBlocked: false };
}

export async function recordFailedAttempt(ip: string, maxAttempts = 5, lockoutMinutes = 15) {
  try {
    await basicInit();
    const row = await queryOne<any>("SELECT failed_attempts, blocked_until FROM ip_rate_limits WHERE ip = $1 LIMIT 1", [ip]);
    if (!row) {
      await query("INSERT INTO ip_rate_limits (ip, failed_attempts, last_attempt) VALUES ($1, 1, CURRENT_TIMESTAMP)", [ip]);
    } else {
      const newAttempts = Number(row.failed_attempts) + 1;
      let blockedUntil = row.blocked_until;
      if (newAttempts >= maxAttempts) blockedUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000).toISOString();
      await query("UPDATE ip_rate_limits SET failed_attempts = $1, blocked_until = $2, last_attempt = CURRENT_TIMESTAMP WHERE ip = $3", [newAttempts, blockedUntil, ip]);
    }
  } catch (err) { console.error("Record failed attempt error:", err); }
}

export async function resetFailedAttempts(ip: string) {
  try {
    await basicInit();
    await query("UPDATE ip_rate_limits SET failed_attempts = 0, blocked_until = NULL, last_attempt = CURRENT_TIMESTAMP WHERE ip = $1", [ip]);
  } catch (err) { console.error("Reset failed attempts error:", err); }
}
