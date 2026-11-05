import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDb, isDatabaseConfigured } from "../src/lib/db";

const migrate = async (): Promise<void> => {
  if (!isDatabaseConfigured()) throw new Error("DATABASE_URL is not configured");
  const schema = await readFile(resolve(process.cwd(), "db/schema.sql"), "utf8");
  const statements = schema.split(";").map((statement) => statement.trim()).filter(Boolean);
  const db = getDb();
  await db.transaction(statements.map((statement) => db.query(statement)));
  console.log(`数据库迁移成功：${statements.length} 条初始化语句。`);
};

migrate().catch(() => {
  console.error("数据库迁移失败。请检查 DATABASE_URL、数据库连接与 db/schema.sql；未输出连接信息。");
  process.exitCode = 1;
});
