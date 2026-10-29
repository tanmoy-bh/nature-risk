// Passphrase gate for the whole site.
//
// The passphrase never ships to the browser: it lives in the Pages secret
// ACCESS_PASSPHRASE (set from the GitHub secret NATURE_RISK_PASSPHRASE by the
// deploy workflow). A correct passphrase sets an HttpOnly cookie holding an
// HMAC of a fixed message keyed by the passphrase, so changing the passphrase
// signs everyone out.
//
// Works both on the pages.dev host and behind the projects hub, which proxies
// projects.tanmoybh.com/nature-risk/* here. All links and form actions are
// relative and cookies carry no Path, so the browser scopes them to
// /nature-risk on the hub.

const COOKIE = "nr_access";
const MAX_AGE = 60 * 60 * 24 * 14; // 14 days
const enc = new TextEncoder();

async function tokenFor(passphrase) {
  const key = await crypto.subtle.importKey("raw", enc.encode(passphrase), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("nature-risk-desk:access:v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameString(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
};

function redirectHome(request, extra = {}) {
  // Absolute pages.dev URL; the hub rewrites it to /nature-risk/.
  return new Response(null, { status: 303, headers: { Location: new URL("/", request.url).toString(), ...privateHeaders, ...extra } });
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const passphrase = env.ACCESS_PASSPHRASE;
  if (!passphrase) {
    return new Response("Access is not configured yet: set the ACCESS_PASSPHRASE secret.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", ...privateHeaders } });
  }
  const expected = await tokenFor(passphrase);

  // Public assets the lock screen itself needs.
  if (url.pathname === "/favicon.svg" || url.pathname === "/robots.txt") return next();

  if (url.pathname === "/__logout") {
    return redirectHome(request, { "Set-Cookie": `${COOKIE}=; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
  }

  if (url.pathname === "/__auth") {
    if (request.method !== "POST") return redirectHome(request);
    let given = "";
    try {
      const form = await request.formData();
      given = String(form.get("passphrase") || "").trim();
    } catch { /* fall through as wrong */ }
    if (given && sameString(await tokenFor(given), expected)) {
      return redirectHome(request, { "Set-Cookie": `${COOKIE}=${expected}; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax` });
    }
    await new Promise((r) => setTimeout(r, 700)); // slow down guessing
    return lockScreen(true);
  }

  if (sameString(readCookie(request, COOKIE), expected)) {
    const res = await next();
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(privateHeaders)) out.headers.set(k, v);
    return out;
  }
  return lockScreen(false);
}

function lockScreen(wrong) {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Nature Risk Desk</title>
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<style>
:root{--bg:#F2F2F7;--card:#FFFFFF;--ink:#000;--muted:#6E6E73;--fill:rgba(118,118,128,.12);--line:#E5E5EA;--accent:#248A3D;--accent-ink:#fff;--err:#D70015;
  --font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Inter","Segoe UI",Roboto,system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1C1C1E;--ink:#fff;--muted:#98989F;--fill:rgba(118,118,128,.24);--line:#38383A;--accent:#30D158;--accent-ink:#000;--err:#FF6961;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.47 var(--font);-webkit-font-smoothing:antialiased;
  padding:24px max(16px,env(safe-area-inset-right)) 24px max(16px,env(safe-area-inset-left))}
.card{width:100%;max-width:380px;background:var(--card);border-radius:20px;padding:32px 28px;display:flex;flex-direction:column;gap:18px;text-align:center}
.icon{width:56px;height:56px;margin:0 auto;border-radius:14px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}
h1{margin:0;font-size:24px;font-weight:700;letter-spacing:-.02em}
p{margin:0;color:var(--muted)}
form{display:flex;flex-direction:column;gap:10px;margin-top:4px}
input{font:inherit;font-size:17px;padding:12px 14px;border-radius:12px;border:0;background:var(--fill);color:var(--ink);outline:none;text-align:center}
input:focus{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 45%,transparent)}
button{font:inherit;font-size:17px;font-weight:600;padding:12px;border:0;border-radius:12px;background:var(--accent);color:var(--accent-ink);cursor:pointer}
button:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 45%,transparent);outline-offset:2px}
.err{color:var(--err);font-size:14px}
.foot{font-size:12px;color:var(--muted)}
</style></head><body>
<main class="card">
  <div class="icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24"><path d="M12 3c-4 3-6.5 6.4-6.5 10A6.5 6.5 0 0 0 12 19.5 6.5 6.5 0 0 0 18.5 13C18.5 9.4 16 6 12 3Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v13" stroke="currentColor" stroke-width="1.8"/></svg></div>
  <h1>Nature Risk Desk</h1>
  <p>This proof of concept is private. Enter the passphrase you were given.</p>
  <form method="post" action="__auth" autocomplete="off">
    <label for="passphrase" style="position:absolute;left:-9999px">Passphrase</label>
    <input id="passphrase" name="passphrase" type="password" placeholder="Passphrase" required autofocus autocapitalize="off" autocorrect="off" spellcheck="false"${wrong ? ' aria-describedby="err" aria-invalid="true"' : ""}>
    ${wrong ? '<p class="err" id="err" role="alert">That passphrase is not right. Check it and try again.</p>' : ""}
    <button type="submit">Open</button>
  </form>
  <p class="foot">Built by Tanmoy Bhattacharjee</p>
</main>
</body></html>`;
  return new Response(html, { status: 401, headers: { "Content-Type": "text/html; charset=utf-8", ...privateHeaders } });
}
