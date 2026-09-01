# M&M Draft Order Builder

Internal tool: paste a customer's order (or upload their PDF/photo order form), Claude reads it,
matches products against that customer's own Odoo rental history, and creates a DRAFT quotation
in Odoo (mm-event.odoo.com) for a human to review and send. Never confirms/sends anything itself.

## What's in here
- `server.js` - Express app: password gate, upload handling, the two API routes.
- `lib/odoo.js` - talks to Odoo's JSON-RPC external API (login + execute_kw).
- `lib/claude.js` - calls the Claude API with Odoo tools, runs the tool-calling loop.
- `lib/system-prompt.js` - all the business rules (pricing, venue conventions, etc.) as one string.
- `public/index.html` - the whole frontend: password screen + paste/upload form + result view.

## One-time Odoo setup (if not already done)
1. Create a dedicated Odoo user for this app (e.g. "Draft Bot") with Sales/Rental access only -
   not full admin.
2. On that user's record (as admin): Account Security tab -> API Keys -> New API Key. Copy it -
   Odoo shows it once.
3. Note your Odoo database name (shown in the URL or Settings -> General Settings).

## Deploying to Railway
1. Push this folder to a GitHub repo (or use `railway up` from this folder directly with the
   Railway CLI - no GitHub required).
2. In Railway, create a new project from that repo (or from `railway up`).
3. Under the project's **Variables** tab, add (do NOT commit these anywhere, including this repo):
   - `APP_PASSWORD`
   - `SESSION_SECRET` (any long random string)
   - `ANTHROPIC_API_KEY`
   - `ODOO_URL` (e.g. `https://mm-event.odoo.com`)
   - `ODOO_DB`
   - `ODOO_LOGIN` (the Draft Bot user's login email)
   - `ODOO_API_KEY`
   - `NODE_ENV=production`
4. Railway auto-detects Node and runs `npm install && npm start`. No extra config needed.
5. Once deployed, open the Railway-provided URL, enter the shared password, and test with a real
   pasted order.

## Local testing before deploying
```
cp .env.example .env      # fill in real values
npm install
npm start
```
Then open http://localhost:3000

## Known things to verify against your real Odoo 19 instance
- The PDF-fetch method in `lib/odoo.js` (`getSaleOrderPdf`) calls
  `ir.actions.report._render_qweb_pdf` with report `sale.report_saleorder`. This is the standard
  Odoo 17+ report action but hasn't been tested against this specific instance yet - if it errors,
  check the exact report's technical name in Odoo (Settings > Technical > Reports, search
  "Quotation / Order") and swap it in.
- `lib/system-prompt.js` is a condensed version of the existing Claude Code skill
  (`odoo-rental-order-draft`). As you discover new customer-specific quirks, add them here the
  same way you've been growing the original skill file.

## Security notes
- Rotate the Odoo API key and Anthropic API key if they were ever typed into a chat, email, or
  anywhere outside Railway's Variables and this local setup.
- The shared password only gates the web UI; anyone with the Railway env vars still has real
  Odoo write access, so treat those credentials like a shared admin password.
