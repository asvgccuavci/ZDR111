import { seedAllStudents } from "../_utils/db-service.js";
import { initDb } from "../../db/index.js";

export const onRequest = async (context: any) => {
  const req = context.request;
  initDb(context.env?.DATABASE_URL);
  try {
    const result = await seedAllStudents();
    return new Response(
      JSON.stringify({ ok: true, message: "学生数据导入完成", total: result.total, inserted: result.inserted, errors: result.errors }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, message: "导入失败", error: err?.message || String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
