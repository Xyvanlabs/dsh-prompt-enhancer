/**
 * dsh-prompt-enhancer — 主机侧。
 *
 * 职责只有两件事：
 *   1) 注册一个只走本机回环的 HTTP 端点，供本插件的客户端半边调用；
 *   2) 用当前会话的默认模型做一次「一次性」LLM 调用，把草稿改写成更好的提示词。
 *
 * 客户端半边（lib/client.js）不知道 provider/model，也不接触任何凭证，
 * 它只 POST 一段文本、拿回改写结果。
 */

const ROOT = "/prompt-enhancer";

/** 请求体上限：草稿再长也不该超过这个量级。 */
const MAX_BODY_BYTES = 128 * 1024;
/** 送进模型的草稿字数上限，超出直接拒绝而不是偷偷截断。 */
const MAX_INPUT_CHARS = 12000;
/** 单次增强的最长等待时间。 */
const TIMEOUT_MS = 120 * 1000;
const TEMPERATURE = 0.5;
const MAX_TOKENS = 1400;

const SYSTEM_PROMPT = `You are a Prompt Engineering Expert. You work on the draft a user is about to send to a coding AI assistant — an agent that has tools, can read files, run commands, and edit a workspace.

Your only job: rewrite that draft into a clearer, more specific, more actionable prompt for that assistant. You are NOT the assistant in this conversation. Never answer the request, never write the code or content it asks for, never act out the task, never reply as if you were being addressed.

Silent analysis routine (do this without writing it down):
1. Identify the user's primary goal and the concrete deliverable they expect.
2. List what the draft leaves ambiguous: missing constraints, missing context, unstated acceptance criteria, undefined terms.
3. Decide which of those actually matter for a good answer, and which are irrelevant noise.
4. Remove redundancy, filler, and vague wording.
5. Rewrite.

Rewriting principles:
- Keep every requirement the user already stated. Constraint preservation beats elegance.
- Be specific and concrete: replace vague words with observable outcomes.
- Add only what the draft implies. Never invent unrelated requirements, technologies, file paths, libraries, or steps.
- Make scope, constraints, and key parameters explicit when they matter, and say what "done" looks like.
- Specify the expected output shape when the result format matters (code diff, plan, table, prose, command).
- Preserve the draft's tone and complexity: a short draft must stay short; a detailed one may stay detailed.
- Do not turn the prompt into a tutorial, do not add generic advice, and do not ask the user questions.
- Do not tell the assistant to ask for code or files that the user has not provided and cannot be assumed to exist.
- Do not end with an empty list, a dangling colon, or an unfinished thought.

CRITICAL — LANGUAGE: write the enhanced prompt in exactly the language the draft is written in. Chinese draft → Chinese prompt. English draft → English prompt. Mixed draft → mixed prompt. Never translate, never switch languages, and never write a label such as "Language: Chinese" or "语言：中文".

CRITICAL — LENGTH: keep the result within roughly 800 characters, and never longer than about twice the draft. When the draft is short, a tight 2-3 sentence rewrite is correct; padding is a failure.

CRITICAL — OUTPUT FORMAT: return the enhanced prompt text only. No preamble, no explanation of your changes, no markdown code fence, no surrounding quotes, no headings like "Enhanced prompt:".`;

const USER_TEMPLATE = `Rewrite the draft below into an enhanced prompt, following every rule in the system instruction.

<draft>
{{DRAFT}}
</draft>

Checklist before you answer:
- The rewrite keeps the draft's original intent and its language.
- The rewrite is more specific and more actionable than the draft.
- Nothing was invented that the draft does not imply.
- The result reads as something the user would send, not as an essay about what to send.
- The output contains only the rewritten prompt.`;

export const name = "prompt-enhancer";

/** 硬依赖：HTTP 路由载体。llm / agentDefaultModel 是可选依赖，运行时用 ctx.get 取。 */
export const inject = ["webServer"];

/**
 * @param {any} ctx cordis 上下文
 */
export function apply(ctx) {
  const webServer = ctx.webServer;
  if (!webServer || typeof webServer.register !== "function") {
    ctx.logger?.warn?.("prompt-enhancer: webServer 服务不可用，按钮端点未注册");
    return;
  }

  const handler = async (req, res) => {
    let pathname = "/";
    try {
      pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
    } catch {
      pathname = "/";
    }

    if (!isLoopback(req)) {
      send(res, 403, { ok: false, error: "仅允许本机回环请求" });
      return;
    }

    try {
      if (req.method === "GET" && pathname === `${ROOT}/status`) {
        const target = pickModel(ctx);
        send(res, 200, {
          ok: true,
          version: "0.1.0",
          configured: Boolean(target),
          provider: target?.provider ?? null,
          model: target?.model ?? null,
        });
        return;
      }

      if (req.method === "POST" && pathname === `${ROOT}/enhance`) {
        await handleEnhance(ctx, req, res);
        return;
      }

      send(res, 404, { ok: false, error: "未知端点" });
    } catch (error) {
      send(res, 500, { ok: false, error: describe(error) });
    }
  };

  ctx.effect(
    () => webServer.register({ kind: "prefix", path: ROOT, handler }),
    "prompt-enhancer: 增强端点",
  );
}

async function handleEnhance(ctx, req, res) {
  const body = await readJson(req);
  const draft = normalizeDraft(body?.text);
  if (!draft) {
    send(res, 400, { ok: false, error: "请输入需要增强的内容" });
    return;
  }
  if (draft.length > MAX_INPUT_CHARS) {
    send(res, 413, {
      ok: false,
      error: `内容过长（${draft.length} 字），请控制在 ${MAX_INPUT_CHARS} 字以内`,
    });
    return;
  }

  const llm = ctx.get("llm");
  if (!llm || typeof llm.stream !== "function") {
    send(res, 503, { ok: false, error: "llm 服务不可用，无法调用模型" });
    return;
  }

  const target = pickModel(ctx);
  if (!target) {
    send(res, 503, { ok: false, error: "没有可用的默认模型，请先在设置里选择模型" });
    return;
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const onClose = () => controller.abort();
  res.once("close", onClose);
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let text = "";
  let failure = null;
  let finishKind = "";

  try {
    const stream = llm.stream({
      provider: target.provider,
      model: target.model,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: USER_TEMPLATE.replace("{{DRAFT}}", () => draft) },
          ],
        },
      ],
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      signal: controller.signal,
    });

    for await (const chunk of stream) {
      if (chunk?.type === "text-delta") {
        text += chunk.text ?? "";
      } else if (chunk?.type === "finish") {
        const reason = chunk.reason;
        finishKind = typeof reason?.kind === "string" ? reason.kind : "";
        if (reason && (reason.kind === "error" || reason.kind === "aborted")) {
          failure = reason.failure ?? { message: reason.kind, code: reason.kind };
        }
      }
    }
  } catch (error) {
    failure = { message: describe(error), code: "TRANSPORT" };
  } finally {
    clearTimeout(timer);
    res.off("close", onClose);
  }

  if (res.writableEnded || controller.signal.aborted) {
    // 客户端已断开或超时：不再写响应。
    if (!res.writableEnded && failure?.code === "aborted") {
      send(res, 504, { ok: false, error: "增强超时，请重试" });
    }
    return;
  }

  const cleaned = cleanResult(text);
  if (!cleaned) {
    const detail = failure?.message ? `：${failure.message}` : "";
    send(res, 502, { ok: false, error: `模型没有返回可用内容${detail}` });
    return;
  }

  send(res, 200, {
    ok: true,
    text: cleaned,
    provider: target.provider,
    model: target.model,
    elapsedMs: Date.now() - startedAt,
    truncated: finishKind === "max-tokens",
  });
}

/** 取当前默认模型。 */
function pickModel(ctx) {
  try {
    const service = ctx.get("agentDefaultModel");
    if (!service || typeof service.currentSelection !== "function") return null;
    const selection = service.currentSelection();
    if (!selection || !selection.provider || !selection.model) return null;
    return { provider: String(selection.provider), model: String(selection.model) };
  } catch {
    return null;
  }
}

function normalizeDraft(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\u200B/g, "").trim();
}

/**
 * 模型偶尔会带引号、代码围栏或「增强后的提示词：」这样的标签，统一剥掉。
 */
function cleanResult(raw) {
  let text = normalizeDraft(raw);
  if (!text) return "";

  const fenced = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$/.exec(text);
  if (fenced) text = fenced[1].trim();

  text = stripLabel(text);
  text = stripWrappingQuotes(text);
  return text.trim();
}

const LABELS = [
  /^(enhanced prompt|improved prompt|rewritten prompt|optimized prompt|result)\s*[:：]\s*/i,
  /^(增强后的提示词|优化后的提示词|改写后的提示词|增强结果|改写结果|提示词)\s*[:：]\s*/,
  /^(language|语言)\s*[:：]\s*[^\n]{0,20}\n+/i,
];

function stripLabel(text) {
  let out = text;
  for (const pattern of LABELS) {
    const next = out.replace(pattern, "");
    if (next !== out) out = next.trim();
  }
  return out;
}

const QUOTES = new Set(['"', "'", "“", "”", "‘", "’", "「", "」"]);

function stripWrappingQuotes(text) {
  if (text.length < 2) return text;
  const head = text[0];
  const tail = text[text.length - 1];
  if (QUOTES.has(head) && QUOTES.has(tail)) return text.slice(1, -1).trim();
  return text;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? "";
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address === ""
  );
}

function send(res, status, payload) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function describe(error) {
  if (!error) return "未知错误";
  if (typeof error === "string") return error;
  return error.message || String(error);
}