export function createOtpSender(apiKey: string) {
  return async (to: string, code: string): Promise<void> => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: 'Vera Plot <noreply@redarch.dev>',
        to,
        subject: `Vera Plot 驗證碼：${code}`,
        text: `您的 Vera Plot 驗證碼是：${code}\n\n此驗證碼將在 10 分鐘後失效。\n如果您沒有要求此驗證碼，請忽略此信。`,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Resend API ${res.status}: ${text}`)
    }
  }
}

export function createInviteSender(apiKey: string) {
  return async (to: string, inviterEmail: string, companyName: string, token: string): Promise<void> => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: 'Vera Plot <noreply@redarch.dev>',
        to,
        subject: `${inviterEmail} 邀請您加入 ${companyName} — Vera Plot`,
        text: `${inviterEmail} 邀請您加入「${companyName}」團隊。\n\n加入後，您將與團隊成員共享設計指引、DXF 圖紙，以及合併的使用額度。\n\n點擊以下連結加入：\nhttps://vera-plot.redarch.dev/invite/${token}\n\n此連結將在 7 天後失效。`,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Resend API ${res.status}: ${text}`)
    }
  }
}
