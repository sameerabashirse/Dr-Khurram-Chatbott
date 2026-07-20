# Dr. Khurram Healthcare WhatsApp AI Appointment Chatbot

Production-oriented Node.js, Express, MongoDB, Vanilla JS, and Meta WhatsApp Cloud API appointment system for Dr. Khurram.

The system includes:

- Public website with appointment booking, lookup, rescheduling, cancellation, token card, privacy, emergency guidance, and WhatsApp entry point.
- Secure staff panel with first Super Admin setup, login, appointments, manual entry, WhatsApp conversations, staff takeover, settings, users, and audit logs.
- MongoDB schemas for staff, patients, appointments, consent, opt-out, conversations, WhatsApp messages, delivery statuses, settings, blocked dates/slots, reminders, notifications, audit logs, and refresh sessions.
- Official Meta WhatsApp Cloud API webhook verification, signature verification, message deduplication, delivery status logging, and sender services.
- OpenAI-powered intent/language classification with deterministic fallback logic.
- Clinic schedule enforcement: Monday-Friday, 9:00 AM to 4:00 PM, Saturday/Sunday closed, no past or expired slots.

## Folder Hierarchy

```text
.
├── index.html
├── style.css
├── script.js
├── assets/
├── server.js
├── src/
│   ├── app.js
│   ├── config/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── services/
│   └── utils/
├── tests/
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── package.json
```

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment file:

```bash
cp .env.example .env
```

3. Start MongoDB locally or with Docker:

```bash
docker compose up -d mongo
```

4. Start the app:

```bash
npm run dev
```

5. Open:

```text
http://localhost:3000
```

## Required Environment Variables

Set all production values before deployment:

```text
MONGODB_URI
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
COOKIE_SECRET
FRONTEND_URL
CORS_ORIGINS
TRUST_PROXY
OPENAI_API_KEY
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_BUSINESS_ACCOUNT_ID
WHATSAPP_VERIFY_TOKEN
META_APP_SECRET
WHATSAPP_TEMPLATE_APPOINTMENT_CONFIRMATION
WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER
WHATSAPP_TEMPLATE_RESCHEDULE_CONFIRMATION
WHATSAPP_TEMPLATE_CANCELLATION_CONFIRMATION
```

Never place these values in `index.html`, `style.css`, or `script.js`.

## Staff Setup

There is no public staff registration and no hardcoded staff account.

1. Open the Staff Panel.
2. If no staff users exist, complete First Super Admin Setup.
3. Sign in with that Super Admin account.
4. Create additional staff users from the Users tab.

Password rules require at least 12 characters with uppercase, lowercase, number, and symbol.

## Meta WhatsApp Cloud API Configuration

1. Create or use a Meta app with WhatsApp product enabled.
2. Add the clinic WhatsApp Business phone number.
3. Copy the phone number ID, business account ID, access token, and app secret into `.env`.
4. Set a strong `WHATSAPP_VERIFY_TOKEN`.
5. Configure webhook callback URL:

```text
https://your-domain.com/api/whatsapp/webhook
```

6. Subscribe to WhatsApp message and message status webhook fields.
7. Create and approve utility templates for confirmation, reminders, reschedule confirmation, and cancellation confirmation.
8. Put approved template names into the matching environment variables.

The backend verifies `X-Hub-Signature-256`, deduplicates incoming Meta message IDs, logs delivery/read/failed statuses, and sends free-form text only inside active conversations. Reminder jobs use template messages.

## OpenAI Configuration

Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL`. If OpenAI is not configured, the system still uses deterministic intent and language fallback handling for core appointment flows.

The assistant is constrained to appointment management, clinic information, safe emergency guidance, and staff escalation. It does not diagnose, prescribe, or replace a doctor.

## Appointment Rules

- Open Monday-Friday only.
- Closed Saturday and Sunday.
- Slots before 09:00 and after 16:00 are rejected.
- Past dates and expired time slots are rejected.
- Active appointments cannot share the same date/time.
- A patient cannot hold duplicate active appointments on the same date.
- Lookup requires appointment ID and phone number.
- Cancellation preserves records and releases slots.
- Rescheduling saves previous date/time history.

## Deployment

Use a production MongoDB deployment, HTTPS, a stable public domain, and environment variables managed by the hosting provider.

Set `TRUST_PROXY` to the verified Hostinger/reverse-proxy topology: use an exact hop count such as `1`, or a comma-separated list of trusted proxy addresses/CIDRs. Leave it `false` without a proxy. The app rejects unsafe `true` and `*` values. Confirm the value from the hosting request path before deployment so `req.ip` identifies clients without trusting arbitrary forwarded headers.

```bash
npm install --omit=dev --no-audit --no-fund
npm start
```

Health endpoints:

```text
GET /api/health
GET /api/health/ready
```

Production checklist:

- Replace all `.env.example` values.
- Use HTTPS only.
- Set exact `CORS_ORIGINS`.
- Ensure MongoDB indexes are created.
- Configure approved WhatsApp templates.
- Verify webhook challenge and signature validation.
- Test booking, lookup, reschedule, cancellation, reminders, staff takeover, and logout.
- Confirm doctor specialty, qualifications, experience, biography, and address before publishing those details.
- Review audit logs after sensitive staff actions.

## Tests

```bash
npm test
npm run test:integration
npm run test:coverage
npm run build
npm run check:dummy-content
npm audit
```

The integration suite uses an ephemeral, isolated MongoDB and never connects to the configured application database. Tests cover authentication limits and lock expiry, repeated successful login, refresh/logout/relogin, proxy identity handling, duplicate submission protection, and clinic slot validation.
