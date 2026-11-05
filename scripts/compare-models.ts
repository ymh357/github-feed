import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateLearning, listModels } from "../src/lib/ai";
import { getRepository } from "../src/lib/github";
import { collectSources } from "../src/lib/sources";
import { admissionReason, isFormalRepository } from "../src/lib/discovery-policy";
import type { CatalogItem, Repository } from "../src/lib/types";

const main = async (): Promise<void> => {
  if (process.argv.includes("--help")) {
    console.log("用法：npm run compare-models -- owner/repository [owner/repository ...]\n设置 ZERO_G_API_KEY 和 ZERO_G_COMPARE_MODELS（2..4 个准确模型 ID，逗号分隔）。\n--list-models：只读取模型目录，不执行生成。\n报告保存在 artifacts/model-comparisons，需人工比较事实准确性与学习价值。");
    return;
  }
  if (process.argv.slice(2).some((argument) => argument.startsWith("--") && argument !== "--list-models")) throw new Error("请使用有效参数；加 --help 查看帮助。");
  if (process.argv.includes("--list-models")) { console.log(JSON.stringify(await listModels(), null, 2)); return; }
  const names = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  if (!names.length || names.length > 3) throw new Error("请指定 1..3 个真实仓库，例如 npm run compare-models -- vercel/next.js。");
  const inputs = [];
  for (const fullName of names) {
    const input = await getRepository(fullName);
    if (!input) throw new Error("仓库不符合收录条件，未执行生成。");
    if (!isFormalRepository(input)) throw new Error(`仓库 ${input.fullName} 不符合正式准入：${admissionReason(input)} 未调用模型。`);
    inputs.push(input);
  }
  if (!process.env.ZERO_G_API_KEY) throw new Error("缺少 ZERO_G_API_KEY，未执行付费模型比较。");
  const models = [...new Set((process.env.ZERO_G_COMPARE_MODELS ?? "").split(",").map((model) => model.trim()).filter(Boolean))];
  if (models.length < 2 || models.length > 4) throw new Error("请设置 ZERO_G_COMPARE_MODELS 为 2..4 个准确模型 ID（逗号分隔）；可加 --list-models 查看目录。");
  const available = await listModels();
  if (models.some((model) => !available.includes(model))) throw new Error("比较模型不在当前 0G 目录中，未执行付费生成。");
  const startedAt = new Date().toISOString();
  const directory = resolve("artifacts", "model-comparisons");
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${startedAt.replace(/[:.]/g, "-")}.json`);
  const reports: unknown[] = [];
  let failed = false;
  const checkpoint = async (): Promise<void> => {
    await writeFile(path, JSON.stringify({ startedAt, reports }, null, 2), { encoding: "utf8", mode: 0o600 });
  };
  for (const input of inputs) {
    const fullName = input.fullName;
    const now = new Date().toISOString();
    const repository: Repository = { ...input, discoveredAt: now, syncedAt: now, lastReleaseId: null, starGrowth: null, growthDays: null };
    const item: CatalogItem = { repository, event: { id: `compare-${input.id}`, repositoryId: input.id, kind: "discovery", title: input.fullName, publishedAt: now, observedAt: now, releaseId: null, releaseTag: null, releaseUrl: null, releaseBody: null }, content: null };
    const sources = await collectSources(item);
    for (const model of models) {
      const start = Date.now();
      console.log(`开始比较：${fullName} / ${model}`);
      try {
        const content = await generateLearning(item, sources, model);
        reports.push({ fullName, elapsedMs: Date.now() - start, ...content, review: "待人工按来源忠实度、实现解释和中文可读性审阅；结构校验通过不代表事实已验证。" });
        console.log(`结构校验通过：${fullName} / ${model}`);
      } catch (error: unknown) {
        failed = true;
        const key = process.env.ZERO_G_API_KEY ?? "";
        const redact = (value: string): string => key ? value.replaceAll(key, "[redacted]") : value;
        const message = error instanceof Error ? redact(error.message).slice(0, 500) : "生成或结构校验失败。";
        const diagnostic = error instanceof Error && typeof error.cause === "string" ? redact(error.cause).slice(0, 100000) : undefined;
        reports.push({ fullName, model, elapsedMs: Date.now() - start, error: message, diagnostic });
        console.log(`未通过：${fullName} / ${model}；${message}`);
      }
      await checkpoint();
    }
  }
  await checkpoint();
  console.log(`模型比较结果已保存：${path}`);
  if (failed) process.exitCode = 1;
};

main().catch((error: unknown) => {
  const message = error instanceof Error && /^(缺少|请|比较模型|仓库|GitHub|读取 0G|无法读取)/.test(error.message) ? error.message : "模型比较未完成，请检查服务端配置与网络。";
  console.error(message);
  process.exitCode = 1;
});
