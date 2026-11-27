import { XClient, XApiRateLimitError } from '@x-harness/x-sdk';
import {
  claimScheduledArticle,
  getDueScheduledArticles,
  incrementApiUsage,
  markScheduledArticleFailed,
  markScheduledArticlePublished,
  releaseScheduledArticle,
} from '@x-harness/db';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function processScheduledArticles(
  db: D1Database,
  xClient: XClient,
  xAccountId: string,
): Promise<void> {
  const dueArticles = await getDueScheduledArticles(db, xAccountId);

  for (const due of dueArticles) {
    // The conditional update is the idempotency gate when Cron invocations overlap.
    const claimed = await claimScheduledArticle(db, due.id);
    if (!claimed) continue;

    try {
      const result = await xClient.publishArticle(claimed.article_id);
      await markScheduledArticlePublished(db, claimed.id, result.post_id);
      await incrementApiUsage(db, xAccountId, 'article_publish').catch(error => console.error('Article usage accounting failed', error));
      await Promise.resolve().then(() => db.prepare("UPDATE growth_articles SET status='published', published_article_id=?, updated_at=? WHERE x_article_draft_id=? AND x_account_id=?").bind(result.post_id, new Date().toISOString(), claimed.article_id, xAccountId).run()).catch(error => console.error('Article studio status update failed', error));
    } catch (error) {
      const message = errorText(error);
      if (error instanceof XApiRateLimitError || (error instanceof Error && error.name === 'BudgetExceededError')) {
        // A rate-limit response is known not to have published the Article.
        // Return it to the queue and retry on the next Cron tick.
        await releaseScheduledArticle(db, claimed.id, message);
        return;
      }

      // For ambiguous network and validation errors, do not auto-retry: the
      // publish may have succeeded even if the response was lost.
      await markScheduledArticleFailed(db, claimed.id, message);
    }
  }
}
