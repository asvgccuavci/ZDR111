// 数据库连接：直接使用 fetch 调用 Neon HTTP API

interface DbConfig {
  host: string;
  connectionString: string;
}

let dbConfig: DbConfig | null = null;

const DEFAULT_DATABASE_URL = "postgresql://neondb_owner:npg_f5JbVgzQI1nl@ep-mute-math-ax7112if-pooler.c-4.us-east-2.aws.neon.tech/neondb";

/**
 * 从连接串解析数据库配置并初始化
 */
export function initDb(connectionString?: string) {
  if (dbConfig) return;
  
  const connStr = connectionString || DEFAULT_DATABASE_URL;
  
  try {
    const url = new URL(connStr);
    dbConfig = {
      host: url.hostname,
      connectionString: connStr,
    };
    console.log("[DB] initialized, host:", dbConfig.host);
  } catch (e: any) {
    console.error("[DB] init error:", e?.message);
    throw new Error("Invalid database connection string");
  }
}

/**
 * 执行 SQL 查询，返回行对象数组
 */
export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  if (!dbConfig) initDb();
  if (!dbConfig) throw new Error("Database not initialized");

  const response = await fetch(`https://${dbConfig.host}/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": dbConfig.connectionString,
      "Neon-Raw-Text-Output": "true",
      "Neon-Array-Mode": "true",
    },
    body: JSON.stringify({ query: sql, params }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("[DB] query failed:", response.status, text.substring(0, 300));
    throw new Error(`Database error: ${response.status}`);
  }

  const result = await response.json();
  // Neon Array Mode 返回 { fields: [...], rows: [[...]], ... }
  // 需要将数组行转换为对象行
  if (result && Array.isArray(result.rows) && Array.isArray(result.fields)) {
    const colNames = result.fields.map((f: any) => f.name);
    return result.rows.map((row: any[]) => {
      const obj: any = {};
      row.forEach((val, i) => { obj[colNames[i]] = val; });
      return obj as T;
    });
  }
  return (result as T[]) || [];
}

/**
 * 执行单条查询，返回第一行或 null
 */
export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] || null;
}

/**
 * 获取数据库实例（兼容旧代码）
 */
export function getDb() {
  if (!dbConfig) throw new Error("Database not initialized. Call initDb() first.");
  return null;
}

export { };
