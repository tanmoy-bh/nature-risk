// One structured-output call to a model through OpenRouter, used by /api/note and /api/explain.
// The key comes only from env.OPENROUTER_API_KEY (a Pages secret).

export const DEFAULT_MODEL = "google/gemini-3.8-flash";
export const modelOf = (env) => env.OPENROUTER_MODEL || DEFAULT_MODEL;

export async function askJSON(env, { system, user, schema, name, timeoutMs = 25000 }) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: ac.signal,
      headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json", "X-Title": "Nature Risk Desk" },
      body: JSON.stringify({
        model: modelOf(env),
        temperature: 0.2,
        // Gemini 3 "thinks" before answering, and thinking counts against max_tokens: keep it minimal and leave room.
        reasoning: { effort: "minimal" },
        max_tokens: 1500,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
      }),
    });
    if (!r.ok) return { error: `model HTTP ${r.status}` };
    const data = await r.json();
    const choice = data?.choices?.[0] || {}, content = choice.message?.content, finish = choice.finish_reason || "unknown";
    if (content && typeof content === "object") return { reply: content };
    if (typeof content !== "string" || !content.trim()) return { error: `model reply empty (finish: ${finish})` };
    const reply = parseLoose(content);
    return reply ? { reply } : { error: `model reply unreadable (finish: ${finish}, ${content.length} chars)` };
  } catch (e) {
    return { error: e.name === "AbortError" ? "model timed out" : "model reply unreadable (request failed)" };
  } finally {
    clearTimeout(timer);
  }
}

// JSON from a reply that may be wrapped in a code fence or a sentence; null if there is no complete object.
function parseLoose(text) {
  try { return JSON.parse(text); } catch {}
  const i = text.indexOf("{"), j = text.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(text.slice(i, j + 1)); } catch { return null; }
}

// A short, stable hash of the results file, so caches reset when the model is rebuilt.
export async function shortHash(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" } });
