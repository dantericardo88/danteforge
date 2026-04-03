# Waitlist Email Capture Setup

The landing page is ready except for the email capture endpoint. The forms currently point to `https://example.com/waitlist` (placeholder).

## Option 1: ConvertKit (Recommended for indie launches)

**Why:** Free up to 1,000 subscribers, easy automation, good deliverability.

**Setup:**
1. Create free ConvertKit account at [convertkit.com](https://convertkit.com)
2. Create a new Form in ConvertKit dashboard
3. Get the form action URL (looks like: `https://app.convertkit.com/forms/XXXXXXX/subscriptions`)
4. Replace both form `action` attributes in index.html:

```html
<!-- Line ~596 -->
<form action="https://app.convertkit.com/forms/XXXXXXX/subscriptions" method="post">

<!-- Line ~716 -->
<form action="https://app.convertkit.com/forms/XXXXXXX/subscriptions" method="post">
```

**No backend required.** ConvertKit handles everything.

---

## Option 2: Mailchimp

**Why:** Industry standard, powerful automation, larger free tier (500 subscribers).

**Setup:**
1. Create Mailchimp account
2. Create an Audience
3. Create an embedded form
4. Get the form action URL from the generated code
5. Update both forms in index.html with the Mailchimp endpoint

**Gotcha:** Mailchimp's default form markup is heavy. You only need the `action` URL - keep your existing HTML.

---

## Option 3: Simple serverless function (Vercel/Netlify)

**Why:** Full control, no vendor lock-in, works with any email provider.

**Setup:**
1. Create a serverless function that accepts POST requests
2. Validate email format
3. Store in your preferred database or forward to email service
4. Return success/error JSON

**Example Vercel function** (`/api/waitlist.js`):

```javascript
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, source } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  // Add your email service integration here
  // Examples: SendGrid, Postmark, your own DB

  return res.status(200).json({ success: true });
}
```

Update forms to point to `/api/waitlist` and add client-side fetch handling.

---

## Option 4: Google Sheets (Quick and dirty)

**Why:** Zero setup, instant visibility, good for validating demand before building infrastructure.

**Setup:**
1. Use Google Forms or Apps Script Web App
2. Create a form that writes to a Google Sheet
3. Get the deployment URL
4. Point both forms to that URL

**Gotcha:** Google's form submission redirects to a confirmation page. You'll need to handle that with JavaScript or use Apps Script to return JSON.

---

## Current blocking status

**Item 1:** ✓ Gap in waitlist card fixed (added three feature bullets)  
**Item 2:** ✓ Eyebrow text changed to "Built for developers who are done hitting Claude's limits"  
**Item 3:** ⚠️ Email capture endpoint still needs real provider

**Next step:** Choose a provider and I'll update the form actions immediately.

**My recommendation:** Start with ConvertKit. It's free for your first 1,000 subscribers, handles deliverability and unsubscribe compliance automatically, and you can migrate to something more complex later if needed. Total setup time: 5 minutes.
