// DeepSeek 调用封装（仅在服务端使用，Key 从环境变量读取）
// 兼容 OpenAI Chat Completions 格式。

const BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatMode = "flash" | "pro";

export interface ChatOptions {
  messages: ChatMessage[];
  mode?: ChatMode;        // flash=快, pro=强
  thinking?: boolean;     // 是否开思考模式
  jsonOutput?: boolean;   // 结构化 JSON 输出
  maxTokens?: number;
}

export interface ChatResult {
  content: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export async function deepseekChat(opts: ChatOptions): Promise<ChatResult> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("缺少 DEEPSEEK_API_KEY 环境变量");

  const mode = opts.mode ?? "flash";
  const model = mode === "pro" ? "deepseek-v4-pro" : "deepseek-v4-flash";

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    stream: false,
    max_tokens: opts.maxTokens ?? 2000,
    // thinking 模式开关（DeepSeek 走 extra_body）
    extra_body: { thinking: { type: opts.thinking ? "enabled" : "disabled" } },
  };
  if (opts.thinking) body.reasoning_effort = "high";
  if (opts.jsonOutput) body.response_format = { type: "json_object" };

  const res = await withRetry(() =>
    fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    })
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DeepSeek ${res.status}: ${text || res.statusText}`);
  }

  const data = await res.json();
  return {
    content: data?.choices?.[0]?.message?.content ?? "",
    usage: data?.usage,
  };
}

// 429/500/503 指数退避重试
async function withRetry(fn: () => Promise<Response>, retries = 3): Promise<Response> {
  let last: Response | null = null;
  for (let i = 0; i < retries; i++) {
    const res = await fn();
    if (res.ok || ![429, 500, 503].includes(res.status)) return res;
    last = res;
    await new Promise((r) => setTimeout(r, 800 * Math.pow(2, i)));
  }
  return last as Response;
}
