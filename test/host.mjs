/**
 * 主机半边的离线冒烟测试：用假的 ctx / llm / HTTP 对象把路由跑一遍。
 * 运行：node test/host.mjs
 */
import { EventEmitter } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const moduleUrl = pathToFileURL(
  join(HERE, "..", "lib", "index.js"),
).href;

const mod = await import(moduleUrl);
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

/* ----------------------------------------------------------------- mocks */

function makeReq(method, url, payload) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.socket = { remoteAddress: "127.0.0.1" };
  const body = payload === undefined ? "" : JSON.stringify(payload);
  req.chunks = body;
  queueMicrotask(() => {
    if (body) req.emit("data", Buffer.from(body, "utf8"));
    req.emit("end");
  });
  return req;
}

function makeRes() {
  const res = new EventEmitter();
  res.writableEnded = false;
  res.status = 0;
  res.headers = null;
  res.body = "";
  res.writeHead = (status, headers) => {
    res.status = status;
    res.headers = headers;
  };
  res.end = (chunk) => {
    res.body = String(chunk ?? "");
    res.writableEnded = true;
  };
  return res;
}

let route = null;
let llmBehaviour = () => [
  { type: "block-start", index: 0, blockType: "text" },
];

function fakeStream(options) {
  const chunks = llmBehaviour(options);
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

const ctx = {
  webServer: {
    register(registered) {
      route = registered;
      return () => {
        route = null;
      };
    },
  },
  effect(fn) {
    return fn();
  },
  get(name) {
    if (name === "llm") return { stream: (options) => fakeStream(options) };
    if (name === "agentDefaultModel") {
      return {
        currentSelection: () => ({
          provider: "aliyun",
          model: "deepseek-v4.1-flash-1017",
        }),
      };
    }
    return undefined;
  },
  logger: console,
};

/* ------------------------------------------------------------------ run */

console.log("apply()");
mod.apply(ctx);
check("注册了 /prompt-enhancer 前缀路由", route !== null && route.path === "/prompt-enhancer", JSON.stringify(route));
check("路由是 prefix 类型", route?.kind === "prefix");
check("导出 inject 含 webServer", Array.isArray(mod.inject) && mod.inject.includes("webServer"));

async function call(method, path, payload) {
  const req = makeReq(method, path, payload);
  const res = makeRes();
  await route.handler(req, res);
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    json = null;
  }
  return { status: res.status, json, headers: res.headers, raw: res.body };
}

console.log("GET /prompt-enhancer/status");
const status = await call("GET", "/prompt-enhancer/status");
check("status 200", status.status === 200, status.raw);
check("status 报出模型", status.json?.provider === "aliyun" && status.json?.model === "deepseek-v4.1-flash-1017", status.raw);
check("status configured", status.json?.configured === true);

console.log("POST /prompt-enhancer/enhance （正常）");
const captured = [];
llmBehaviour = (options) => {
  captured.push(options);
  return [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text: "  帮我" },
    { type: "text-delta", index: 0, text: "把登录页改快一点。  " },
    { type: "finish", reason: { kind: "stop" } },
  ];
};
const ok = await call("POST", "/prompt-enhancer/enhance", { text: "帮我改改登录页\u200B  " });
check("enhance 200", ok.status === 200, ok.raw);
check("结果已 trim", ok.json?.text === "帮我把登录页改快一点。", ok.raw);
check("未把 system 写成字段外的内容", typeof captured[0]?.system === "string" && captured[0].system.includes("Prompt Engineering Expert"));
check("messages 是一条 user 消息 + text 块", captured[0]?.messages?.length === 1 && captured[0].messages[0].role === "user" && captured[0].messages[0].content[0].type === "text");
check("草稿原文被注入 user 模板", captured[0].messages[0].content[0].text.includes("帮我改改登录页"));
check("带上 temperature / maxTokens", typeof captured[0]?.temperature === "number" && typeof captured[0]?.maxTokens === "number");
check("provider / model 取自默认选择", captured[0]?.provider === "aliyun" && captured[0]?.model === "deepseek-v4.1-flash-1017");
check("带 AbortSignal", captured[0]?.signal instanceof AbortSignal);
check("不允许缓存", ok.headers?.["cache-control"] === "no-store");

console.log("POST /prompt-enhancer/enhance （模型输出了引号/围栏/标签）");
llmBehaviour = () => [
  { type: "text-delta", index: 0, text: '```\n增强后的提示词：\n"把登录页的首屏渲染时间压到 1 秒以内。"\n```' },
  { type: "finish", reason: { kind: "stop" } },
];
const cleaned = await call("POST", "/prompt-enhancer/enhance", { text: "登录页太慢" });
check("剥掉围栏/标签/引号", cleaned.json?.text === "把登录页的首屏渲染时间压到 1 秒以内。", cleaned.raw);

console.log("POST /prompt-enhancer/enhance （空草稿）");
const empty = await call("POST", "/prompt-enhancer/enhance", { text: "   \u200B " });
check("空文本 400", empty.status === 400, empty.raw);
check("空文本有可读错误", typeof empty.json?.error === "string" && empty.json.error.length > 0);

console.log("POST /prompt-enhancer/enhance （模型报错且无内容）");
llmBehaviour = () => [
  { type: "finish", reason: { kind: "error", failure: { message: "upstream 500", code: "SERVER" } } },
];
const bad = await call("POST", "/prompt-enhancer/enhance", { text: "写个函数" });
check("失败 502", bad.status === 502, bad.raw);
check("错误里带上游信息", typeof bad.json?.error === "string" && bad.json.error.includes("upstream 500"), bad.raw);

console.log("POST /prompt-enhancer/enhance （模型返回空文本）");
llmBehaviour = () => [{ type: "text-delta", index: 0, text: "   " }, { type: "finish", reason: { kind: "stop" } }];
const blank = await call("POST", "/prompt-enhancer/enhance", { text: "写个函数" });
check("空结果 502", blank.status === 502, blank.raw);

console.log("未知路径 / 非本机");
const notFound = await call("GET", "/prompt-enhancer/nope");
check("未知端点 404", notFound.status === 404, notFound.raw);

const remoteReq = makeReq("GET", "/prompt-enhancer/status");
remoteReq.socket = { remoteAddress: "10.0.0.9" };
const remoteRes = makeRes();
await route.handler(remoteReq, remoteRes);
check("非回环请求 403", remoteRes.status === 403, remoteRes.body);

console.log("");
if (failures.length > 0) {
  console.log(`失败 ${failures.length} 项：${failures.join(" / ")}`);
  process.exitCode = 1;
} else {
  console.log("主机半边全部通过");
}