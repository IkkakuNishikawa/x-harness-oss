-- Cloud-scheduled X Article publishing.
-- The Article draft is created before this row is inserted; Cron only performs
-- the final publish call at or after scheduled_at.
CREATE TABLE IF NOT EXISTS scheduled_articles (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'publishing', 'published', 'failed', 'cancelled')),
  published_post_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_articles_due
  ON scheduled_articles(status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_scheduled_articles_account
  ON scheduled_articles(x_account_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_articles_active_article
  ON scheduled_articles(article_id)
  WHERE status IN ('scheduled', 'publishing');
