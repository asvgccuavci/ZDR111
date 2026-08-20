import { eq, desc, and, sql } from "drizzle-orm";
import { initDb, getDb } from "../../db/index.js";
export { initDb, getDb };
import * as schema from "../../db/schema.js";
import { seedStudents } from "../_data/students-seed.js";

let isSeeded = false;

/**
 * Ensures system settings and default 581 students are initialized in the database
 */
export async function ensureInitialized() {
  if (isSeeded) return;
  const db = getDb();
  try {
    // 1. Check if default system settings exist
    const settings = await db.select().from(schema.systemSettings);
    const settingsMap = new Map(settings.map(s => [s.key, s.value]));
    const defaultSettings: Record<string, string> = {
      allow_query: "true",
      announcement: "2024-2025学年第二学期期末成绩已发布，请各位同学输入准确的班级、姓名及出生年月（8位）进行查询。",
      maintenance_reason: "系统正在进行成绩复核与安全维护，成绩查询通道暂时关闭，请稍后再试。",
      allowed_classes: "ALL",
      rate_limit_max_attempts: "5",
      rate_limit_lockout_minutes: "15",
    };
    for (const [key, value] of Object.entries(defaultSettings)) {
      if (!settingsMap.has(key)) {
        await db.insert(schema.systemSettings).values({ key, value }).onConflictDoNothing();
      }
    }
    // 2. Check if students table has records
    const studentCountResult = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(schema.students);
    const count = Number(studentCountResult[0]?.count || 0);
    if (count === 0 && Array.isArray(seedStudents) && seedStudents.length > 0) {
      console.log(`Seeding ${seedStudents.length} student records into database...`);
      // Batch insert in chunks of 50 to avoid parameter limit
      const chunkSize = 50;
      for (let i = 0; i < seedStudents.length; i += chunkSize) {
        const chunk = seedStudents.slice(i, i + chunkSize).map(s => ({
          id: s.id,
          studentId: s.studentId,
          name: s.name,
          className: s.className,
          password: s.password,
          coursesJson: JSON.stringify(s.courses),
          queryEnabled: true,
        }));
        await db.insert(schema.students).values(chunk).onConflictDoNothing();
      }
      console.log("Database successfully seeded with students.");
    }
    isSeeded = true;
  } catch (err) {
    console.warn("Database initialization notice (will retry on next request):", err);
  }
}

/**
 * Get a system setting by key
 */
export async function getSetting(key: string, defaultValue: string = ""): Promise<string> {
  const db = getDb();
  try {
    await ensureInitialized();
    const rows = await db
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, key))
      .limit(1);
    if (rows.length > 0) {
      return rows[0].value;
    }
  } catch (err) {
    console.error("Error reading setting:", key, err);
  }
  return defaultValue;
}

/**
 * Update or set a system setting
 */
export async function setSetting(key: string, value: string): Promise<void> {
  const db = getDb();
  await ensureInitialized();
  await db
    .insert(schema.systemSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: schema.systemSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

/**
 * Log an audit action
 */
export async function logAudit(entry: {
  ip: string;
  action: string;
  target?: string;
  status: "SUCCESS" | "FAILED_PASSWORD" | "NOT_FOUND" | "BLOCKED" | "RATE_LIMITED";
  details?: string;
  userAgent?: string;
}) {
  const db = getDb();
  try {
    await ensureInitialized();
    await db.insert(schema.auditLogs).values({
      ip: entry.ip,
      action: entry.action,
      target: entry.target || null,
      status: entry.status,
      details: entry.details || null,
      userAgent: entry.userAgent || null,
    });
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}

/**
 * Check if IP is currently rate-limited
 */
export async function checkRateLimit(ip: string): Promise<{ isBlocked: boolean; remainingLockoutSeconds?: number }> {
  const db = getDb();
  try {
    await ensureInitialized();
    const rows = await db
      .select()
      .from(schema.ipRateLimits)
      .where(eq(schema.ipRateLimits.ip, ip))
      .limit(1);
    if (rows.length > 0) {
      const record = rows[0];
      if (record.blockedUntil) {
        const now = new Date();
        if (now < record.blockedUntil) {
          const remainingSeconds = Math.ceil((record.blockedUntil.getTime() - now.getTime()) / 1000);
          return { isBlocked: true, remainingLockoutSeconds: remainingSeconds };
        } else {
          // Lockout has expired, reset attempts
          await db
            .update(schema.ipRateLimits)
            .set({ failedAttempts: 0, blockedUntil: null, lastAttempt: now })
            .where(eq(schema.ipRateLimits.ip, ip));
        }
      }
    }
  } catch (err) {
    console.error("Rate limit check error:", err);
  }
  return { isBlocked: false };
}

/**
 * Record a failed attempt for an IP
 */
export async function recordFailedAttempt(ip: string, maxAttempts = 5, lockoutMinutes = 15) {
  const db = getDb();
  try {
    await ensureInitialized();
    const rows = await db
      .select()
      .from(schema.ipRateLimits)
      .where(eq(schema.ipRateLimits.ip, ip))
      .limit(1);
    const now = new Date();
    if (rows.length === 0) {
      await db.insert(schema.ipRateLimits).values({
        ip,
        failedAttempts: 1,
        lastAttempt: now,
      });
    } else {
      const current = rows[0];
      const newAttempts = current.failedAttempts + 1;
      let blockedUntil = current.blockedUntil;
      if (newAttempts >= maxAttempts) {
        blockedUntil = new Date(now.getTime() + lockoutMinutes * 60 * 1000);
      }
      await db
        .update(schema.ipRateLimits)
        .set({
          failedAttempts: newAttempts,
          blockedUntil,
          lastAttempt: now,
        })
        .where(eq(schema.ipRateLimits.ip, ip));
    }
  } catch (err) {
    console.error("Record failed attempt error:", err);
  }
}

/**
 * Reset failed attempts for an IP upon successful login/query
 */
export async function resetFailedAttempts(ip: string) {
  const db = getDb();
  try {
    await ensureInitialized();
    await db
      .update(schema.ipRateLimits)
      .set({ failedAttempts: 0, blockedUntil: null, lastAttempt: new Date() })
      .where(eq(schema.ipRateLimits.ip, ip));
  } catch (err) {
    console.error("Reset failed attempts error:", err);
  }
}
