import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDueScheduledArticlesMock = vi.fn();
const claimScheduledArticleMock = vi.fn();
const markScheduledArticlePublishedMock = vi.fn();
const markScheduledArticleFailedMock = vi.fn();
const releaseScheduledArticleMock = vi.fn();
const incrementApiUsageMock = vi.fn();

vi.mock('@x-harness/db', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getDueScheduledArticles: (...args: any[]) => getDueScheduledArticlesMock(...args),
  claimScheduledArticle: (...args: any[]) => claimScheduledArticleMock(...args),
  markScheduledArticlePublished: (...args: any[]) => markScheduledArticlePublishedMock(...args),
  markScheduledArticleFailed: (...args: any[]) => markScheduledArticleFailedMock(...args),
  releaseScheduledArticle: (...args: any[]) => releaseScheduledArticleMock(...args),
  incrementApiUsage: (...args: any[]) => incrementApiUsageMock(...args),
}));

import { XApiRateLimitError } from '@x-harness/x-sdk';
import { processScheduledArticles } from '../article-scheduler.js';

const dueArticle = {
  id: 'schedule-1',
  x_account_id: 'account-1',
  article_id: '2099999999999999999',
  scheduled_at: '2099-08-27T18:00:00.000+09:00',
  status: 'scheduled',
  published_post_id: null,
  attempts: 0,
  last_error: null,
  published_at: null,
  created_at: '',
  updated_at: '',
};

describe('processScheduledArticles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDueScheduledArticlesMock.mockResolvedValue([dueArticle]);
    claimScheduledArticleMock.mockResolvedValue({ ...dueArticle, status: 'publishing', attempts: 1 });
  });

  it('publishes a claimed Article exactly once and stores the returned post ID', async () => {
    const xClient = {
      publishArticle: vi.fn(async () => ({ post_id: '2100000000000000000' })),
    } as any;

    await processScheduledArticles({} as any, xClient, 'account-1');

    expect(claimScheduledArticleMock).toHaveBeenCalledWith({}, 'schedule-1');
    expect(xClient.publishArticle).toHaveBeenCalledOnce();
    expect(xClient.publishArticle).toHaveBeenCalledWith('2099999999999999999');
    expect(markScheduledArticlePublishedMock).toHaveBeenCalledWith(
      {},
      'schedule-1',
      '2100000000000000000',
    );
    expect(incrementApiUsageMock).toHaveBeenCalledWith({}, 'account-1', 'article_publish');
  });

  it('does not publish when another Cron invocation already claimed the row', async () => {
    claimScheduledArticleMock.mockResolvedValueOnce(null);
    const xClient = { publishArticle: vi.fn() } as any;

    await processScheduledArticles({} as any, xClient, 'account-1');

    expect(xClient.publishArticle).not.toHaveBeenCalled();
  });

  it('returns a rate-limited Article to the queue for the next Cron tick', async () => {
    const xClient = {
      publishArticle: vi.fn(async () => {
        throw new XApiRateLimitError(4_102_444_800);
      }),
    } as any;

    await processScheduledArticles({} as any, xClient, 'account-1');

    expect(releaseScheduledArticleMock).toHaveBeenCalledWith({}, 'schedule-1', 'Rate limited by X API');
    expect(markScheduledArticleFailedMock).not.toHaveBeenCalled();
  });

  it('marks ambiguous failures without automatically retrying', async () => {
    const xClient = {
      publishArticle: vi.fn(async () => {
        throw new Error('connection closed after request');
      }),
    } as any;

    await processScheduledArticles({} as any, xClient, 'account-1');

    expect(markScheduledArticleFailedMock).toHaveBeenCalledWith(
      {},
      'schedule-1',
      'connection closed after request',
    );
    expect(releaseScheduledArticleMock).not.toHaveBeenCalled();
  });
});
