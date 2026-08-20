import { drizzle } from "drizzle-orm/neon-http";
import { neon, neonConfig } from "@neondatabase/serverless";
import * as schema from "./schema.js";

// Cloudflare Workers 兼容配置
neonConfig.fetchConnectionCache = true;

// 数据库连接实例（延迟初始化，兼容 Cloudflare Pages Functions 的 context.env）
let dbInstance: ReturnType<typeof drizzle> | null = null;

// 默认数据库连接串（后备，当环境变量不可用时使用）
const DEFAULT_DATABASE_URL = "postgresql://neondb_owner:npg_f5JbVgzQI1nl@ep-mute-math-ax7112if-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require";

/**
 * 初始化数据库连接
 * @param connectionString 数据库连接串（可选，不传则使用默认值）
 */
export function initDb(connectionString?: string) {
  if (!dbInstance) {
    const connStr = connectionString || DEFAULT_DATABASE_URL;
    console.log("[DB] initDb called, connStr length:", connStr?.length);
    if (!connStr) {
      throw new Error("Database connection string is empty");
    }
    try {
      const sql = neon(connStr);
      dbInstance = drizzle(sql, { schema });
      console.log("[DB] initDb success");
    } catch (e: any) {
      console.error("[DB] initDb error:", e?.message || String(e));
      throw e;
    }
  }
  return dbInstance;
}

/**
 * 获取数据库连接实例（必须先调用 initDb）
 */
export function getDb() {
  if (!dbInstance) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return dbInstance;
}

// 导出 schema 供其他模块使用
export { schema };
