import type { ChatMessage } from '@/lib/deepseek';

export type StoredCreatorMessage = {
  id?: string;
  role: string;
  content: unknown;
  status: string;
  created_at?: string;
};

export function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return '';
  const text = (content as { text?: unknown }).text;
  return typeof text === 'string' ? text : '';
}

export function toTextModelMessages(rows: StoredCreatorMessage[]): ChatMessage[] {
  return rows
    .filter((row) => row.status === 'complete' && (row.role === 'user' || row.role === 'assistant'))
    .map((row) => ({
      role: row.role as 'user' | 'assistant',
      content: messageText(row.content),
    }))
    .filter((row) => row.content.trim().length > 0)
    .slice(-40);
}

export function titleFromPrompt(prompt: string): string {
  const clean = prompt.trim().replace(/\s+/g, ' ');
  return clean.slice(0, 28) || '未命名对话';
}
