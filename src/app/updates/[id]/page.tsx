import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getUpdate } from "@/lib/catalog";
import { Detail } from "@/components/detail";
import type { ReactElement } from "react";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };

export const generateMetadata = async ({ params }: Props): Promise<Metadata> => {
  const { id } = await params;
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(id)) return { title: "更新未找到" };
  const update = await getUpdate(id);
  return { title: update ? `${update.project.fullName} ${update.item.event.releaseTag ?? "更新"}` : "更新未找到" };
};

const UpdatePage = async ({ params }: Props): Promise<ReactElement> => {
  const { id } = await params;
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(id)) notFound();
  const update = await getUpdate(id);
  if (!update) notFound();
  return <Detail item={update.item} updates={[]} isUpdate />;
};

export default UpdatePage;
