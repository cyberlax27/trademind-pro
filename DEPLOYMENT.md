# TradeMind Pro production setup

## Render

Deploy this repository as one Docker web service. Set the health check path to `/api/health` and configure these environment variables in Render (never in GitHub):

```text
JWT_SECRET=<long random secret>
APP_BASE_URL=https://<your-render-hostname>
DB_PATH=/var/data/trademind.db

PAYPAL_MODE=live
PAYPAL_CLIENT_ID=<live client id>
PAYPAL_SECRET=<live secret>
PAYPAL_WEBHOOK_ID=<live webhook id>

PAYMONGO_MODE=live
PAYMONGO_SECRET_KEY=<sk_live key>
PAYMONGO_WEBHOOK_SECRET=<live webhook signing secret>
```

The production prices are defined once on the server: Starter $19 or PHP 1,199, Premium $29 or PHP 1,799, and Unlimited $49 or PHP 2,999.

Attach a Render persistent disk at `/var/data`. Without it, the SQLite users and payment ledger are erased on a redeploy. A persistent disk also means this service must run as a single instance; migrate to managed PostgreSQL before scaling horizontally.

## Provider webhooks

Create one live PayPal webhook pointing to:

```text
https://<your-render-hostname>/api/webhooks/paypal
```

Subscribe at minimum to `PAYMENT.CAPTURE.COMPLETED`. Copy that webhook's ID into `PAYPAL_WEBHOOK_ID`.

Create one live PayMongo webhook pointing to:

```text
https://<your-render-hostname>/api/webhooks/paymongo
```

Subscribe to `checkout_session.payment.paid`. Copy the live signing secret into `PAYMONGO_WEBHOOK_SECRET`.

## Release check

After deployment, open `/api/health`. Both `payments.paypal` and `payments.paymongo` must be `true` before taking a real payment. Then make one low-risk real transaction for each provider, confirm the provider dashboard shows it, and confirm the user's plan changes exactly once.
