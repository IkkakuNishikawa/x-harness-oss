import { beforeEach, describe, expect, it, vi } from 'vitest';

const createScheduledArticleMock = vi.fn();
const getActiveScheduledArticleMock = vi.fn();
const getScheduledArticlesMock = vi.fn();
const cancelScheduledArticleMock = vi.fn();
const getXAccountByIdMock = vi.fn();

vi.mock('@x-harness/db', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  createScheduledArticle: (...args: any[]) => createScheduledArticleMock(...args),
  getActiveScheduledArticle: (...args: any[]) => getActiveScheduledArticleMock(...args),
  getScheduledArticles: (...args: any[]) => getScheduledArticlesMock(...args),
  cancelScheduledArticle: (...args: any[]) => cancelScheduledArticleMock(...args),
  getXAccountById: (...args: any[]) => getXAccountByIdMock(...args),
}));

import { articles } from '../articles.js';

const env = { DB: {} } as any;
const articleId = '2099999999999999999';

function scheduleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'schedule-1',
    x_account_id: 'account-1',
    article_id: articleId,
    scheduled_at: '2099-08-27T18:00:00.000+09:00',
    status: 'scheduled',
    published_post_id: null,
    attempts: 0,
    last_error: null,
    published_at: null,
    created_at: '2099-08-26T12:00:00.000+09:00',
    updated_at: '2099-08-26T12:00:00.000+09:00',
    ...overrides,
  };
}

describe('Article scheduling routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getXAccountByIdMock.mockResolvedValue({ id: 'account-1' });
    getActiveScheduledArticleMock.mockResolvedValue(null);
    createScheduledArticleMock.mockResolvedValue(scheduleRow());
    getScheduledArticlesMock.mockResolvedValue([scheduleRow()]);
    cancelScheduledArticleMock.mockResolvedValue(true);
  });

  it('registers a future Article publication in JST', async () => {
    const req = new Request(`http://local/api/articles/${articleId}/schedule`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        xAccountId: 'account-1',
        scheduledAt: '2099-08-27T18:00:00+09:00',
      }),
    });

    const res = await articles.request(req, undefined, env);
    expect(res.status).toBe(201);
    expect(createScheduledArticleMock).toHaveBeenCalledWith(
      {},
      'account-1',
      articleId,
      '2099-08-27T18:00:00.000+09:00',
    );
    const body = await res.json() as any;
    expect(body.data.status).toBe('scheduled');
    expect(body.data.id).toBe('schedule-1');
  });

  it('rejects datetimes without an explicit timezone', async () => {
    const req = new Request(`http://local/api/articles/${articleId}/schedule`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ xAccountId: 'account-1', scheduledAt: '2099-08-27T18:00:00' }),
    });

    const res = await articles.request(req, undefined, env);
    expect(res.status).toBe(400);
    expect(createScheduledArticleMock).not.toHaveBeenCalled();
  });

  it('prevents duplicate active schedules for the same Article', async () => {
    getActiveScheduledArticleMock.mockResolvedValueOnce(scheduleRow());
    const req = new Request(`http://local/api/articles/${articleId}/schedule`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        xAccountId: 'account-1',
        scheduledAt: '2099-08-27T18:00:00+09:00',
      }),
    });

    const res = await articles.request(req, undefined, env);
    expect(res.status).toBe(409);
    expect(createScheduledArticleMock).not.toHaveBeenCalled();
  });

  it('lists schedule status and publication results', async () => {
    const req = new Request('http://local/api/articles/scheduled?xAccountId=account-1&status=scheduled');
    const res = await articles.request(req, undefined, env);

    expect(res.status).toBe(200);
    expect(getScheduledArticlesMock).toHaveBeenCalledWith({}, {
      xAccountId: 'account-1',
      status: 'scheduled',
    });
    const body = await res.json() as any;
    expect(body.data[0].articleId).toBe(articleId);
  });

  it('cancels only the requested account pending schedule', async () => {
    const req = new Request(
      'http://local/api/articles/scheduled/schedule-1?xAccountId=account-1',
      { method: 'DELETE' },
    );
    const res = await articles.request(req, undefined, env);

    expect(res.status).toBe(200);
    expect(cancelScheduledArticleMock).toHaveBeenCalledWith({}, 'schedule-1', 'account-1');
  });
});
