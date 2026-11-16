import OpenAI from 'openai';
import { chatWithTextModel, type TextChatOptions } from '@/lib/ai/text';
import { normalizeReasoningEffort } from '@/lib/ai/reasoning';
import type { ChatResult } from '@/lib/deepseek';
import { wetokenProviderDispatcher } from '@/lib/ai/wetoken-transport';
import { logServerEvent } from '@/lib/observability/server-log';
import { scrubSupportValue } from './redact';

export class IncompleteSupportModelResponse extends Error {
  constructor() { super('机器人模型响应不完整'); this.name = 'IncompleteSupportModelResponse'; }
}

export async function chatWithSupportModel(options: TextChatOptions & { responsesTimeoutMs?: number }): Promise<{ result: ChatResult }> {
  options.signal?.throwIfAborted();
  const protocol = process.env.SUPPORT_BOT_API_PROTOCOL || 'chat_completions';
  const configuredEffort = options.reasoningEffort ?? (process.env.SUPPORT_BOT_REASONING_EFFORT?.trim() || 'high');
  const reasoningEffort = normalizeReasoningEffort(configuredEffort);
  if (reasoningEffort !== configuredEffort || reasoningEffort === 'ultra') throw new Error('机器人思考等级配置无效');
  const effort = reasoningEffort === 'auto' ? undefined : reasoningEffort;
  // Screenshots and OCR text may contain private information; record metadata only.
  // 截图及识别文字可能包含隐私，诊断模型只记录元数据，不记录请求和响应正文。
  if (protocol === 'chat_completions') return chatWithTextModel({ ...options, reasoningEffort, logPayloads: false });
  if (protocol !== 'responses') throw new Error('机器人 API 协议配置无效');
  if (!options.apiBaseUrl || !options.apiKey || !options.modelId) throw new Error('机器人 Responses 配置不完整');

  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.apiBaseUrl.replace(/\/$/, ''),
    maxRetries: 0,
    timeout: options.responsesTimeoutMs ?? 110_000,
    fetch: (url, init) => fetch(url, { ...init, dispatcher: wetokenProviderDispatcher } as RequestInit),
  });
  const input = options.messages.filter(message => message.role !== 'system');
  if (options.jsonOutput) {
    // JSON mode validation checks input messages rather than the separate instructions field.
    // JSON 模式校验输入消息，不把独立 instructions 字段中的 json 指令计入校验。
    const finalUserIndex = input.map(message => message.role).lastIndexOf('user');
    if (finalUserIndex < 0) throw new Error('机器人 JSON 请求缺少用户消息');
    input[finalUserIndex] = { ...input[finalUserIndex], content: `${input[finalUserIndex].content}\n仅返回一个有效的 json object，不要 Markdown。` };
  }
  const imageMessageIndex = input.map(message => message.role).lastIndexOf('user');
  if (options.images?.length && imageMessageIndex < 0) throw new Error('机器人图片请求缺少用户消息');
  const responseInput: OpenAI.Responses.ResponseInput = input.map((message, index) => {
    if (index !== imageMessageIndex || !options.images?.length) return message;
    return { role: 'user', content: [
      { type: 'input_text', text: message.content },
      ...options.images.map(url => ({ type: 'input_image' as const, image_url: url, detail: 'auto' as const })),
    ] };
  });
  const body = {
    model: options.modelId,
    instructions: options.messages.filter(message => message.role === 'system').map(message => message.content).join('\n'),
    input: responseInput,
    store: false,
    ...(effort ? { reasoning: { effort } } : {}),
    max_output_tokens: options.maxTokens ?? 1024,
    ...(options.jsonOutput ? { text: { format: { type: 'json_object' as const } } } : {}),
  };
  const fields = {
    service: 'support-bot', provider: 'openai-compatible', operation: 'responses',
    taskId: options.taskId, sessionId: options.sessionId, model: options.modelId, reasoningEffort: effort || 'auto',
  };
  logServerEvent('support_bot_model_request', { ...fields, stage: 'request_sent' });
  const started = Date.now();
  try {
    // Read the completed snapshot through the SDK; compatible gateways may emit extra events.
    // 通过官方 SDK 读取完成事件的完整响应，兼容网关额外发送的心跳等事件。
    const stream = await client.responses.create({ ...body, stream: true }, { signal: options.signal });
    let response: OpenAI.Responses.Response | undefined;
    for await (const event of stream) {
      if (event.type === 'response.completed') response = event.response;
      if (event.type === 'response.failed' || event.type === 'response.incomplete' || event.type === 'error') {
        const reason = event.type === 'response.failed' ? event.response.error?.message : event.type;
        throw new Error(reason || '机器人模型流返回失败或不完整响应');
      }
    }
    const content = response?.output.flatMap(item => item.type === 'message' ? item.content : [])
      .filter(item => item.type === 'output_text').map(item => item.text).join('');
    if (!response || response.status !== 'completed' || !content) throw new IncompleteSupportModelResponse();
    logServerEvent('support_bot_model_response', {
      ...fields, stage: 'completed', durationMs: Date.now() - started,
      providerRequestId: response.id,
      usage: response.usage ? {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        total_tokens: response.usage.total_tokens,
      } : undefined,
    });
    return {
      result: {
        content,
        providerRequestId: response.id,
        usage: response.usage ? {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens,
          total_tokens: response.usage.total_tokens,
        } : undefined,
      },
    };
  } catch (error) {
    if (options.signal?.aborted) {
      logServerEvent('support_bot_model_cancelled', { ...fields, durationMs: Date.now() - started });
      throw error;
    }
    logServerEvent('support_bot_model_failed', {
      ...fields, durationMs: Date.now() - started,
      httpStatus: error instanceof OpenAI.APIError ? error.status : undefined,
      reason: error instanceof Error ? scrubSupportValue(error.message.replaceAll(options.apiKey, '[redacted]').slice(0,500)) : 'unknown',
    }, 'error');
    throw error;
  }
}
