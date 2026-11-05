import { store } from "../src/lib/store";

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("用法：node --env-file-if-exists=.env.local --import tsx scripts/manage-content.ts --repository owner/name --action retry|refresh [--depth quick|deep]\n仅管理员本地或受保护CI使用；此命令只入队，不调用模型。retry恢复该项目的失败事件，refresh重新整理项目介绍并保留历史文章。");
    return;
  }
  const allowed = new Set(["--repository", "--action", "--depth"]);
  const fields = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index]) || !args[index + 1] || fields.has(args[index])) throw new Error("参数无效，请使用 --help。");
    fields.set(args[index], args[index + 1]);
  }
  const repository = fields.get("--repository") ?? "";
  const action = fields.get("--action"); const depth = fields.get("--depth");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !["retry", "refresh"].includes(action ?? "") || (depth !== undefined && depth !== "quick" && depth !== "deep")) throw new Error("仓库、操作或深度无效，请使用 --help。");
  const queued = await store.resetContent(repository, { retryOnly: action === "retry", depth });
  console.log(JSON.stringify({ repository, action, depth: depth ?? "preserve", queued }));
};
main().catch(() => { console.error("内容入队失败，请检查参数、数据库和迁移状态；未输出连接信息。"); process.exitCode = 1; });
