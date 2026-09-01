require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const path = require("path");

const odoo = require("./lib/odoo");
const { buildDraftOrder } = require("./lib/claude");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const COOKIE_NAME = "mm_draft_session";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (token && token === sign("authenticated")) return next();
  return res.status(401).json({ error: "Not logged in" });
}

app.post("/login", (req, res) => {
  const { password } = req.body;
  if (password && password === APP_PASSWORD) {
    res.cookie(COOKIE_NAME, sign("authenticated"), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    });
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "Wrong password" });
});

app.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// Main endpoint: pasted text + optional uploaded PDF/image -> Claude drafts the order in Odoo.
app.post("/api/draft-order", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const { text } = req.body;
    if (!text && !req.file) {
      return res.status(400).json({ error: "Provide order text or an uploaded file." });
    }

    const content = [];
    if (text) {
      content.push({ type: "text", text });
    }
    if (req.file) {
      const base64 = req.file.buffer.toString("base64");
      if (req.file.mimetype === "application/pdf") {
        content.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        });
      } else if (req.file.mimetype.startsWith("image/")) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: req.file.mimetype, data: base64 },
        });
      }
      content.push({ type: "text", text: "(Order form attached above.)" });
    }

    const result = await buildDraftOrder(content);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Fetch the Odoo-generated quotation PDF for a drafted order, for preview/download.
app.get("/api/order-pdf/:id", requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!Number.isInteger(orderId)) return res.status(400).send("Invalid order id");
    const pdfBuffer = await odoo.getSaleOrderPdf(orderId);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="order-${orderId}.pdf"`,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Could not fetch PDF: ${err.message}`);
  }
});

app.listen(PORT, () => console.log(`MM draft-order app listening on ${PORT}`));
