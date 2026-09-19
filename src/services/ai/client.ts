import type { AIConfig } from './config';

/**
 * Minimal OpenAI-compatible chat completions client (Bearer key auth).
 * Works with 智谱 GLM / DeepSeek / Kimi / SiliconFlow / OpenRouter 等
 * 任何实现了 /chat/completions 的服务。
 */

export class AIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AIError';
    this.status = status;
  }
}

interface ChatOptions {
  system: string;
  user: string;
  /** 请求 JSON 输出（response_format）；服务不支持时自动降级为纯提示词约束。 */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** 推理模型思考档位：快速任务 low，深度规划 high。不支持的厂商自动降级剥除。 */
  reasoningEffort?: 'low' | 'high';
}

export async function chat(config: AIConfig, opts: ChatOptions): Promise<string> {
  try {
    return await chatOnce(config, opts, true, opts.json ?? false);
  } catch (e) {
    if (!(e instanceof AIError) || e.status !== 400) throw e;
    // 400 时无法定位被拒字段，直接降级为最保守形态（无 reasoning_effort、无 response_format，
    // JSON 约束退化为提示词），保证"通用 OpenAI 兼容"
    return chatOnce(config, opts, false, false);
  }
}

const REQUEST_TIMEOUT_MS = 180_000;

async function chatOnce(
  config: AIConfig,
  opts: ChatOptions,
  withReasoningEffort: boolean,
  withJsonFormat: boolean,
): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  // 个人长期背景注入所有请求：让规划贴合用户真实处境（截断保护，防止失控 token）
  const contextBlock = config.context
    ? `\n\n关于用户（长期背景，供参考，不要在回复中复述）：\n${config.context.slice(0, 4000)}`
    : '';
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: opts.system + contextBlock },
          { role: 'user', content: opts.user },
        ],
        temperature: opts.temperature ?? 0.3,
        // 推理模型（如 glm-5.x）默认深思考可能耗时 2 分钟；按任务档位控制
        ...(withReasoningEffort ? { reasoning_effort: opts.reasoningEffort ?? 'low' } : {}),
        ...(withJsonFormat ? { response_format: { type: 'json_object' } } : {}),
        ...(opts.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
      }),
      signal: ctl.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new AIError('AI 服务响应超时（180 秒），已取消', 0);
    }
    throw new AIError(`无法连接 AI 服务：${(e as Error).message}`, 0);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // 空响应体
    }
    throw new AIError(`AI 服务请求失败（${res.status}）${detail ? `：${detail}` : ''}`, res.status);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string; reasoning_content?: string } }[];
  };
  const message = data.choices?.[0]?.message;
  // 推理模型可能在 content 截断时把结果留在思考通道里，兜底取 reasoning_content
  const content =
    typeof message?.content === 'string' && message.content.trim()
      ? message.content
      : typeof message?.reasoning_content === 'string' && message.reasoning_content.trim()
        ? message.reasoning_content
        : undefined;
  if (typeof content !== 'string') {
    throw new AIError('AI 返回格式异常：缺少 choices[0].message.content', 0);
  }
  return content;
}

export type AIProbeResult = 'ok' | 'reachable' | 'unreachable';

/**
 * Connectivity probe. `ok` = 2xx；`reachable` = 服务应答但拒绝了请求
 * （Key 错误 / 模型名错误，4xx）；`unreachable` = 网络不通。
 */
export async function probe(config: AIConfig): Promise<AIProbeResult> {
  try {
    await chat(config, { system: 'ping', user: 'ping', maxTokens: 1 });
    return 'ok';
  } catch (e) {
    if (e instanceof AIError && e.status >= 400 && e.status < 500) return 'reachable';
    return 'unreachable';
  }
}

/** 剥掉可能的 markdown 代码围栏后解析 JSON。 */
export function extractJSON<T>(content: string): T {
  const stripped = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    throw new AIError('AI 返回的不是合法 JSON，无法使用', 0);
  }
}
