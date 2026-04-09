import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // In production Vercel captures stdout; pretty-print only in dev
  ...(process.env.NODE_ENV === 'development' && {
    transport: { target: 'pino/file', options: { destination: 1 } },
  }),
  redact: {
    paths: [
      'ANTHROPIC_API_KEY',
      'RESEND_API_KEY',
      'X_API_BEARER_TOKEN',
      'XAI_API_KEY',
      'GITHUB_PERSONAL_ACCESS_TOKEN',
      'PRODUCT_HUNT_API_SECRET',
      'SUPABASE_SERVICE_ROLE_KEY',
      'DATABASE_URL',
      'CRON_SECRET',
    ],
    censor: '[REDACTED]',
  },
})
