import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export type DigestOpportunity = {
  id: string
  name: string
  url: string | null
  category: string | null
  totalScore: number
  distributionGapScore: number
  oneSentencePitch: string | null
  topNiche: string | null
}

function buildHtml(opportunities: DigestOpportunity[], date: string): string {
  const rows = opportunities
    .map(
      (op, i) => `
    <tr>
      <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;width:24px">${i + 1}</td>
      <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb">
        <div style="font-weight:600;font-size:14px;color:#111827">${escHtml(op.name)}</div>
        ${op.oneSentencePitch ? `<div style="font-size:13px;color:#6b7280;margin-top:2px">${escHtml(op.oneSentencePitch)}</div>` : ''}
        ${op.topNiche ? `<div style="font-size:12px;color:#7c3aed;margin-top:4px">→ ${escHtml(op.topNiche)}</div>` : ''}
      </td>
      <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap">
        <span style="font-size:20px;font-weight:700;color:#111827">${op.totalScore}</span>
        <div style="font-size:11px;color:#6b7280">dist gap: ${op.distributionGapScore}</div>
      </td>
      <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;text-align:right">
        <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://buildwut.vercel.app'}/opportunities/${op.id}"
           style="font-size:12px;color:#6366f1;text-decoration:none">View →</a>
      </td>
    </tr>`
    )
    .join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;background:#f9fafb">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden">
    <div style="padding:24px;background:#111827">
      <h1 style="margin:0;font-size:18px;font-weight:700;color:#fff">BuildWut Daily Digest</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#9ca3af">${date} · Top opportunities by distribution gap</p>
    </div>
    <div style="padding:8px 16px">
      <table style="width:100%;border-collapse:collapse">
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="padding:16px 24px;border-top:1px solid #e5e7eb">
      <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://buildwut.vercel.app'}/feed"
         style="font-size:13px;color:#6366f1;text-decoration:none">Open BuildWut →</a>
    </div>
  </div>
</body>
</html>`
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function sendDailyDigest(
  to: string,
  opportunities: DigestOpportunity[]
): Promise<{ ok: boolean; error?: string }> {
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  try {
    const { error } = await resend.emails.send({
      from: 'BuildWut <digest@buildwut.app>',
      to,
      subject: `BuildWut digest — ${date}`,
      html: buildHtml(opportunities, date),
    })

    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
