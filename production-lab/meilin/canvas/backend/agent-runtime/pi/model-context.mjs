import {getCurrentSystemPrompt, getCurrentTools, getSystemMessageText} from '@earendil-works/pi-ai';

// Pi 0.87 puts policy sections and tool additions/removals in system transcript
// messages. Reading the old context.tools/systemPrompt fields silently loses both.
export function bridgeModelContext(context) {
  const messages = context.messages ?? [];
  return {
    systemPrompt: getCurrentSystemPrompt(messages),
    messages: messages.map(message => message.role === 'system'
      ? {...message, content: getSystemMessageText(message)}
      : message),
    tools: getCurrentTools(messages).map(({name, description, parameters}) => ({name, description, parameters})),
  };
}
