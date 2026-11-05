import { isDatabaseConfigured, queryRows } from "../src/lib/db";

const health = async (): Promise<void> => {
  if (!isDatabaseConfigured()) {
    console.error("数据库未配置：请在 .env.local 设置 DATABASE_URL。");
    process.exitCode = 1;
    return;
  }
  const rows = await queryRows(`SELECT
    (SELECT count(*) FROM repositories) AS repositories,
    (SELECT count(*) FROM feed_events) AS events,
    (SELECT count(*) FROM learning_contents WHERE status = 'ready') AS ready,
    (SELECT count(*) FROM learning_contents WHERE status = 'failed') AS failed,
    (SELECT count(*) FROM learning_contents WHERE status = 'processing' AND lease_until < now()) AS expired_leases,
    (SELECT count(*) FROM learning_contents WHERE status <> 'ready' AND attempts >= 3) AS exhausted,
    (SELECT max(finished_at) FROM collection_runs WHERE status IN ('completed', 'partial')) AS last_success`);
  console.log(JSON.stringify({ database: "connected", ...rows[0] }, null, 2));
};

health().catch(() => {
  console.error("数据库健康检查失败。请检查连接和迁移状态；未输出连接信息。");
  process.exitCode = 1;
});
