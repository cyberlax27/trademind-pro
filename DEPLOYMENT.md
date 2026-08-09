# TradeMind Pro production setup

TradeMind Pro is a paper-trading beta. It does not connect to brokers or place real-money orders.

## Render

Deploy this repository as one web service. Set the health-check path to `/api/health` and configure these environment variables in Render (never in GitHub):

```text
NODE_ENV=production
JWT_SECRET=<long random secret>
APP_BASE_URL=https://trademind-pro.onrender.com
DATABASE_URL=<pooled PostgreSQL connection string>

PAYPAL_MODE=live
PAYPAL_CLIENT_ID=<live client id>
PAYPAL_SECRET=<live secret>
PAYPAL_WEBHOOK_ID=<live webhook id>

PAYMONGO_ENABLED=false
```

The server refuses to start without `DATABASE_URL`; this prevents accounts, payments, subscriptions, and trade history from silently being written to Render's temporary filesystem.

## Plans

Each purchase provides 30 days and does not renew automatically:

- Starter: USD 9, up to 3 paper-trading bots
- Premium: USD 19, up to 10 paper-trading bots
- Max: USD 29, up to 25 paper-trading bots

The authoritative amounts are defined server-side in `server.js`. The client sends only a tier name.

## PayPal webhook

The live webhook URL is:

```text
https://trademind-pro.onrender.com/api/webhooks/paypal
```

Subscribe at minimum to `PAYMENT.CAPTURE.COMPLETED` and store its live webhook ID as `PAYPAL_WEBHOOK_ID`.

## Release checks

1. `/api/health` reports `status: ok`, `database: true`, and `payments.paypal: true`.
2. Create a temporary account and a bot.
3. Confirm the bot creates an open simulated position and eventually records a completed simulated trade.
4. Redeploy and verify the account, bot, subscription, and activity still exist.
5. Start a PayPal order without approving it and verify the displayed amount matches the selected plan.
6. For an actual payment, use a controlled low-risk purchase/refund and confirm access is granted exactly once.
