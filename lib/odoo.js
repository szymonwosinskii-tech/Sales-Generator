// Minimal Odoo JSON-RPC client using Node's built-in fetch (Node 18+).
// Docs: https://www.odoo.com/documentation/latest/developer/reference/external_api.html

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_LOGIN = process.env.ODOO_LOGIN;
const ODOO_API_KEY = process.env.ODOO_API_KEY;
// API keys are intentionally blocked from web session login (Odoo security design - they're
// scoped to the external API only). PDF fetching needs a real web session, so it needs the
// Draft Bot user's actual password, kept separate from the API key used everywhere else.
const ODOO_PASSWORD = process.env.ODOO_PASSWORD;

let cachedUid = null;

async function jsonRpc(service, method, args) {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args },
      id: Math.floor(Math.random() * 1e9),
    }),
  });
  const data = await res.json();
  if (data.error) {
    const msg =
      data.error?.data?.message || data.error?.message || JSON.stringify(data.error);
    throw new Error(`Odoo error: ${msg}`);
  }
  return data.result;
}

async function login() {
  if (cachedUid) return cachedUid;
  const uid = await jsonRpc("common", "login", [ODOO_DB, ODOO_LOGIN, ODOO_API_KEY]);
  if (!uid) throw new Error("Odoo login failed - check ODOO_DB/ODOO_LOGIN/ODOO_API_KEY");
  cachedUid = uid;
  return uid;
}

// Generic model call, e.g. execute("res.partner", "search_read", [[["name","ilike","Chic Chef"]]], {fields:["id","name"]})
async function execute(model, method, args = [], kwargs = {}) {
  const uid = await login();
  return jsonRpc("object", "execute_kw", [
    ODOO_DB,
    uid,
    ODOO_API_KEY,
    model,
    method,
    args,
    kwargs,
  ]);
}

// Fetch the rendered quotation PDF for a sale.order id as a Buffer.
// The generic execute_kw API can't call _render_qweb_pdf (Odoo blocks private/underscored
// methods from remote calls). Instead we authenticate a normal web session (same mechanism as
// logging into Odoo in a browser) and hit the standard /report/pdf/ controller with that session.
async function getSessionCookie() {
  if (!ODOO_PASSWORD) {
    throw new Error(
      "ODOO_PASSWORD is not set - the Draft Bot user needs a real password (separate from its API key) to fetch report PDFs, since Odoo blocks API keys from web session login."
    );
  }
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_PASSWORD },
    }),
  });
  const data = await res.json();
  if (data.error) {
    const msg = data.error?.data?.message || data.error?.message || JSON.stringify(data.error);
    throw new Error(`Odoo session auth error: ${msg}`);
  }

  let rawCookies;
  if (typeof res.headers.getSetCookie === "function") {
    rawCookies = res.headers.getSetCookie(); // Node 18.19+/20+ undici
  } else {
    rawCookies = [res.headers.get("set-cookie")].filter(Boolean);
  }
  const sessionCookie = rawCookies
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith("session_id="));
  if (!sessionCookie) {
    throw new Error("Odoo didn't return a session cookie - check ODOO_LOGIN/ODOO_API_KEY");
  }
  return sessionCookie;
}

async function getSaleOrderPdf(orderId) {
  const cookie = await getSessionCookie();
  const res = await fetch(`${ODOO_URL}/report/pdf/sale.report_saleorder/${orderId}`, {
    headers: { Cookie: cookie },
  });
  if (!res.ok) {
    throw new Error(`Odoo report fetch failed with status ${res.status}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

module.exports = { execute, getSaleOrderPdf };
