// 数据库连接：直接使用 fetch 调用 Neon HTTP API
// 注意：数据库连接字符串必须通过环境变量 DATABASE_URL 传入，不要硬编码

interface DbConfig {
  host: string;
  connectionString: string;
}

let dbConfig: DbConfig | null = null;

/**
 * 从连接串解析数据库配置并初始化
 * @param connectionString 数据库连接字符串，从环境变量 DATABASE_URL 获取
 */
export function initDb(connectionString?: string) {
  if (dbConfig) return;
  
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  
  try {
    const url = new URL(connectionString);
    dbConfig = {
      host: url.hostname,
      connectionString: connectionString,
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
