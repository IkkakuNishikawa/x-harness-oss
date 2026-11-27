import { describe, it, expect, vi, afterEach } from 'vitest';
import { fixture } from '../helpers/campaign.js';
import { createScheduledArticle, getDueScheduledArticles, claimScheduledArticle, cancelScheduledArticle, getScheduledArticles } from '../../packages/db/src/index.js';
import { processScheduledArticles } from '../../apps/worker/src/services/article-scheduler.js';
import worker from '../../apps/worker/src/index.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('article scheduling with real SQLite', () => {
  it('compares actual instants across offsets and scopes due articles by account', async () => {
    const { db } = fixture();
    await createScheduledArticle(db, 'a', '123', '2026-10-27T10:00:00Z');
    await createScheduledArticle(db, 'a', '124', '2026-10-27T19:01:00+09:00');
    await createScheduledArticle(db, 'b', '125', '2026-10-27T10:00:00Z');
    expect((await getDueScheduledArticles(db, 'a')).map(a => a.article_id)).toEqual(['123']);
  });
  it('claims only once, enforces uniqueness, and refuses cancellation of a claimed article', async () => {
    const { db } = fixture();
    const row = await createScheduledArticle(db, 'a', '123', '2020-01-01T00:00:00Z');
    await expect(createScheduledArticle(db, 'b', '123', '2099-01-01T00:00:00Z')).rejects.toThrow();
    expect(await cancelScheduledArticle(db, row.id, 'wrong')).toBe(false);
    expect(await claimScheduledArticle(db, row.id)).not.toBeNull();
    expect(await claimScheduledArticle(db, row.id)).toBeNull();
    expect(await cancelScheduledArticle(db, row.id, 'a')).toBe(false);
  });
  it('publishes once under overlapping cron executions and saves the result', async () => {
    const { db } = fixture();
    await createScheduledArticle(db, 'a', '123', '2020-01-01T00:00:00Z');
    const client = { publishArticle: vi.fn().mockResolvedValue({ post_id: '456' }) } as any;
    await Promise.all([processScheduledArticles(db, client, 'a'), processScheduledArticles(db, client, 'a')]);
    expect(client.publishArticle).toHaveBeenCalledTimes(1);
    expect((await getScheduledArticles(db))[0]).toMatchObject({ status: 'published', published_post_id: '456', attempts: 1 });
  });
  it('requires authentication and forbids viewer mutations through the deployed router', async () => {
    const { db, sqlite } = fixture();
    sqlite.exec("INSERT INTO staff_members(id,name,role,api_key,is_active,created_at,updated_at) VALUES ('viewer','Viewer','viewer','viewer-key',1,'now','now')");
    const env = { DB: db, API_KEY: 'master-key' } as any;
    const context = { waitUntil() {}, passThroughOnException() {} } as any;
    const url = 'https://worker.example/api/articles/123/schedule';
    expect((await worker.fetch(new Request(url, { method: 'POST' }), env, context)).status).toBe(401);
    expect((await worker.fetch(new Request(url, { method: 'POST', headers: { Authorization: 'Bearer viewer-key' } }), env, context)).status).toBe(403);
  });
  it('blocks immediate publication while a schedule is active', async () => {
    const { db, sqlite } = fixture();
    await createScheduledArticle(db, 'a', '123', '2099-01-01T00:00:00Z');
    const response = await worker.fetch(new Request('https://worker.example/api/articles/123/publish', {
      method: 'POST', headers: { Authorization: 'Bearer master-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ xAccountId: 'a' }),
    }), { DB: db, API_KEY: 'master-key' } as any, { waitUntil() {} } as any);
    expect(response.status).toBe(409);
  });

});
