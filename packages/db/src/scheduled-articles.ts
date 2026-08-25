import { jstNow } from './utils.js';

export const SCHEDULED_ARTICLE_STATUSES = [
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled',
] as const;

export type ScheduledArticleStatus = (typeof SCHEDULED_ARTICLE_STATUSES)[number];

export interface DbScheduledArticle {
  id: string;
  x_account_id: string;
  article_id: string;
  scheduled_at: string;
  status: ScheduledArticleStatus;
  published_post_id: string | null;
  attempts: number;
  last_error: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function createScheduledArticle(
  db: D1Database,
  xAccountId: string,
  articleId: string,
  scheduledAt: string,
): Promise<DbScheduledArticle> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const result = await db
    .prepare(
      `INSERT INTO scheduled_articles
        (id, x_account_id, article_id, scheduled_at, status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'scheduled', 0, ?, ?)
       RETURNING *`,
    )
    .bind(id, xAccountId, articleId, scheduledAt, now, now)
    .first<DbScheduledArticle>();
  return result!;
}

export async function getScheduledArticles(
  db: D1Database,
  opts: {
    xAccountId?: string;
    status?: ScheduledArticleStatus;
    articleId?: string;
    limit?: number;
  } = {},
): Promise<DbScheduledArticle[]> {
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (opts.xAccountId) {
    conditions.push('x_account_id = ?');
    binds.push(opts.xAccountId);
  }
  if (opts.status) {
    conditions.push('status = ?');
    binds.push(opts.status);
  }
  if (opts.articleId) {
    conditions.push('article_id = ?');
    binds.push(opts.articleId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 200));
  const result = await db
    .prepare(`SELECT * FROM scheduled_articles ${where} ORDER BY scheduled_at DESC LIMIT ?`)
    .bind(...binds, limit)
    .all<DbScheduledArticle>();
  return result.results;
}

export async function getActiveScheduledArticle(
  db: D1Database,
  articleId: string,
): Promise<DbScheduledArticle | null> {
  return db
    .prepare(
      `SELECT * FROM scheduled_articles
       WHERE article_id = ? AND status IN ('scheduled', 'publishing')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(articleId)
    .first<DbScheduledArticle>();
}

export async function getDueScheduledArticles(
  db: D1Database,
  xAccountId: string,
): Promise<DbScheduledArticle[]> {
  const now = jstNow();
  const result = await db
    .prepare(
      `SELECT * FROM scheduled_articles
       WHERE status = 'scheduled' AND x_account_id = ? AND scheduled_at <= ?
       ORDER BY scheduled_at ASC`,
    )
    .bind(xAccountId, now)
    .all<DbScheduledArticle>();
  return result.results;
}

export async function claimScheduledArticle(
  db: D1Database,
  id: string,
): Promise<DbScheduledArticle | null> {
  const now = jstNow();
  return db
    .prepare(
      `UPDATE scheduled_articles
       SET status = 'publishing', attempts = attempts + 1, last_error = NULL, updated_at = ?
       WHERE id = ? AND status = 'scheduled'
       RETURNING *`,
    )
    .bind(now, id)
    .first<DbScheduledArticle>();
}

export async function markScheduledArticlePublished(
  db: D1Database,
  id: string,
  postId: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE scheduled_articles
       SET status = 'published', published_post_id = ?, published_at = ?, updated_at = ?
       WHERE id = ? AND status = 'publishing'`,
    )
    .bind(postId, now, now, id)
    .run();
}

export async function releaseScheduledArticle(
  db: D1Database,
  id: string,
  error: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE scheduled_articles
       SET status = 'scheduled', last_error = ?, updated_at = ?
       WHERE id = ? AND status = 'publishing'`,
    )
    .bind(error, jstNow(), id)
    .run();
}

export async function markScheduledArticleFailed(
  db: D1Database,
  id: string,
  error: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE scheduled_articles
       SET status = 'failed', last_error = ?, updated_at = ?
       WHERE id = ? AND status = 'publishing'`,
    )
    .bind(error, jstNow(), id)
    .run();
}

export async function cancelScheduledArticle(
  db: D1Database,
  id: string,
  xAccountId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE scheduled_articles
       SET status = 'cancelled', updated_at = ?
       WHERE id = ? AND x_account_id = ? AND status = 'scheduled'`,
    )
    .bind(jstNow(), id, xAccountId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
