import { randomUUID } from "node:crypto";
import { queryRows } from "./db";
import { getReleases } from "./github";
import { store } from "./store";
import type { ReleaseInput, Repository, StoreContract } from "./types";

export interface ReleaseBackfillResult {
  complete: boolean;
  nextOffset: number;
  recordedReleases: number;
  busy?: boolean;
}

interface BackfillDependencies {
  query: typeof queryRows;
  readWindow: typeof getReleases;
  recordRelease: StoreContract["recordRelease"];
}

const parseAnchor = (value: unknown): ReleaseInput | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("GitHub 版本历史锚点数据无效。");
  const raw = value as Record<string, unknown>;
  if (!["id", "tag", "title", "body", "url", "publishedAt"].every((key) => typeof raw[key] === "string")
    || !Number.isFinite(Date.parse(String(raw.publishedAt)))) throw new Error("GitHub 版本历史锚点字段无效。");
  return raw as unknown as ReleaseInput;
};

export const bootstrapReleaseHistory = async (
  repository: Repository,
  options: { initialOffset?: number } = {},
  overrides: Partial<BackfillDependencies> = {},
): Promise<ReleaseBackfillResult> => {
  const { query, readWindow, recordRelease } = { query: queryRows, readWindow: getReleases, recordRelease: store.recordRelease, ...overrides };
  const initialOffset = options.initialOffset ?? 0;
  if (!Number.isSafeInteger(initialOffset) || initialOffset < 0 || initialOffset > 300
    || !Number.isFinite(Date.parse(repository.discoveredAt))) throw new Error("GitHub 版本历史初始化参数无效。");
  const stage = `release-bootstrap:${repository.id}`;
  const token = randomUUID();
  const lease = await query(`INSERT INTO collection_stage_leases(stage,lease_token,lease_until)
    VALUES($1,$2,now()+interval '5 minutes') ON CONFLICT(stage) DO UPDATE
    SET lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until
    WHERE collection_stage_leases.lease_until<=now() RETURNING stage`, [stage, token]);
  if (!lease.length) return { complete: false, nextOffset: 0, recordedReleases: 0, busy: true };
  let leaseLost = false;
  let heartbeat = Promise.resolve();
  const renew = async (): Promise<void> => {
    if (leaseLost) throw new Error("GitHub 版本历史续采租约已失效，游标未推进。");
    const rows = await query(`UPDATE collection_stage_leases SET lease_until=now()+interval '5 minutes'
      WHERE stage=$1 AND lease_token=$2 AND lease_until>now() RETURNING stage`, [stage, token]);
    if (!rows.length) { leaseLost = true; throw new Error("GitHub 版本历史续采租约已失效，游标未推进。"); }
  };
  const timer = setInterval(() => {
    heartbeat = heartbeat.then(renew).catch(() => { leaseLost = true; });
  }, 60_000);
  timer.unref();
  try {
    await query(`INSERT INTO release_backfills(repository_id,next_offset) SELECT $1,$2
      WHERE EXISTS(SELECT 1 FROM collection_stage_leases WHERE stage=$3 AND lease_token=$4 AND lease_until>now())
      ON CONFLICT(repository_id) DO NOTHING`, [repository.id, initialOffset, stage, token]);
    const states = await query(`SELECT b.next_offset,b.anchor_release,r.last_release_id FROM release_backfills b
      JOIN repositories r ON r.id=b.repository_id WHERE b.repository_id=$1`, [repository.id]);
    if (!states.length) throw new Error("GitHub 版本历史续采状态未建立。");
    const offset = Number(states[0].next_offset);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("GitHub 版本历史续采游标无效。");
    if (states[0].last_release_id) {
      await query(`DELETE FROM release_backfills WHERE repository_id=$1 AND EXISTS
        (SELECT 1 FROM collection_stage_leases WHERE stage=$2 AND lease_token=$3 AND lease_until>now())`, [repository.id, stage, token]);
      return { complete: true, nextOffset: offset, recordedReleases: 0 };
    }
    // A latest-only scan already consumed this run's raw budget; resume it next run.
    if (initialOffset > 0) return { complete: false, nextOffset: offset, recordedReleases: 0 };
    const window = await readWindow(repository.fullName, null, 3, false, offset);
    if (window.rawCount > 300 || window.nextOffset !== offset + window.rawCount
      || (!window.complete && window.rawCount === 0)) throw new Error("GitHub 版本历史续采窗口无效。");
    await heartbeat;
    await renew();
    const anchor = parseAnchor(states[0].anchor_release) ?? window.releases[0] ?? null;
    let recordedReleases = 0;
    for (const release of [...window.releases].reverse()) {
      if (Date.parse(release.publishedAt) <= Date.parse(repository.discoveredAt)) continue;
      await heartbeat;
      await renew();
      await recordRelease(repository.id, release, false, { advanceBaseline: false });
      recordedReleases += 1;
    }
    await heartbeat;
    await renew();
    if (window.complete) {
      // Lock cursor, repository and lease together so baseline creation and cursor removal are atomic.
      const done = await query(`WITH current AS (
        SELECT b.repository_id FROM release_backfills b JOIN repositories r ON r.id=b.repository_id
        JOIN collection_stage_leases l ON l.stage=$4 AND l.lease_token=$5 AND l.lease_until>now()
        WHERE b.repository_id=$1 AND b.next_offset=$2 AND r.last_release_id IS NULL FOR UPDATE OF b,r,l
      ), baseline AS (
        UPDATE repositories r SET last_release_id=$3::jsonb->>'id',
          last_release_published_at=($3::jsonb->>'publishedAt')::timestamptz
        FROM current WHERE r.id=current.repository_id AND $3::jsonb IS NOT NULL AND r.last_release_id IS NULL RETURNING r.id
      ), removed AS (
        DELETE FROM release_backfills b USING current WHERE b.repository_id=current.repository_id
        AND ($3::jsonb IS NULL OR EXISTS(SELECT 1 FROM baseline WHERE id=current.repository_id)) RETURNING b.repository_id
      ) SELECT repository_id FROM removed`, [repository.id, offset, anchor ? JSON.stringify(anchor) : null, stage, token]);
      if (done.length !== 1) throw new Error("GitHub 版本历史续采游标或租约已变化，未建立新基线。");
    } else {
      const saved = await query(`UPDATE release_backfills b SET next_offset=$3,
        anchor_release=COALESCE(b.anchor_release,$4::jsonb),updated_at=now()
        WHERE b.repository_id=$1 AND b.next_offset=$2
        AND EXISTS(SELECT 1 FROM repositories r WHERE r.id=b.repository_id AND r.last_release_id IS NULL)
        AND EXISTS(SELECT 1 FROM collection_stage_leases WHERE stage=$5 AND lease_token=$6 AND lease_until>now())
        RETURNING repository_id`, [repository.id, offset, window.nextOffset, anchor ? JSON.stringify(anchor) : null, stage, token]);
      if (saved.length !== 1) throw new Error("GitHub 版本历史续采游标或租约已变化，本批未确认。");
    }
    return { complete: window.complete, nextOffset: window.nextOffset, recordedReleases };
  } finally {
    clearInterval(timer);
    await heartbeat;
    await query("DELETE FROM collection_stage_leases WHERE stage=$1 AND lease_token=$2", [stage, token]);
  }
};
