# Stripe Integration Plan

## Status

This document is an implementation plan only. No billing code is being added in this sprint.

The current launch landing page is a static GitHub Pages surface. **GitHub Pages cannot host the Stripe backend endpoints below**, so billing must live in a separate backend or serverless deployment.

## Goal

Implement a Stripe subscription flow for DanteForge with:

- 14-day free trial
- $20/month recurring billing after trial
- card required at signup
- self-serve cancellation through the Stripe Customer Portal
- webhook handling for:
  - `checkout.session.completed`
  - `customer.subscription.trial_will_end`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`

## Recommended Billing Shape

Use **hosted Stripe Checkout** for the first version.

Why:

- lowest PCI burden
- fastest time to production
- clean support for subscription mode and free trials
- Stripe-hosted card collection and payment method storage
- easy handoff into the Customer Portal

## Stripe Objects To Create

Create these objects in Stripe first:

1. Product
   - Name: `DanteForge Pro`

2. Recurring Price
   - Amount: `$20/month`
   - Billing interval: monthly
   - Currency: USD

3. Customer Portal configuration
   - allow cancellation
   - allow payment method updates
   - optionally allow billing details updates

## Application Data To Store

Persist these fields in your own app database once billing exists:

- `userId`
- `email`
- `stripeCustomerId`
- `stripeSubscriptionId`
- `stripeCheckoutSessionId`
- `stripePriceId`
- `subscriptionStatus`
- `trialEndsAt`
- `currentPeriodEndsAt`
- `cancelAtPeriodEnd`
- `lastInvoiceStatus`
- `lastProcessedStripeEventId`
- `lastProcessedStripeEventAt`

You need `lastProcessedStripeEventId` for webhook idempotency.

## Backend Interfaces

These are the three endpoints to build:

### `POST /api/billing/create-checkout-session`

Purpose:

- create a hosted Checkout Session for the DanteForge subscription

Request body:

```json
{
  "email": "user@example.com",
  "userId": "usr_123",
  "successUrl": "https://app.example.com/billing/success",
  "cancelUrl": "https://app.example.com/pricing"
}
```

Server behavior:

- look up the current user
- reuse an existing `stripeCustomerId` if present
- otherwise let Checkout create the customer during the session
- create a Checkout Session in `subscription` mode
- use the DanteForge monthly price
- set a 14-day trial
- require payment method collection during Checkout
- attach app metadata to the session and subscription

Recommended session shape:

```ts
await stripe.checkout.sessions.create({
  mode: "subscription",
  line_items: [
    {
      price: process.env.STRIPE_PRICE_ID,
      quantity: 1
    }
  ],
  payment_method_collection: "always",
  customer: existingStripeCustomerId ?? undefined,
  customer_email: existingStripeCustomerId ? undefined : user.email,
  success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: cancelUrl,
  subscription_data: {
    trial_period_days: 14,
    metadata: {
      appUserId: user.id
    }
  },
  metadata: {
    appUserId: user.id
  }
});
```

Response body:

```json
{
  "checkoutUrl": "https://checkout.stripe.com/...",
  "sessionId": "cs_test_..."
}
```

### `POST /api/billing/create-portal-session`

Purpose:

- create a Stripe Customer Portal session so the user can cancel or update billing details without support involvement

Request body:

```json
{
  "userId": "usr_123",
  "returnUrl": "https://app.example.com/account/billing"
}
```

Server behavior:

- require an authenticated app user
- look up `stripeCustomerId`
- create a portal session
- return the portal URL

Example:

```ts
await stripe.billingPortal.sessions.create({
  customer: stripeCustomerId,
  return_url: returnUrl
});
```

### `POST /api/stripe/webhook`

Purpose:

- receive Stripe events and keep DanteForge billing state in sync

Requirements:

- use the raw request body
- verify `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`
- reject invalid signatures
- store processed event IDs so retries do not double-apply state changes

## Webhook Handling Plan

### `checkout.session.completed`

Use this to:

- capture the Checkout Session ID
- persist `stripeCustomerId`
- persist `stripeSubscriptionId` when present
- mark the user as trialing if the subscription is already attached

This is usually the first durable link between your app user and the Stripe customer/subscription objects.

### `customer.subscription.trial_will_end`

Use this to:

- confirm the trial is about to end
- queue a trial-ending email
- verify that a default payment method is attached
- flag accounts that need intervention if billing state looks incomplete

Important note:

Stripe documents this event as firing **three days before the trial ends**. That means your **day-12 email for a 14-day trial should be scheduled from your own `trialEndsAt` timestamp**, not driven only by this webhook.

### `customer.subscription.updated`

Use this to:

- update `subscriptionStatus`
- update `trialEndsAt`
- update `currentPeriodEndsAt`
- update `cancelAtPeriodEnd`
- react to transitions such as:
  - `trialing`
  - `active`
  - `past_due`
  - `unpaid`
  - `paused`

### `customer.subscription.deleted`

Use this to:

- revoke paid access
- mark the subscription as canceled
- keep historical Stripe IDs for finance and support

This is the core cancellation event for self-serve offboarding.

### `invoice.payment_failed`

Use this to:

- flag billing issues
- trigger a failed-payment email or in-app banner
- prompt the user into the Stripe Customer Portal to update payment details

## Trial Behavior Decision

Because the product requires a **card at signup**, use Checkout in subscription mode with:

- `payment_method_collection: "always"`
- a 14-day free trial

This gives you:

- payment details collected up front
- automatic conversion after the trial
- a much cleaner experience than "start free, chase card later"

If the business later wants "trial without card," that is a different flow and should be treated as a product change.

## Customer Portal Requirements

Configure the Stripe Customer Portal to allow:

- cancel subscription
- update payment method
- view invoices
- optionally update billing information

The app should expose a simple "Manage billing" button that calls `POST /api/billing/create-portal-session` and redirects the user to the returned URL.

## Email And Product Hooks

The billing system should support these product-side automations:

- Day 0 welcome email after successful Checkout completion
- Day 3 product-education email driven by app onboarding state
- Day 12 trial-ending email driven by your app scheduler and `trialEndsAt`
- in-app billing banner if `invoice.payment_failed`
- cancellation confirmation after `customer.subscription.deleted`

Do not depend on Stripe alone for the day-12 email because Stripe's `trial_will_end` timing is three days out, not two.

## Environment Variables

Add these when implementation starts:

```bash
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID=
APP_BASE_URL=
```

## Security Requirements

When implementation starts, treat these as non-negotiable:

- verify webhook signatures
- use raw body parsing for the webhook route
- store processed event IDs
- never trust client-reported billing state
- read billing truth from Stripe events and persisted Stripe IDs

## Acceptance Criteria

The Stripe work is complete when:

1. An authenticated user can start Checkout and enter a card.
2. The subscription is created with a 14-day trial and monthly billing at `$20`.
3. The app stores the Stripe customer and subscription IDs.
4. The user can open the Customer Portal and cancel without support help.
5. Webhook retries are idempotent.
6. Trial, cancel, and failed-payment states are reflected correctly in app access control.
7. The day-12 reminder is scheduled from app data, not guessed from webhook timing.

## Official Stripe References

These docs were used for the plan:

- Checkout Sessions create API: <https://docs.stripe.com/api/checkout/sessions/create>
- Subscription trials: <https://docs.stripe.com/billing/subscriptions/trials>
- Subscription webhooks: <https://docs.stripe.com/billing/subscriptions/webhooks>
- Customer Portal API: <https://docs.stripe.com/api/customer_portal>
- Checkout free-trial behavior: <https://docs.stripe.com/payments/checkout/free-trials>
