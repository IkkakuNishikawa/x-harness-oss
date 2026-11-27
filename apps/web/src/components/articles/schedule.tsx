'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@cloudflare/kumo/components/button'
import { Surface } from '@cloudflare/kumo/components/surface'
import { fetchApi, type ApiResponse } from '@/lib/api'

type Schedule = { id: string; articleId: string; scheduledAt: string; status: string; publishedPostId?: string; lastError?: string }
const labels: Record<string, string> = { scheduled: '予約済み', publishing: '公開処理中', published: '公開済み', failed: '要確認', cancelled: '取消済み' }
const field = 'w-full rounded-lg border border-kumo-line bg-kumo-base p-3 text-sm'

export default function ArticleSchedule({ accountId, savedArticle, onDraftCreated, onActiveDraftIdsChange }: {
  accountId: string
  savedArticle?: { id: string; title: string; xDraftId: string | null; canSchedule: boolean }
  onActiveDraftIdsChange?: (ids: string[]) => void
  onDraftCreated?: () => Promise<void>
}) {
  const [items, setItems] = useState<Schedule[]>([])
  const [articleId, setArticleId] = useState('')
  const [datetime, setDatetime] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const lock = useRef(false)
  const load = useCallback(async () => {
    const res = await fetchApi<ApiResponse<Schedule[]>>(`/api/articles/scheduled?xAccountId=${encodeURIComponent(accountId)}`)
    setItems(res.data)
    onActiveDraftIdsChange?.(res.data.filter(item => ['scheduled', 'publishing'].includes(item.status)).map(item => item.articleId))
  }, [accountId, onActiveDraftIdsChange])
  useEffect(() => { void load().catch(e => setError(String(e))) }, [load])
  useEffect(() => { setArticleId(savedArticle?.xDraftId && /^\d+$/.test(savedArticle.xDraftId) ? savedArticle.xDraftId : '') }, [savedArticle?.id, savedArticle?.xDraftId])
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setMessage('')
    try { await action(); await load() }
    catch (e) { setError(e instanceof Error ? e.message : '処理に失敗しました') }
    finally { lock.current = false; setBusy(false) }
  }
  const schedule = (fromSaved: boolean) => {
    // datetime-local deliberately represents Japan time, independent of browser timezone.
    const scheduledAt = `${datetime}:00+09:00`
    if (!datetime || !Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) < Date.now() + 60000) {
      setError('日本時間で1分以上先の日時を指定してください。'); return
    }
    if (!window.confirm(`${fromSaved ? `「${savedArticle?.title}」` : `記事ID ${articleId}`}を日本時間 ${datetime.replace('T', ' ')} 以降に公開予約しますか？`)) return
    void run(async () => {
      let id = articleId
      if (fromSaved && savedArticle) {
        const draft = await fetchApi<ApiResponse<{ x_article_draft_id: string; warnings?: string[] }>>(`/api/growth/articles/${encodeURIComponent(savedArticle.id)}/x-draft`, { method: 'POST', body: '{}' })
        id = draft.data.x_article_draft_id; setArticleId(id)
        await onDraftCreated?.()
        if (draft.data.warnings?.length) throw new Error(`X下書きは作成済みです。予約前に内容を確認してください: ${draft.data.warnings.join(' / ')}`)
      }
      await fetchApi(`/api/articles/${encodeURIComponent(id)}/schedule`, { method: 'POST', body: JSON.stringify({ xAccountId: accountId, scheduledAt }) })
      setMessage('公開予約を登録しました。Macの電源を切っても実行されます。')
    })
  }
  return <Surface className="space-y-4 rounded-xl p-5 text-kumo-default">
    <h2 className="font-semibold">記事の日時指定公開</h2>
    <p className="text-sm text-kumo-subtle">日時は日本時間です。指定時刻以降、通常5分以内に公開します。X下書きを作成したアカウントを選んでください。</p>
    {error && <p role="alert" className="text-sm text-kumo-danger">{error}</p>}
    {message && <p role="status" className="text-sm text-kumo-success">{message}</p>}
    <label className="block space-y-2"><span className="text-sm">公開日時（日本時間）</span><input className={field} type="datetime-local" value={datetime} disabled={busy} onChange={e => setDatetime(e.target.value)} /></label>
    {savedArticle && <Button disabled={busy || !datetime || !savedArticle.canSchedule} onClick={() => schedule(true)}>選択中の記事を予約する</Button>}
    <details><summary className="cursor-pointer text-sm">作成済みのX下書きIDで予約する</summary>
      <div className="mt-3 space-y-3"><label className="block space-y-2"><span className="text-sm">X記事の下書きID</span><input className={field} inputMode="numeric" value={articleId} disabled={busy} onChange={e => setArticleId(e.target.value.trim())} /></label>
        <Button disabled={busy || !datetime || !/^\d+$/.test(articleId)} onClick={() => schedule(false)}>このX下書きを予約する</Button></div>
    </details>
    <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">予約・公開履歴</h3><Button disabled={busy} onClick={() => void run(load)}>更新</Button></div>
    {items.length === 0 ? <p className="text-sm text-kumo-subtle">予約はありません。</p> : <ul className="space-y-3">{items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-kumo-line pt-3 text-sm">
      <div><p>{new Date(item.scheduledAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} · {labels[item.status] ?? item.status}</p><p className="break-all text-xs text-kumo-subtle">記事ID: {item.articleId}</p>{item.lastError && <p className="text-kumo-danger">{item.lastError}</p>}{item.publishedPostId && <a className="underline" href={`https://x.com/i/status/${encodeURIComponent(item.publishedPostId)}`} target="_blank" rel="noopener noreferrer">公開記事を見る</a>}</div>
      {item.status === 'scheduled' && <Button disabled={busy} onClick={() => {
        if (window.confirm('この公開予約を取り消しますか？X下書きは残ります。')) void run(async () => {
          await fetchApi(`/api/articles/scheduled/${encodeURIComponent(item.id)}?xAccountId=${encodeURIComponent(accountId)}`, { method: 'DELETE' }); setMessage('予約を取り消しました。')
        })
      }}>予約を取消</Button>}
    </li>)}</ul>}
  </Surface>
}
