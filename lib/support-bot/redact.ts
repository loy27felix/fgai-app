import { redactServerLogText } from '@/lib/observability/server-log';

export function scrubSupportValue(value: unknown): unknown {
  if (typeof value === 'string') {
    // Decode escaped quotes before matching credentials embedded in serialized JSON.
    // 先展开转义引号，避免日志字符串中的嵌套 JSON 凭据绕过脱敏。
    const text = value.replace(/\\+(?=["'])/g, '');
    return redactServerLogText(text
      .replace(/\b(?:Bearer|Basic)\s+[^\s,"';}\]]+/gi, '[redacted]')
      .replace(/((?:["']?)(?:password|secret|api[_-]?key|access[_-]?key|(?:access[_-]?|refresh[_-]?)?token|client[_-]?secret|authorization|cookie|set-cookie|private[_-]?key|credential|signature)(?:["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}\]]+)/gi, '$1"[redacted]"')
      .replace(/\b(?:https?|postgres(?:ql)?|rediss?|mysql|mongodb(?:\+srv)?|amqps?):\/\/[^\s]+/gi, '[url redacted]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]')
      .replace(/\b(?:sk|key)-[A-Za-z0-9_-]{12,}/g, '[redacted]'), 5000);
  }
  if (Array.isArray(value)) return value.slice(0,50).map(scrubSupportValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(token|secret|password|authorization|cookie|apikey|accesskey|credential|privatekey|signature|email|body|prompt|parameters)/i.test(key.replace(/[^a-z0-9]/gi, ''))).map(([key,item]) => [key,scrubSupportValue(item)]));
}

export function redactSupportText(value: string): string {
  return scrubSupportValue(value) as string;
}
