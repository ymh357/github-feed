import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProject } from "@/lib/catalog";
import { Detail } from "@/components/detail";
import type { ReactElement } from "react";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };

export const generateMetadata = async ({ params }: Props): Promise<Metadata> => {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return { title: "项目未找到" };
  const project = await getProject(id);
  return { title: project?.repository.fullName ?? "项目未找到" };
};

const ProjectPage = async ({ params }: Props): Promise<ReactElement> => {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const project = await getProject(id);
  if (!project) notFound();
  return <Detail item={project.item} updates={project.updates} />;
};

export default ProjectPage;
