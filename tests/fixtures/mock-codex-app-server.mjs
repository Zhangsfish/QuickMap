import readline from 'node:readline';

const mode = process.env.QUICKMAP_TEST_APP_SERVER_MODE || 'happy';
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let turnCount = 0;
let isolated = false;
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

input.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialized') return;
  if (message.method === 'initialize') return send({ id: message.id, result: { userAgent: 'mock' } });
  if (message.method === 'account/read') {
    return send({ id: message.id, result: mode === 'auth' ? { account: null, requiresOpenaiAuth: true } :
      { account: { type: 'chatgpt' }, requiresOpenaiAuth: true } });
  }
  if (message.method === 'config/read') return send({ id: message.id, result: {
    config: { mcp_servers: { quickmap: { enabled: true }, another: { enabled: true } } },
  } });
  if (message.method === 'thread/start' || message.method === 'thread/resume') {
    const config = message.params.config;
    isolated = config?.mcp_servers?.quickmap?.enabled === false &&
      config?.mcp_servers?.another?.enabled === false && config?.features?.apps === false &&
      config?.features?.plugins === false && config?.features?.shell_tool === false &&
      config?.web_search === 'disabled';
    if (mode === 'stale' && message.method === 'thread/resume') {
      return send({ id: message.id, error: { code: -32000, message: 'Unknown thread' } });
    }
    return send({ id: message.id, result: { thread: { id: message.method === 'thread/resume' ? message.params.threadId : 'thr_quickmap_test' } } });
  }
  if (message.method === 'mcpServerStatus/list') return send({ id: message.id, result: {
    data: [{ name: 'quickmap', runtimeStatus: isolated && mode !== 'isolation-fail' ? 'disabled' : 'ready' },
      { name: 'another', runtimeStatus: isolated && mode !== 'isolation-fail' ? 'disabled' : 'ready' }], nextCursor: null,
  } });
  if (message.method === 'turn/interrupt') return send({ id: message.id, result: {} });
  if (message.method !== 'turn/start') return;
  turnCount++;
  const turnId = `turn_${turnCount}`;
  const threadId = message.params.threadId;
  send({ id: message.id, result: { turn: { id: turnId, status: 'inProgress', items: [], error: null } } });
  if (mode === 'hang') return;
  if (mode === 'disconnect') { process.exit(1); return; }
  if (mode === 'approval') {
    send({ id: 900, method: 'item/commandExecution/requestApproval', params: { threadId, turnId, itemId: 'cmd' } });
    return;
  }
  if (mode === 'tool-call') {
    send({ method: 'item/started', params: { threadId, turnId,
      item: { id: 'tool', type: 'mcpToolCall', server: 'quickmap', tool: 'focus_region' } } });
    return;
  }
  if (mode === 'cancel') {
    setTimeout(() => send({ method: 'item/agentMessage/delta', params: {
      threadId, turnId, itemId: 'msg', delta: '{"answer":"late content',
    } }), 80);
    return;
  }
  const answer = mode === 'bad-id'
    ? { answer: '示例', stepIds: ['hormuz-999'], sourceIds: ['iea-hormuz-factsheet'] }
    : mode === 'bad-text'
    ? { answer: '请执行 {"type":"focus_region"}', stepIds: ['hormuz-1'], sourceIds: ['iea-hormuz-factsheet'] }
    : mode === 'bad-url'
    ? { answer: 'file:///secret/path', stepIds: ['hormuz-1'], sourceIds: ['iea-hormuz-factsheet'] }
    : { answer: turnCount === 1 ? '海峡是波斯湾的出口。' : '管道只能分担部分原油。',
      stepIds: ['hormuz-1'], sourceIds: ['iea-hormuz-factsheet'] };
  const raw = JSON.stringify(answer);
  for (const part of [raw.slice(0, 14), raw.slice(14, 23), raw.slice(23)]) {
    send({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'msg', delta: part } });
  }
  send({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', id: 'msg', text: raw } } });
  send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed', items: [], error: null } } });
});
