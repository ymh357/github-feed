"use client";

import { useState } from "react";
import type { ReactElement } from "react";
import type { LearningProgress, LearningRecord } from "./personal-state";
import { usePersonal } from "./personal-state";

const NoteEditor = ({ repositoryId, initial }: { repositoryId: string; initial?: LearningRecord }): ReactElement => {
  const { saveLearning, storageFailed } = usePersonal();
  const [note, setNote] = useState(initial?.note ?? "");
  const [progress, setProgress] = useState<LearningProgress>(initial?.progress ?? "none");
  const changed = note !== (initial?.note ?? "") || progress !== (initial?.progress ?? "none");
  return <section className="learning-tools" aria-labelledby={`notes-${repositoryId}`}>
    <h2 id={`notes-${repositoryId}`}>我的学习记录</h2>
    <label className="progress-control">学习进度
      <select value={progress} onChange={(event) => setProgress(event.target.value as LearningProgress)}>
        <option value="none">尚未安排</option>
        <option value="plan">待学习</option>
        <option value="reading">正在学习</option>
        <option value="practiced">已实践</option>
      </select>
    </label>
    <label htmlFor={`note-${repositoryId}`}>笔记与问题</label>
    <textarea id={`note-${repositoryId}`} maxLength={20000} rows={6} value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录理解、疑问或实践结果；内容仅保存在当前浏览器。" />
    <p className="note-character-count">{note.length.toLocaleString()} / 20,000 字符</p>
    <div className="note-save-row">
      <button type="button" className="primary-button" disabled={!changed} onClick={() => saveLearning(repositoryId, { note, progress })}>保存记录</button>
      <span role="status">{storageFailed ? "浏览器存储失败，请从列表页导出记录备份。" : changed ? "有未保存的更改，离开前请保存。" : initial ? "已保存到当前浏览器" : "可随时记录，不需要登录"}</span>
    </div>
  </section>;
};

export const LearningTools = ({ repositoryId }: { repositoryId: string }): ReactElement => {
  const { learning } = usePersonal();
  const record = learning[repositoryId];
  return <NoteEditor key={`${repositoryId}-${record?.updatedAt ?? "empty"}`} repositoryId={repositoryId} initial={record} />;
};
