/**
 * 客户端半边的离线冒烟测试：用假的 window/React/ctx 把模块加载、插槽注册、
 * 组件渲染与点击流程走一遍（不依赖浏览器）。
 *
 * 运行：node test/client.mjs
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const CLIENT = join(HERE, "..", "lib", "client.js");
const failures = [];
function check(name, condition, detail) {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

/* ------------------------------------------------------- 伪浏览器环境 */

let loaded = null;
globalThis.window = {
  __ModuleLoader__: {
    load(options) {
      loaded = options;
    },
  },
};
globalThis.document = { documentElement: { lang: "zh-CN" } };

const stubReact = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props || {}), children } };
  },
  useState(initial) {
    return [initial, function () {}];
  },
  useRef(initial) {
    return { current: initial };
  },
  useEffect() {},
  useCallback(fn) {
    return fn;
  },
  useMemo(fn) {
    return fn();
  },
};

await import(pathToFileURL(CLIENT).href);

console.log("模块加载");
check("调用了 __ModuleLoader__.load", loaded !== null);
check("id 正确", loaded?.id === "dsh-prompt-enhancer", loaded?.id);
check("factory 是函数", typeof loaded?.factory === "function");

const mod = loaded.factory(function require(name) {
  if (name === "react") return stubReact;
  throw new Error(`unexpected require: ${name}`);
});
check("导出 inject 含 slots", Array.isArray(mod.inject) && mod.inject.includes("slots"));
check("导出 apply", typeof mod.apply === "function");

/* ------------------------------------------------------------ 插槽注册 */

let injectedKey = null;
let registered = null;
let effectLabel = null;
const ctx = {
  slots: {
    inject(key, callback) {
      injectedKey = key;
      return callback();
    },
    register(options, component) {
      registered = { options, component };
      return function () {};
    },
  },
  effect(callback, label) {
    effectLabel = label;
    return callback();
  },
  get() {
    return undefined;
  },
  logger: console,
};

console.log("插槽注册");
mod.apply(ctx);
check("注入 conversation.input.right", injectedKey === "conversation.input.right", injectedKey);
check("注册 id = prompt-enhancer", registered?.options?.id === "prompt-enhancer", JSON.stringify(registered?.options));
check("注册 order 为数字", typeof registered?.options?.order === "number", String(registered?.options?.order));
check("effect 带标签", typeof effectLabel === "string" && effectLabel.length > 0, String(effectLabel));

/* ---------------------------------------------------------- 组件渲染 */

function renderTree(draft, phase = "plain") {
  const props = {
    sessionId: "s-1",
    useInput(selector) {
      return selector({ draft, phase, attachmentIds: [], draftRev: 1 });
    },
    inputActions: {
      setDraft(value) {
        props.written.push(value);
      },
      submit() {},
    },
    written: [],
  };
  const gate = registered.component;
  const gateTree = gate(props);
  check("Gate 渲染出组件", gateTree && gateTree.type && gateTree.type.name === "PromptEnhancerComponent", String(gateTree?.type?.name));
  const tree = gateTree.type(props);
  return { tree, props };
}

function findButton(node) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "button") return node;
  for (const child of node.props?.children || []) {
    const hit = findButton(child);
    if (hit) return hit;
  }
  return null;
}

console.log("渲染：有空草稿");
const busy = renderTree("  帮我改改登录页  ");
const busyButton = findButton(busy.tree);
check("渲染出 button", Boolean(busyButton));
check("data-mode=idle", busyButton?.props?.["data-mode"] === "idle", String(busyButton?.props?.["data-mode"]));
check("data-empty=false", busyButton?.props?.["data-empty"] === "false", String(busyButton?.props?.["data-empty"]));
check("空闲时未锁定", busyButton?.props?.["data-locked"] === "false", String(busyButton?.props?.["data-locked"]));
check("aria-label 走中文词典", busyButton?.props?.["aria-label"] === "增强提示词", String(busyButton?.props?.["aria-label"]));
check("含内联样式节点", (busy.tree.props.children || []).some((c) => c && c.type === "style"));

console.log("渲染：空草稿");
const idle = renderTree("   \u200B ");
const idleButton = findButton(idle.tree);
check("空草稿仍占位", Boolean(idleButton));
check("data-empty=true", idleButton?.props?.["data-empty"] === "true", String(idleButton?.props?.["data-empty"]));

console.log("点击：空草稿不发请求");
let fetchCalls = 0;
globalThis.fetch = async function () {
  fetchCalls += 1;
  return { ok: true, json: async () => ({ ok: true, text: "不该被调用" }) };
};
idleButton?.props.onClick({});
await new Promise((r) => setTimeout(r, 30));
check("空草稿没有 fetch", fetchCalls === 0, String(fetchCalls));
check("空草稿不写回", idle.props.written.length === 0, JSON.stringify(idle.props.written));

console.log("点击：正常增强");
let sentBody = null;
globalThis.fetch = async function (url, init) {
  fetchCalls += 1;
  sentBody = { url, init };
  return {
    ok: true,
    json: async () => ({ ok: true, text: "把登录页的首屏渲染压到 1 秒以内，并保持现有视觉风格。" }),
  };
};
busyButton?.props.onClick({ preventDefault() {} });
await new Promise((r) => setTimeout(r, 30));
check("发起了 fetch", fetchCalls === 1, String(fetchCalls));
check("打到 /prompt-enhancer/enhance", sentBody?.url === "/prompt-enhancer/enhance", String(sentBody?.url));
check("方法是 POST", sentBody?.init?.method === "POST", String(sentBody?.init?.method));
check(
  "请求体带清理后的文本",
  (() => {
    try {
      return JSON.parse(sentBody?.init?.body).text === "帮我改改登录页";
    } catch {
      return false;
    }
  })(),
  String(sentBody?.init?.body),
);
check("结果写回输入框", busy.props.written[0] === "把登录页的首屏渲染压到 1 秒以内，并保持现有视觉风格。", JSON.stringify(busy.props.written));

console.log("点击：发送中锁定");
const submitting = renderTree("写个函数", "submitting");
const submittingButton = findButton(submitting.tree);
check("data-locked=true", submittingButton?.props?.["data-locked"] === "true", String(submittingButton?.props?.["data-locked"]));
let lockedFetches = 0;
globalThis.fetch = async function () {
  lockedFetches += 1;
  return { ok: true, json: async () => ({ ok: true, text: "x" }) };
};
submittingButton?.props.onClick({});
await new Promise((r) => setTimeout(r, 30));
check("锁定时不发请求", lockedFetches === 0, String(lockedFetches));
check("锁定时不写回", submitting.props.written.length === 0, JSON.stringify(submitting.props.written));

console.log("点击：接口报错不写回");
globalThis.fetch = async function () {
  return { ok: false, json: async () => ({ ok: false, error: "模型未配置" }) };
};
const failing = renderTree("写个函数");
const failingButton = findButton(failing.tree);
failingButton?.props.onClick({});
await new Promise((r) => setTimeout(r, 30));
check("失败不写回", failing.props.written.length === 0, JSON.stringify(failing.props.written));

console.log("");
if (failures.length > 0) {
  console.log(`失败 ${failures.length} 项：${failures.join(" / ")}`);
  process.exitCode = 1;
} else {
  console.log("客户端半边全部通过");
}
