import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema.js";

// 数据库连接实例（延迟初始化，兼容 Cloudflare Pages Functions 的 context.env）
let dbInstance: ReturnType<typeof drizzle> | null = null;

/**
 * 初始化数据库连接
 * @param connectionString 数据库连接串
 */
export function initDb(connectionString: string) {
  if (!dbInstance) {
    const sql = neon(connectionString);
    dbInstance = drizzle(sql, { schema });
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
