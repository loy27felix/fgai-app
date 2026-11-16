import { readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { scrubSupportValue } from './redact';

const source = 'docs/user-issues.md';
const maxBytes = 256 * 1024;
type IssueField = 'description' | 'impact' | 'status' | 'advice';
const fields = new Map<string, IssueField>([
  ['文案描述', 'description'], ['影响', 'impact'], ['状态', 'status'], ['答复/如何解决', 'advice'],
]);
type KnownIssue = { id: string; title: string; line: number } & Record<IssueField, string>;
export type RelatedUserIssues = {
  source: string; status: 'matched' | 'no_match' | 'unavailable'; matches: KnownIssue[]; note: string;
};
const commonWords = new Set(['为什么', '怎么', '如何', '什么', '这个', '那个', '问题', '现在', '已经', '没有', '可以', '是否', '还是', '不是', '不会', '不能', '应该', '需要', '一下', '全部', '生成', '视频', '系统', '使用', '设置', '功能', '用户']);
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });

function keywords(text: string): string[] {
  return [...new Set([...segmenter.segment(text.toLowerCase())].filter(part => part.isWordLike)
    .map(part => part.segment).filter(word => word.length >= 2 && word.length <= 40 && !/^\d+$/.test(word) && !commonWords.has(word)))];
}

function parseIssues(text: string): KnownIssue[] {
  const entries: KnownIssue[] = [];
  const names = new Set<string>();
  let current: KnownIssue | undefined;
  let field: IssueField | undefined;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const heading = line.match(/^##\s+(\d+)\s*[·.、-]\s*(.+)$/);
    if (heading) {
      current = { id: heading[1], title: heading[2].trim(), line: index + 1, description: '', impact: '', status: '', advice: '' };
      entries.push(current);
      field = undefined;
      continue;
    }
    if (!current) continue;
    const label = line.match(/^[-*]\s+\*\*([^*]+)\*\*\s*[：:]\s*(.*)$/);
    if (label) {
      const key = label[1].replace(/\s/g, '');
      if (key === '用户' && label[2].trim()) names.add(label[2].trim());
      field = fields.get(key);
      if (field) current[field] = label[2].trim();
    } else if (/^#{1,2}\s/.test(line)) {
      current = undefined;
      field = undefined;
    } else if (field && !/^\s*!\[/.test(line)) current[field] += `\n${line}`;
  }
  for (const entry of entries) {
    const speaker = entry.advice.match(/^([\p{Script=Han}]{2,4})[：:]/u)?.[1];
    if (speaker && !/^(?:注意|提醒|说明|前提|条件|建议|未确认|待确认|临时方案)$/.test(speaker)) {
      names.add(speaker);
      entry.advice = entry.advice.slice(speaker.length + 1).trim();
    }
  }
  // Historical cases are hints, not private tickets: omit people, images and links before model input.
  // 历史案例只作线索，不导入私人原工单；进入模型前去除人员、截图与链接。
  return entries.filter(entry => JSON.stringify(entry).length <= 5000).map(entry => {
    const clean = (value: string) => {
      for (const name of names) value = value.replaceAll(name, '[姓名已省略]');
      return String(scrubSupportValue(value.replace(/!\[[^\]]*\]\([^\n]*?\)/g, '')
        .replace(/\[([^\]]+)\]\([^\n]*?\)/g, '$1'))).trim();
    };
    return { id: entry.id, line: entry.line, title: clean(entry.title), description: clean(entry.description),
      impact: clean(entry.impact), status: clean(entry.status), advice: clean(entry.advice) };
  });
}

export async function findRelatedUserIssues(questions: string[], signal?: AbortSignal): Promise<RelatedUserIssues> {
  try {
    const timeout = AbortSignal.timeout(1500);
    const readSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    readSignal.throwIfAborted();
    const root = await realpath(process.cwd());
    const path = join(root, source);
    const [resolved, info] = await Promise.all([realpath(path), stat(path)]);
    if (resolved !== path || !info.isFile() || info.size > maxBytes) throw new Error('Unsupported history file');
    const text = await readFile(path, { encoding: 'utf8', signal: readSignal });
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('History file exceeded limit');
    const terms = keywords(questions.slice(0, 12).map(question => question.slice(0, 2000)).join('\n'));
    const matches = parseIssues(text).map(issue => {
      // Match symptoms, not suggested fixes; common words alone must not select an unrelated case.
      // 只用现象匹配，不用解决步骤凑相似度，也不因“生成/视频”等泛词命中无关案例。
      const title = issue.title.toLowerCase();
      const description = issue.description.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 2 : description.includes(term) ? 1 : 0), 0);
      return { issue, score };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.issue.line - b.issue.line).slice(0, 3).map(item => item.issue);
    return { source, status: matches.length ? 'matched' : 'no_match', matches,
      note: '仅按现象检索历史线索，最多3条；人员与截图不导入，超长条目跳过。人工答复和临时方案均待本次代码/日志核实，不是本次证据；未命中不代表没有类似问题。' };
  } catch {
    return { source, status: 'unavailable', matches: [], note: '历史文档缺失、不可读、超限或读取已取消/超时；本次正常排查继续，不据此判断业务问题。' };
  }
}
