/**
 * dsh-prompt-enhancer — 客户端半边。
 *
 * 往 composer（会话输入框）右下角、发送按钮之前的 `conversation.input.right`
 * 插槽里放一颗提示词增强按钮，三态复用同一个位置：
 *   空闲 → 点击 = 把草稿改写成更好的提示词
 *   增强中 → 点击 = 取消
 *   已增强 → 点击 = 还原原文
 *
 * 改写请求走主机半边的 `/prompt-enhancer/enhance`，客户端不接触模型与凭证。
 */
window.__ModuleLoader__.load({
  id: "dsh-prompt-enhancer",
  factory(require) {
    const React = require("react");
    const h = React.createElement;

    const SLOT = "conversation.input.right";
    const ENDPOINT = "/prompt-enhancer/enhance";
    const MAX_INPUT_CHARS = 12000;

    const STRINGS = {
      zh: {
        idle: "增强提示词",
        busy: "增强中…（点击取消）",
        done: "还原原文",
        empty: "先输入内容再增强",
        tooLong: `内容过长，请控制在 ${MAX_INPUT_CHARS} 字以内`,
        blocked: "正在发送消息，暂时无法改写输入框",
        diverged: "输入内容已变化，增强结果已丢弃",
        failed: "增强失败：",
        notWritten: "无法写回输入框，请重试",
        aborted: "已取消增强",
      },
      en: {
        idle: "Enhance prompt",
        busy: "Enhancing… (click to cancel)",
        done: "Revert original",
        empty: "Type something to enhance",
        tooLong: `Too long — keep it under ${MAX_INPUT_CHARS} characters`,
        blocked: "A message is being sent; the draft is locked",
        diverged: "Draft changed — result discarded",
        failed: "Enhance failed: ",
        notWritten: "Could not write back to the composer",
        aborted: "Enhancement cancelled",
      },
    };

    const CSS = [
      ".dsh-pe-root{display:inline-flex;align-items:center;flex:0 0 auto}",
      ".dsh-pe-btn{appearance:none;border:0;margin:0;padding:0;width:28px;height:28px;display:grid;place-items:center;border-radius:999px;background:var(--dsw-specific-selector,transparent);color:var(--dsw-alias-label-secondary,#6b6b6b);cursor:pointer;transition:background-color .15s ease,color .15s ease,opacity .15s ease}",
      ".dsh-pe-btn:hover{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#1a1a1a)}",
      ".dsh-pe-btn:active{opacity:.72}",
      ".dsh-pe-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:2px}",
      '.dsh-pe-btn[data-empty="true"]{opacity:.42}',
      '.dsh-pe-btn[data-locked="true"]{opacity:.42;cursor:not-allowed}',
      '.dsh-pe-btn[data-locked="true"]:hover{background:transparent;color:var(--dsw-alias-label-secondary,#6b6b6b)}',
      '.dsh-pe-btn[data-mode="done"]{color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.dsh-pe-btn[data-mode="error"]{color:var(--dsw-alias-state-error-primary,#d92d20)}',
      ".dsh-pe-spin{animation:dsh-pe-rotate .9s linear infinite}",
      "@keyframes dsh-pe-rotate{to{transform:rotate(360deg)}}",
      ".dsh-pe-tip{position:fixed;z-index:2147483000;padding:6px 9px;border-radius:8px;max-width:min(280px,60vw);font:500 12px/1.45 system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#fff;background:rgba(30,30,32,.95);box-shadow:0 6px 20px rgba(0,0,0,.22);pointer-events:none;white-space:normal;word-break:break-word;transform:translateX(-50%)}",
      '.dsh-pe-tip[data-tone="error"]{background:rgba(176,36,26,.97)}',
    ].join("\n");

    function lang() {
      const raw =
        (typeof document !== "undefined" && document.documentElement
          ? document.documentElement.lang
          : "") || "";
      return /^zh/i.test(raw) ? "zh" : "en";
    }

    function dict() {
      return STRINGS[lang()] || STRINGS.zh;
    }

    function normalizeDraft(value) {
      return typeof value === "string" ? value.replace(/\u200B/g, "").trim() : "";
    }

    function errorText(error) {
      if (!error) return "unknown error";
      if (typeof error === "string") return error;
      return error.message ? String(error.message) : String(error);
    }

    /* ---------------------------------------------------------------- icons */

    function sparkleIcon() {
      return h(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: 18,
          height: 18,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.7,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        h("path", {
          key: "a",
          d: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
        }),
        h("path", { key: "b", d: "M20 3v4" }),
        h("path", { key: "c", d: "M22 5h-4" }),
        h("path", { key: "d", d: "M4 17v2" }),
        h("path", { key: "e", d: "M5 18H3" }),
      );
    }

    function revertIcon() {
      return h(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: 18,
          height: 18,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.9,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        h("path", { key: "a", d: "M9 14 4 9l5-5" }),
        h("path", { key: "b", d: "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11" }),
      );
    }

    function spinnerIcon() {
      return h(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: 18,
          height: 18,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 2,
          strokeLinecap: "round",
          "aria-hidden": "true",
          className: "dsh-pe-spin",
        },
        h("path", { key: "a", d: "M12 3a9 9 0 1 0 9 9", opacity: 1 }),
        h("circle", { key: "b", cx: 12, cy: 12, r: 9, opacity: 0.18 }),
      );
    }

    /* ------------------------------------------------------------ component */

    function PromptEnhancerComponent(props) {
      const { useInput, inputActions, sessionId } = props;

      const draft = useInput(function (state) {
        return state.draft;
      });
      const phase = useInput(function (state) {
        return state.phase;
      });

      const [mode, setMode] = React.useState("idle");
      const [error, setError] = React.useState("");
      const [tip, setTip] = React.useState(null);

      const buttonRef = React.useRef(null);
      const backupRef = React.useRef(null);
      const abortRef = React.useRef(null);
      const seqRef = React.useRef(0);
      const latestDraftRef = React.useRef(draft);
      latestDraftRef.current = draft;

      const text = normalizeDraft(draft);
      const empty = text.length === 0;
      /* 输入框空闲相位是 "plain" / "claimed"（带命令 chip），其余（adjudicating /
         submitting / frozen…）都算占用中，此时写草稿会被拒绝。 */
      const locked =
        typeof phase === "string" && phase !== "plain" && phase !== "claimed";
      const hasBackup = mode === "done" && backupRef.current !== null;

      /* 用户在「已增强」之后又动了输入框：结果作废，回到空闲态。 */
      React.useEffect(
        function () {
          if (mode !== "done") return;
          const backup = backupRef.current;
          if (!backup) return;
          if (normalizeDraft(draft) !== normalizeDraft(backup.after)) {
            backupRef.current = null;
            seqRef.current += 1;
            setMode("idle");
          }
        },
        [draft, mode],
      );

      /* 换会话：清理正在进行的请求与状态。 */
      React.useEffect(
        function () {
          return function () {
            seqRef.current += 1;
            if (abortRef.current) {
              abortRef.current.abort();
              abortRef.current = null;
            }
          };
        },
        [sessionId],
      );

      /* 错误提示几秒后自动消失。 */
      React.useEffect(
        function () {
          if (!error) return undefined;
          const timer = setTimeout(function () {
            setError("");
          }, 6000);
          return function () {
            clearTimeout(timer);
          };
        },
        [error],
      );

      function placeTip() {
        const node = buttonRef.current;
        if (!node || typeof window === "undefined") return;
        const rect = node.getBoundingClientRect();
        setTip({
          left: Math.round(rect.left + rect.width / 2),
          bottom: Math.round(window.innerHeight - rect.top + 8),
        });
      }

      function showTip() {
        placeTip();
      }

      function hideTip() {
        setTip(null);
      }

      function label(t) {
        if (error) return error;
        if (mode === "busy") return t.busy;
        if (hasBackup) return t.done;
        return t.idle;
      }

      async function enhance(t) {
        if (empty) {
          setError(t.empty);
          placeTip();
          return;
        }
        if (text.length > MAX_INPUT_CHARS) {
          setError(t.tooLong);
          placeTip();
          return;
        }
        const before = draft;
        const seq = seqRef.current + 1;
        seqRef.current = seq;
        const controller = new AbortController();
        abortRef.current = controller;
        setError("");
        setMode("busy");
        setTip(null);

        try {
          const response = await fetch(ENDPOINT, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: text }),
            signal: controller.signal,
          });
          let payload = null;
          try {
            payload = await response.json();
          } catch {
            payload = null;
          }
          if (seq !== seqRef.current) return;
          if (!response.ok || !payload || payload.ok === false) {
            throw new Error(
              (payload && payload.error) || "HTTP " + String(response.status),
            );
          }
          const next = typeof payload.text === "string" ? payload.text.trim() : "";
          if (!next) throw new Error(t.empty);

          /* 请求期间用户改了草稿：不覆盖，直接作废。 */
          if (normalizeDraft(latestDraftRef.current) !== text) {
            setMode("idle");
            setError(t.diverged);
            placeTip();
            return;
          }

          const written = inputActions.setDraft(next);
          if (written === false) {
            setMode("idle");
            setError(t.notWritten);
            placeTip();
            return;
          }

          backupRef.current = { before: before, after: next };
          abortRef.current = null;
          setMode("done");
        } catch (err) {
          if (seq !== seqRef.current) return;
          abortRef.current = null;
          setMode("idle");
          if (err && err.name === "AbortError") {
            setError(t.aborted);
            return;
          }
          setError(t.failed + errorText(err));
          placeTip();
        }
      }

      function cancel() {
        seqRef.current += 1;
        if (abortRef.current) {
          abortRef.current.abort();
          abortRef.current = null;
        }
        setMode("idle");
      }

      function revert() {
        const backup = backupRef.current;
        backupRef.current = null;
        setMode("idle");
        if (!backup) return;
        inputActions.setDraft(backup.before);
      }

      function onClick(t) {
        if (mode === "busy") {
          cancel();
          return;
        }
        if (locked) {
          setError(t.blocked);
          placeTip();
          return;
        }
        if (hasBackup) {
          revert();
          return;
        }
        void enhance(t);
      }

      const t = dict();
      const tipText = label(t);

      return h(
        "div",
        { className: "dsh-pe-root" },
        h("style", { key: "css" }, CSS),
        h(
          "button",
          {
            key: "btn",
            ref: buttonRef,
            type: "button",
            className: "dsh-pe-btn",
            "data-mode": error ? "error" : mode,
            "data-empty": empty ? "true" : "false",
            "data-locked": locked ? "true" : "false",
            "aria-label": tipText,
            title: undefined,
            onMouseDown: function (event) {
              event.preventDefault();
            },
            onMouseEnter: showTip,
            onMouseLeave: hideTip,
            onFocus: showTip,
            onBlur: hideTip,
            onClick: function () {
              onClick(t);
            },
          },
          mode === "busy"
            ? spinnerIcon()
            : hasBackup
              ? revertIcon()
              : sparkleIcon(),
        ),
        tip && tipText
          ? h(
              "div",
              {
                key: "tip",
                className: "dsh-pe-tip",
                "data-tone": error ? "error" : "hint",
                style: { left: tip.left + "px", bottom: tip.bottom + "px" },
                role: "tooltip",
              },
              tipText,
            )
          : null,
      );
    }

    /** 插槽没给出输入框能力时什么都不渲染，避免炸掉宿主工具栏。 */
    function PromptEnhancerGate(props) {
      if (!props) return null;
      if (typeof props.useInput !== "function") return null;
      if (!props.inputActions || typeof props.inputActions.setDraft !== "function") {
        return null;
      }
      return h(PromptEnhancerComponent, props);
    }

    function apply(ctx) {
      const register = function () {
        return ctx.slots.register(
          {
            name: SLOT,
            id: "prompt-enhancer",
            order: 10,
            label: function () {
              return dict().idle;
            },
          },
          PromptEnhancerGate,
        );
      };

      ctx.effect(function () {
        let dispose = null;
        try {
          if (typeof ctx.slots.inject === "function") {
            dispose = ctx.slots.inject(SLOT, register);
          } else {
            dispose = register();
          }
        } catch (error) {
          console.error("[prompt-enhancer] 插槽注册失败", error);
        }
        return function () {
          if (typeof dispose === "function") dispose();
        };
      }, "prompt-enhancer: 输入框增强按钮");
    }

    return { inject: ["slots"], apply: apply };
  },
});