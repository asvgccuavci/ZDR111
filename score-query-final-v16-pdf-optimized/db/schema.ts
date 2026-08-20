import { pgTable, serial, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const students = pgTable("students", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull(),
  name: text("name").notNull(),
  className: text("class_name").notNull(),
  password: text("password").notNull(),
  coursesJson: text("courses_json").notNull(),
  queryEnabled: boolean("query_enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const systemSettings = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  key: text("key").unique().notNull(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  ip: text("ip").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  status: text("status").notNull(),
  details: text("details"),
  userAgent: text("user_agent"),
});

export const ipRateLimits = pgTable("ip_rate_limits", {
  id: serial("id").primaryKey(),
  ip: text("ip").unique().notNull(),
  failedAttempts: integer("failed_attempts").default(0).notNull(),
  lastAttempt: timestamp("last_attempt").defaultNow().notNull(),
  blockedUntil: timestamp("blocked_until"),
});
