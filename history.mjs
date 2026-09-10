export const PAGE_SIZE = 12000;
export function textOf(item) {
  if (item.type === 'userMessage') return (item.content || []).map(x => x.text || '[附件]').join('\n');
  if (item.type === 'agentMessage') return item.text || '';
  if (item.type === 'commandExecution') return '$ ' + (item.command || '') + '\n' + (item.aggregatedOutput || '');
  return JSON.stringify(item, null, 2);
}
export function historyPage(thread, input = {}, attachments = () => []) {
  const turns = thread.turns || [];
  const index = input.turnId ? turns.findIndex(t => t.id === input.turnId) : turns.length - 1;
  const turn = turns[index];
  const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
  const mapped = (turn?.items || []).map(item => {
    const chat = ['userMessage','agentMessage'].includes(item.type);
    const full = textOf(item), start = input.itemId === item.id ? offset : 0;
    return { id:item.id, type:item.type, status:item.status, images:item.type === 'userMessage' ? attachments(item,turn) : [],
      pageText: chat || input.itemId === item.id ? full.slice(start,start+PAGE_SIZE) : '',
      totalLength:full.length, offset:start, deferred:!chat && input.itemId !== item.id };
  });
  return { thread: { id:thread.id, name:thread.name, preview:thread.preview?.slice(0,100), cwd:thread.cwd },
    outline: turns.map((t,i) => ({ id:t.id, label: (textOf((t.items || []).find(x => x.type === 'userMessage') || {}).slice(0,70) || '会话记录'), index:i })),
    turn: turn ? { id:turn.id, status:turn.status, items:input.itemId ? mapped.filter(x => x.id === input.itemId) : mapped } : null };
}
