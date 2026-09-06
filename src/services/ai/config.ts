import type { Settings } from '../../domain/types';

/**
 * AI 助手配置，存在 Settings（IndexedDB）里，由用户在设置页填写。
 * 与 Planka 的环境变量方式不同：API Key 绝不能进 VITE_ 变量（会被打进
 * 构建产物），本地优先应用里 Key 只属于用户自己的浏览器。
 */

export interface AIConfig {
  /** OpenAI 兼容 Base URL，无尾斜杠，如 https://open.bigmodel.cn/api/paas/v4 */
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 容错处理用户粘贴的各种地址形式：尾斜杠、完整 chat/completions 路径。 */
export function normalizeBaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '');
}

/** 三项都填了才返回配置，否则 null（所有 AI 功能据此自动停用）。 */
export function aiConfig(settings?: Settings | null): AIConfig | null {
  const ai = settings?.ai;
  if (!ai) return null;
  const baseUrl = normalizeBaseUrl(ai.baseUrl);
  const apiKey = ai.apiKey.trim();
  const model = ai.model.trim();
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl, apiKey, model };
}

/**
 * 深度模型配置：在快速配置之上逐字段回落（没填的字段沿用快速模型）。
 * 快速模型未配置时整体返回 null；deep 缺省时深度 = 快速。
 */
export function deepAIConfig(settings?: Settings | null): AIConfig | null {
  const base = aiConfig(settings);
  if (!base) return null;
  const deep = settings?.ai?.deep;
  if (!deep) return base;
  const baseUrl = normalizeBaseUrl(deep.baseUrl ?? '');
  const apiKey = (deep.apiKey ?? '').trim();
  const model = (deep.model ?? '').trim();
  const merged: AIConfig = {
    baseUrl: baseUrl || base.baseUrl,
    apiKey: apiKey || base.apiKey,
    model: model || base.model,
  };
  return merged.baseUrl && merged.apiKey && merged.model ? merged : base;
}
