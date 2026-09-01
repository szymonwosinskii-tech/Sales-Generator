// Minimal Odoo JSON-RPC client using Node's built-in fetch (Node 18+).
// Docs: https://www.odoo.com/documentation/latest/developer/reference/external_api.html

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_LOGIN = process.env.ODOO_LOGIN;
const ODOO_API_KEY = process.env.ODOO_API_KEY;

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
// Uses ir.actions.report._render_qweb_pdf (Odoo 17+) which returns [pdf_bytes, report_type].
// The RPC layer base64-encodes bytes automatically for JSON-RPC.
async function getSaleOrderPdf(orderId) {
  const result = await execute("ir.actions.report", "_render_qweb_pdf", [
    "sale.report_saleorder",
    [orderId],
  ]);
  // result is typically [base64_or_raw_content, "pdf"]
  const content = Array.isArray(result) ? result[0] : result;
  if (Buffer.isBuffer(content)) return content;
  return Buffer.from(content, "base64");
}

module.exports = { execute, getSaleOrderPdf };
