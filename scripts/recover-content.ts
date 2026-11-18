import { PROMPT_VERSION } from "../src/lib/ai";
import { recoverContent } from "../src/lib/content-recovery";

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("用法：node --env-file-if-exists=.env.local --import tsx scripts/recover-content.ts --before ISO时间 [--limit 1..200] [--repository owner/name] [--apply]\n默认只读预览；--apply归档原失败状态后，按当前修复版本恢复一次。资料不足项不恢复，不调用模型。");
    return;
  }
  const fields = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--apply" && !apply) { apply = true; continue; }
    if (!["--before", "--limit", "--repository"].includes(flag) || fields.has(flag)
      || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("恢复参数无效，请使用 --help。");
    fields.set(flag, args[++index]);
  }
  const items = await recoverContent({ revision: PROMPT_VERSION, before: fields.get("--before") ?? "",
    limit: Number(fields.get("--limit") ?? "20"), repository: fields.get("--repository"), apply });
  console.log(JSON.stringify({ mode: apply ? "applied" : "preview", revision: PROMPT_VERSION, count: items.length, items }));
};

main().catch(() => {
  console.error("修复版本恢复未完成，请核对参数、数据库和迁移状态；未输出私密配置。");
  process.exitCode = 1;
});
