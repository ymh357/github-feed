"use client";

import Link from "next/link";
import type { ReactElement } from "react";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";

export type LearningProgress = "none" | "plan" | "reading" | "practiced";
export interface LearningRecord { note: string; progress: LearningProgress; updatedAt: string }

interface PersonalData {
  version: 2;
  favorites: string[];
  read: string[];
  learning: Record<string, LearningRecord>;
}

interface PersonalState extends PersonalData {
  toggleFavorite: (id: string) => void;
  markRead: (id: string) => void;
  toggleRead: (id: string) => void;
  saveLearning: (id: string, record: Pick<LearningRecord, "note" | "progress">) => void;
  storageFailed: boolean;
}

const KEY = "github-feed.personal.v1";
const CHANGE = "github-feed:personal-change";
const EMPTY: PersonalData = { version: 2, favorites: [], read: [], learning: {} };
const EMPTY_JSON = JSON.stringify(EMPTY);
let memorySnapshot = EMPTY_JSON;
let storageFailed = false;

const validIds = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 20000 && value.every((id) => typeof id === "string" && /^[a-zA-Z0-9:_-]{1,128}$/.test(id));

const parsePersonal = (raw: string): PersonalData => {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || !("version" in value) || (value.version !== 1 && value.version !== 2) || !("favorites" in value) || !("read" in value) || !validIds(value.favorites) || !validIds(value.read)) {
    throw new Error("文件格式不正确，请选择本站导出的收藏文件。");
  }
  const learning: Record<string, LearningRecord> = Object.create(null) as Record<string, LearningRecord>;
  if (value.version === 2) {
    if (!("learning" in value) || !value.learning || typeof value.learning !== "object" || Array.isArray(value.learning) || Object.keys(value.learning).length > 20000) throw new Error("学习记录格式无效。");
    for (const [id, rawRecord] of Object.entries(value.learning)) {
      if (!/^\d{1,100}$/.test(id) || !rawRecord || typeof rawRecord !== "object") throw new Error("学习记录格式无效。");
      const record = rawRecord as Record<string, unknown>;
      if (typeof record.note !== "string" || record.note.length > 20000 || !["none", "plan", "reading", "practiced"].includes(String(record.progress)) || typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt))) throw new Error("学习记录格式无效。");
      learning[id] = { note: record.note, progress: record.progress as LearningProgress, updatedAt: record.updatedAt };
    }
  }
  return { version: 2, favorites: [...new Set(value.favorites)], read: [...new Set(value.read)], learning };
};

const getSnapshot = (): string => {
  if (storageFailed) return `!${memorySnapshot}`;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== null) {
      if (raw !== memorySnapshot) parsePersonal(raw);
      memorySnapshot = raw;
    } else memorySnapshot = EMPTY_JSON;
  } catch {
    storageFailed = true;
  }
  return storageFailed ? `!${memorySnapshot}` : memorySnapshot;
};

const currentData = (): PersonalData => {
  const raw = getSnapshot();
  return parsePersonal(raw.startsWith("!") ? raw.slice(1) : raw);
};

const subscribe = (listener: () => void): (() => void) => {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === KEY || event.key === null) {
      storageFailed = false;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE, listener);
  };
};

const persist = (data: PersonalData): void => {
  memorySnapshot = JSON.stringify(data);
  try {
    window.localStorage.setItem(KEY, memorySnapshot);
    storageFailed = false;
  } catch {
    storageFailed = true;
  }
  window.dispatchEvent(new Event(CHANGE));
};

export const usePersonal = (): PersonalState => {
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_JSON);
  const data = useMemo(() => parsePersonal(raw.startsWith("!") ? raw.slice(1) : raw), [raw]);
  const toggleFavorite = useCallback((id: string): void => {
    const current = currentData();
    if (!current.favorites.includes(id) && current.favorites.length >= 20000) {
      storageFailed = true;
      window.dispatchEvent(new Event(CHANGE));
      return;
    }
    persist({ ...current, favorites: current.favorites.includes(id) ? current.favorites.filter((value) => value !== id) : [...current.favorites, id] });
  }, []);
  const markRead = useCallback((id: string): void => {
    const current = currentData();
    if (current.read.includes(id)) return;
    if (current.read.length >= 20000) {
      storageFailed = true;
      window.dispatchEvent(new Event(CHANGE));
      return;
    }
    persist({ ...current, read: [...current.read, id] });
  }, []);
  const toggleRead = useCallback((id: string): void => {
    const current = currentData();
    if (!current.read.includes(id) && current.read.length >= 20000) {
      storageFailed = true;
      window.dispatchEvent(new Event(CHANGE));
      return;
    }
    persist({ ...current, read: current.read.includes(id) ? current.read.filter((value) => value !== id) : [...current.read, id] });
  }, []);
  const saveLearning = useCallback((id: string, record: Pick<LearningRecord, "note" | "progress">): void => {
    const current = currentData();
    if (!/^\d{1,100}$/.test(id) || (!current.learning[id] && Object.keys(current.learning).length >= 20000)) {
      storageFailed = true;
      window.dispatchEvent(new Event(CHANGE));
      return;
    }
    persist({ ...current, learning: { ...current.learning, [id]: { ...record, note: record.note.slice(0, 20000), updatedAt: new Date().toISOString() } } });
  }, []);
  return { ...data, toggleFavorite, markRead, toggleRead, saveLearning, storageFailed: raw.startsWith("!") };
};

export const BookmarkIcon = ({ filled = false }: { filled?: boolean }): ReactElement => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth="1.7"
    aria-hidden="true"
  >
    <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z" />
  </svg>
);

export const FavoriteButton = ({ id, compact = false }: { id: string; compact?: boolean }): ReactElement => {
  const { favorites, toggleFavorite } = usePersonal();
  const saved = favorites.includes(id);
  return <button
    type="button"
    className={`favorite-button ${saved ? "is-saved" : ""} ${compact ? "icon-only" : ""}`}
    onClick={() => toggleFavorite(id)}
    aria-pressed={saved}
    aria-label={saved ? "取消收藏项目" : "收藏项目"}
  >
    <BookmarkIcon filled={saved} />
    {!compact && <span>
      {saved ? "已收藏" : "收藏项目"}
    </span>}
  </button>;
};

export const ReadMarker = ({ eventId, available = true }: { eventId: string; available?: boolean }): ReactElement => {
  const { read, toggleRead } = usePersonal();
  const complete = read.includes(eventId);
  return <button type="button" className="read-button" aria-pressed={complete} disabled={!available && !complete} onClick={() => toggleRead(eventId)}>
    {complete ? "已读 · 撤销" : available ? "标记已读" : "解读完成后可标记已读"}
  </button>;
};

export const FavoritesLink = ({ className = "" }: { className?: string }): ReactElement => {
  const { favorites } = usePersonal();
  return <Link className={className} href="/?view=favorites">
    <BookmarkIcon />
    <span>我的收藏</span>
    <span className="nav-count">
      {favorites.length}
    </span>
  </Link>;
};

export const PersonalTools = (): ReactElement => {
  const { favorites, read, learning, storageFailed: failed } = usePersonal();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const exportData = (): void => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 2, favorites, read, learning }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `github-feed-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage("收藏、已读和学习笔记已导出。");
  };
  const importData = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error("文件超过 16 MB，请选择较小的导出文件。");
      const incoming = parsePersonal(await file.text());
      const current = currentData();
      const records = { ...current.learning };
      for (const [id, record] of Object.entries(incoming.learning)) {
        if (!records[id] || Date.parse(record.updatedAt) > Date.parse(records[id].updatedAt)) records[id] = record;
      }
      const merged = { version: 2 as const, learning: records, favorites: [...new Set([...current.favorites, ...incoming.favorites])], read: [...new Set([...current.read, ...incoming.read])] };
      if (merged.favorites.length > 20000 || merged.read.length > 20000 || Object.keys(records).length > 20000) throw new Error("合并后的记录超过存储上限，请保留原导出文件。");
      persist(merged);
      setMessage("已合并收藏和已读；同一项目的笔记保留较新版本。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败，请检查文件。");
    } finally {
      if (input.current) input.current.value = "";
    }
  };
  return <div className="personal-tools">
    <p>收藏、已读与笔记仅保存在当前浏览器。</p>
    <div className="tool-actions">
      <button type="button" onClick={exportData}>导出记录</button>
      <button type="button" onClick={() => input.current?.click()}>导入记录</button>
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        accept="application/json,.json"
        aria-label="导入收藏文件"
        onChange={(event) => void importData(event.target.files?.[0])}
      />
    </div>
    {failed && <p className="storage-warning" role="status">部分本地记录无法保存。请先导出记录；关闭页面后更改可能丢失。</p>}
    {message && <p className="tool-message" role="status">
      {message}
    </p>}
  </div>;
};
