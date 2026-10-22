// Car Lookup - cauta detaliile unei masini dupa numarul de inmatriculare (UK)
// Surse gratuite: DVLA Vehicle Enquiry Service + DVSA MOT History API
// Pornire: node server.js   (Node 18 sau mai nou, fara pachete externe)

const http = require("http");
const fs = require("fs");
const path = require("path");

// ---- Citeste .env (fara dotenv) ----
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PORT = process.env.PORT || 3000;
const DVLA_KEY = process.env.DVLA_API_KEY || "";
const MOT = {
  clientId: process.env.MOT_CLIENT_ID || "",
  clientSecret: process.env.MOT_CLIENT_SECRET || "",
  apiKey: process.env.MOT_API_KEY || "",
  tokenUrl: process.env.MOT_TOKEN_URL || "",
  scope: process.env.MOT_SCOPE || "https://tapi.dvsa.gov.uk/.default",
};
const REGCHECK_USER = process.env.REGCHECK_USERNAME || "";
const hasDvla = !!DVLA_KEY;
const hasMot = !!(MOT.clientId && MOT.clientSecret && MOT.apiKey && MOT.tokenUrl);
const hasRegcheck = !!REGCHECK_USER;
let APIFY_TOKEN = process.env.APIFY_TOKEN || "";
let hasApify = !!APIFY_TOKEN && !hasMot; // daca ai cheile MOT proprii, nu mai e nevoie de Apify
let DEMO = !hasDvla && !hasMot && !hasRegcheck && !hasApify;

// ---- Email (SMTP - merge cu orice: Gmail, Outlook, provider propriu) ----
let LOGO_BUFFER = null;
try { LOGO_BUFFER = fs.readFileSync(path.join(__dirname, "assets", "logo.png")); } catch (e) {}
let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch (e) {}
let PDFDocument = null;
try { PDFDocument = require("pdfkit"); } catch (e) {}
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SENDER_EMAIL = process.env.SENDER_EMAIL || SMTP_USER;
const SENDER_NAME = process.env.SENDER_NAME || "DriveCover";
const COVER_LEVEL = process.env.COVER_LEVEL || "Comprehensive";
const EXCESS = process.env.EXCESS || "£250";
const smtpConfigured = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
const hasEmail = smtpConfigured && !!nodemailer;

let mailer = null;
if (hasEmail) {
  mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // 465 = SSL, 587 = STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

const escH = (x) => String(x == null ? "" : x).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function policyNumber(){ return "DC-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(1000 + Math.random()*9000); }

function refCode(){
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = ""; for (let i = 0; i < 14; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
function addCover(from, coverCode){
  const d = new Date(from.getTime());
  if (coverCode === "1h") d.setHours(d.getHours() + 1);
  else if (coverCode === "1d") d.setDate(d.getDate() + 1);
  else if (coverCode === "1w") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1); // custom / necunoscut -> max o luna
  return d;
}
function fmtWhen(dt){
  return dt.toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short",
    year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
function dataUrlToBuffer(dataUrl){
  const m = /^data:(image\/[a-zA-Z]+);base64,(.+)$/.exec(dataUrl || "");
  if (!m) return null;
  try { return { type: m[1], buffer: Buffer.from(m[2], "base64") }; } catch (e) { return null; }
}

function policyHtml(d, pn){
  const row = (k, v) => `<tr><td style="padding:7px 0;color:#5f6b67;font-size:14px">${escH(k)}</td><td style="padding:7px 0;font-weight:700;text-align:right;font-size:14px">${escH(v) || "-"}</td></tr>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0b1714">
    <img src="cid:brandlogo" alt="${escH(SENDER_NAME)}" style="max-width:200px;height:auto;display:block;margin:0 0 14px auto">
    <h2 style="color:#08443a;margin:0 0 6px">Your policy confirmation</h2>
    <p style="font-size:14px">Thanks ${escH(d.name)}, your cover is confirmed. Your policy number is <b>${escH(pn)}</b>.</p>
    <div style="background:#08443a;color:#fff;border-radius:12px;padding:16px;margin:14px 0">
      <div style="font-size:12px;opacity:.8;letter-spacing:.06em">PRICE PAID</div>
      <div style="font-size:26px;font-weight:800">${escH(d.price)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #e3e6e4">
      ${row("Ref code", d.ref)}
      ${row("Valid from", d.validFrom)}
      ${row("Valid until", d.validUntil)}
      ${row("Vehicle", d.vehicle)}
      ${row("Cover length", d.cover)}
      ${row("Name", d.name)}
      ${row("Date of birth", d.dob)}
      ${row("Licence", d.licence)}
      ${row("Address", d.address)}
    </table>
    <p style="color:#8a9592;font-size:12px;margin-top:18px">Your policy has been confirmed. Please keep this email for your records. Your policy documents are attached.</p>
  </div>`;
}

function buildPolicyPdf(d, pn){
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    if (LOGO_BUFFER) { try { doc.image(LOGO_BUFFER, doc.page.width - 50 - 130, 45, { width: 130 }); } catch (e) {} }
    doc.y = 55; doc.x = 50;
    doc.fontSize(22).fillColor("#08443a").font("Helvetica-Bold").text("Policy confirmation", 50, 55);
    doc.moveDown(0.4);
    doc.moveDown(0.8);

    doc.fontSize(11).fillColor("#0b1714").font("Helvetica-Bold").text("Policy number: ", { continued: true }).font("Helvetica").text(pn);
    doc.font("Helvetica-Bold").text("Issued: ", { continued: true }).font("Helvetica").text(new Date().toLocaleString("en-GB"));
    doc.moveDown(0.6);

    // price band
    const y = doc.y;
    doc.save().roundedRect(50, y, 495, 56, 10).fill("#08443a").restore();
    doc.fillColor("#bfe0d5").fontSize(9).font("Helvetica").text("PRICE PAID", 66, y + 12);
    doc.fillColor("#ffffff").fontSize(22).font("Helvetica-Bold").text(String(d.price || "-"), 66, y + 24);
    doc.y = y + 56 + 18;
    doc.x = 50;

    const rows = [["Ref code", d.ref], ["Valid from", d.validFrom], ["Valid until", d.validUntil],
                  ["Vehicle", d.vehicle], ["Cover length", d.cover], ["Name", d.name],
                  ["Date of birth", d.dob], ["Licence", d.licence], ["Email", d.email], ["Address", d.address]];
    rows.forEach(([k, v]) => {
      const ry = doc.y;
      doc.fillColor("#5f6b67").font("Helvetica").fontSize(10).text(k, 50, ry, { width: 130 });
      doc.fillColor("#0b1714").font("Helvetica-Bold").fontSize(12).text(String(v || "-"), 185, ry, { width: 360 });
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#e3e6e4").stroke();
      doc.moveDown(0.4);
    });

    doc.moveDown(1);
    doc.fillColor("#8a9592").font("Helvetica").fontSize(9).text("Your policy has been confirmed. Please keep this email for your records. Your policy documents are attached.");
    doc.end();
  });
}

function certSection(doc, title){
  doc.x = 50;
  doc.moveDown(0.7);
  doc.fillColor("#8a9592").font("Helvetica").fontSize(11).text(title.toUpperCase(), 50, doc.y);
  const ly = doc.y + 2;
  doc.moveTo(50, ly).lineTo(545, ly).strokeColor("#e3e6e4").stroke();
  doc.moveDown(0.5);
}
function certKV(doc, k, v){
  const y = doc.y;
  doc.fillColor("#5f6b67").font("Helvetica").fontSize(10).text(k, 50, y, { width: 150 });
  doc.fillColor("#0b1714").font("Helvetica-Bold").fontSize(12).text(String(v || "-"), 205, y, { width: 340 });
  doc.moveDown(0.55);
}
function buildCertificatePdf(d, pn){
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    if (LOGO_BUFFER) { try { doc.image(LOGO_BUFFER, doc.page.width - 50 - 130, 45, { width: 130 }); } catch (e) {} }
    doc.y = 55; doc.x = 50;
    doc.fontSize(22).fillColor("#08443a").font("Helvetica-Bold").text("Certificate of Motor Insurance", 50, 55);
    doc.moveDown(0.6);
    doc.fontSize(11).fillColor("#0b1714");
    doc.font("Helvetica-Bold").text("Policy number: ", { continued: true }).font("Helvetica").text(pn);
    doc.font("Helvetica-Bold").text("Ref code: ", { continued: true }).font("Helvetica").text(d.ref || "-");
    doc.font("Helvetica-Bold").text("Valid from: ", { continued: true }).font("Helvetica").text(d.validFrom || "-");
    doc.font("Helvetica-Bold").text("Valid until: ", { continued: true }).font("Helvetica").text(d.validUntil || "-");

    certSection(doc, "Vehicle");
    certKV(doc, "Registration mark", d.reg);
    certKV(doc, "VIN", d.vin);
    certKV(doc, "Make", d.make);
    certKV(doc, "Model", d.model);
    certKV(doc, "Colour", d.colour);
    certKV(doc, "Year manufactured", d.year);
    if (d._photoBuffer) {
      try { doc.x = 50; doc.moveDown(0.3); doc.image(d._photoBuffer, 50, doc.y, { fit: [300, 220] }); doc.y = doc.y + 228; } catch (e) {}
    }

    certSection(doc, "Policyholder");
    certKV(doc, "Name", d.name);
    certKV(doc, "Date of birth", d.dob);
    certKV(doc, "Address", d.address);
    certKV(doc, "Email", d.email);

    certSection(doc, "Policy");
    certKV(doc, "Cover length", d.cover);
    certKV(doc, "Cover level", COVER_LEVEL);
    certKV(doc, "Excess", EXCESS);
    certKV(doc, "Price paid", d.price);
    doc.x = 50; doc.moveDown(0.2);
    doc.fillColor("#0b1714").font("Helvetica-Oblique").fontSize(11).text("No incidents declared.", 50, doc.y);

    doc.moveDown(1.2);
    doc.fillColor("#8a9592").font("Helvetica").fontSize(9).text("Your policy has been confirmed. Please keep this certificate for your records.", 50, doc.y);
    doc.end();
  });
}

async function sendPolicyEmail(to, d){
  const pn = policyNumber();
  const now = new Date();
  const until = addCover(now, d.coverCode);
  const photo = dataUrlToBuffer(d.photo);
  const dd = { ...d, email: to, ref: refCode(), validFrom: fmtWhen(now), validUntil: fmtWhen(until),
    photo: photo ? true : "", _photoBuffer: photo ? photo.buffer : null };
  const attachments = [];
  if (LOGO_BUFFER) attachments.push({ filename: "logo.png", content: LOGO_BUFFER, cid: "brandlogo", contentType: "image/png" });
  if (PDFDocument) {
    try {
      const pdf = await buildPolicyPdf(dd, pn);
      attachments.push({ filename: `policy-${pn}.pdf`, content: pdf, contentType: "application/pdf" });
    } catch (e) { /* daca pica PDF-ul, trimitem macar emailul */ }
    try {
      const cert = await buildCertificatePdf(dd, pn);
      attachments.push({ filename: `certificate-${pn}.pdf`, content: cert, contentType: "application/pdf" });
    } catch (e) { /* certificatul e optional */ }
  }
  await mailer.sendMail({
    from: `"${SENDER_NAME}" <${SENDER_EMAIL}>`,
    to: to,
    subject: `Your ${SENDER_NAME} policy ${pn}`,
    html: policyHtml(dd, pn),
    attachments,
  });
  return pn;
}

// Salveaza token-ul Apify in .env direct din pagina
function saveApifyToken(token) {
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  if (/^APIFY_TOKEN=.*$/m.test(content)) content = content.replace(/^APIFY_TOKEN=.*$/m, `APIFY_TOKEN=${token}`);
  else content += (content && !content.endsWith("\n") ? "\n" : "") + `APIFY_TOKEN=${token}\n`;
  fs.writeFileSync(envPath, content);
  APIFY_TOKEN = token;
  hasApify = !hasMot;
  DEMO = !hasDvla && !hasMot && !hasRegcheck && !hasApify;
}

// ---- Apify (cont gratuit, $5 credit/luna, date oficiale MOT) ----
async function apifyMotLookup(reg) {
  const r = await fetch(
    `https://api.apify.com/v2/acts/wildorigins~uk-mot-history/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registration: reg, maxResults: 1 }) }
  );
  const text = await r.text();
  if (!r.ok) {
    let msg = text;
    try { msg = JSON.parse(text).error?.message || text; } catch (e) {}
    throw new Error(`Apify: ${String(msg).slice(0, 200)}`);
  }
  const items = JSON.parse(text);
  const item = Array.isArray(items) ? items.find(i => i && i.registration) : null;
  if (!item) return null;
  item.motTests = (item.motTests || []).map(t => ({
    ...t,
    defects: Array.isArray(t.defects) ? t.defects.map(df => typeof df === "string" ? { text: df, type: "" } : df) : [],
  }));
  return item;
}

// ---- RegCheck (cont rapid, 10 cautari gratuite, apoi platit) ----
async function regcheckLookup(reg) {
  const u = `https://www.regcheck.org.uk/api/reg.asmx/Check?RegistrationNumber=${encodeURIComponent(reg)}&username=${encodeURIComponent(REGCHECK_USER)}`;
  const r = await fetch(u);
  const text = await r.text();
  if (!r.ok) {
    const msg = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    if (/not found|no data|invalid registration/i.test(msg)) return null;
    throw new Error(`RegCheck: ${msg || r.status}`);
  }
  const m = text.match(/<vehicleJson>([\s\S]*?)<\/vehicleJson>/);
  if (!m || !m[1].trim()) return null;
  const raw = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return JSON.parse(raw);
}

// ---- DVLA ----
async function dvlaLookup(reg) {
  const r = await fetch("https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles", {
    method: "POST",
    headers: { "x-api-key": DVLA_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ registrationNumber: reg }),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`DVLA responded with ${r.status}`);
  return r.json();
}

// ---- MOT (token OAuth pastrat in cache) ----
let motToken = null, motTokenExp = 0;
async function getMotToken() {
  if (motToken && Date.now() < motTokenExp - 60000) return motToken;
  const r = await fetch(MOT.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: MOT.clientId,
      client_secret: MOT.clientSecret,
      scope: MOT.scope,
    }),
  });
  if (!r.ok) throw new Error(`MOT token failed (${r.status})`);
  const j = await r.json();
  motToken = j.access_token;
  motTokenExp = Date.now() + (j.expires_in || 3600) * 1000;
  return motToken;
}

async function motLookup(reg) {
  const token = await getMotToken();
  const r = await fetch(`https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(reg)}`, {
    headers: { Authorization: `Bearer ${token}`, "X-API-Key": MOT.apiKey },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`MOT responded with ${r.status}`);
  return r.json();
}

// ---- Date demo (cand nu ai inca chei API) ----
function demoData(reg) {
  return {
    demo: true,
    registration: reg,
    dvla: {
      registrationNumber: reg, make: "AUDI", colour: "BLACK", fuelType: "DIESEL",
      engineCapacity: 2967, yearOfManufacture: 2019, monthOfFirstRegistration: "2019-10",
      co2Emissions: 162, euroStatus: "EURO 6", taxStatus: "Taxed", taxDueDate: "2027-04-01",
      motStatus: "Valid", motExpiryDate: "2027-09-30", wheelplan: "2 AXLE RIGID BODY",
      markedForExport: false, dateOfLastV5CIssued: "2023-05-12",
    },
    mot: {
      registration: reg, make: "AUDI", model: "A8 L", fuelType: "Diesel", primaryColour: "Black",
      engineSize: "2967", firstUsedDate: "2019-10-01", hasOutstandingRecall: "No",
      motTests: [
        { completedDate: "2025-09-28T10:12:00Z", testResult: "PASSED", expiryDate: "2026-10-01", odometerValue: "48210", odometerUnit: "MI",
          defects: [{ text: "Nearside Front Tyre worn close to legal limit", type: "ADVISORY", dangerous: false }] },
        { completedDate: "2024-09-25T14:40:00Z", testResult: "FAILED", odometerValue: "36120", odometerUnit: "MI",
          defects: [{ text: "Offside Rear Brake pad(s) less than 1.5 mm thick", type: "MAJOR", dangerous: false }] },
        { completedDate: "2024-09-26T09:05:00Z", testResult: "PASSED", expiryDate: "2025-09-30", odometerValue: "36125", odometerUnit: "MI", defects: [] },
        { completedDate: "2022-09-20T11:30:00Z", testResult: "PASSED", expiryDate: "2023-09-30", odometerValue: "21500", odometerUnit: "MI", defects: [] },
      ],
    },
    errors: [],
  };
}

function cleanReg(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ---- Server ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/setup" && req.method === "POST") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const ip = req.socket.remoteAddress || "";
    if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip)) {
      res.writeHead(403);
      return res.end(JSON.stringify({ error: "Setup can only be done from your own computer" }));
    }
    let body = "";
    for await (const chunk of req) { body += chunk; if (body.length > 2000) break; }
    let token = "";
    try { token = String(JSON.parse(body).token || "").trim(); } catch (e) {}
    if (!/^apify_api_[A-Za-z0-9]{20,}$/.test(token)) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: "The token doesn't look right. It must start with apify_api_" }));
    }
    saveApifyToken(token);
    console.log("Token Apify salvat. MOT: activ (prin Apify)");
    return res.end(JSON.stringify({ ok: true }));
  }

  if (url.pathname === "/api/policy" && req.method === "POST") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    let body = "";
    for await (const chunk of req) { body += chunk; if (body.length > 8000000) break; }
    let d = {};
    try { d = JSON.parse(body); } catch (e) {}
    const to = String(d.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: "Invalid email address" }));
    }
    if (smtpConfigured && !nodemailer) {
      res.writeHead(500);
      return res.end(JSON.stringify({ error: "Email library not installed. Run: npm install" }));
    }
    if (!hasEmail) {
      return res.end(JSON.stringify({ ok: true, demo: true }));
    }
    try {
      const pn = await sendPolicyEmail(to, d);
      return res.end(JSON.stringify({ ok: true, policy: pn }));
    } catch (err) {
      res.writeHead(500);
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  if (url.pathname === "/api/lookup") {
    const reg = cleanReg(url.searchParams.get("reg"));
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (!/^[A-Z0-9]{2,8}$/.test(reg)) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: "Invalid registration number" }));
    }
    if (DEMO) {
      if (process.env.SHOW_DEMO === "1") return res.end(JSON.stringify(demoData(reg)));
      return res.end(JSON.stringify({ registration: reg, noKeys: true }));
    }

    const [d, m, rc] = await Promise.allSettled([
      hasDvla ? dvlaLookup(reg) : Promise.resolve(undefined),
      hasMot ? motLookup(reg) : hasApify ? apifyMotLookup(reg) : Promise.resolve(undefined),
      hasRegcheck ? regcheckLookup(reg) : Promise.resolve(undefined),
    ]);
    const out = { registration: reg, dvla: null, mot: null, regcheck: null, errors: [] };
    if (d.status === "fulfilled") out.dvla = d.value ?? null; else out.errors.push(d.reason.message);
    if (m.status === "fulfilled") out.mot = m.value ?? null; else out.errors.push(m.reason.message);
    if (rc.status === "fulfilled") out.regcheck = rc.value ?? null; else out.errors.push(rc.reason.message);
    if (!out.dvla && !out.mot && !out.regcheck && !out.errors.length) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: "Vehicle not found" }));
    }
    return res.end(JSON.stringify(out));
  }

  // ---- Fisiere statice din folderul public/ ----
  const MIME = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8",
    ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8",
    ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".gif":"image/gif",
    ".svg":"image/svg+xml", ".ico":"image/x-icon", ".webp":"image/webp" };
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const pubDir = path.join(__dirname, "public");
  const filePath = path.join(pubDir, path.normalize(pathname));
  if (!filePath.startsWith(pubDir)) { res.writeHead(403); return res.end("Forbidden"); }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.setHeader("Content-Type", MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream");
    return res.end(fs.readFileSync(filePath));
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Car Lookup ruleaza pe http://localhost:${PORT}`);
  console.log(DEMO
    ? "Nu e conectata inca: deschide pagina in browser si lipeste token-ul Apify."
    : `DVLA: ${hasDvla ? "activ" : "-"} | MOT: ${hasMot ? "activ" : hasApify ? "activ (prin Apify)" : "-"} | RegCheck: ${hasRegcheck ? "activ" : "-"} | Email: ${hasEmail ? "activ" : "-"}`);
});
