// Manual inspection: node tests/manual-inspect-app-server.mjs
// Prints only MCP server names, never config values or credentials.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const command = process.env.QUICKMAP_CODEX_PATH || 'codex';
async function inspect(label, extraArgs, withThread = false) {
  const child = spawn(command, ['app-server', ...extraArgs], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let id = 0;
  child.stderr.resume();
  lines.on('line', (line) => {
    const message = JSON.parse(line);
    if (pending.has(message.id)) {
      pending.get(message.id)(message.result ?? message.error);
      pending.delete(message.id);
    }
  });
  const call = (method, params) => new Promise((resolve) => {
    const requestId = ++id;
    pending.set(requestId, resolve);
    child.stdin.write(`${JSON.stringify({ id: requestId, method, params })}\n`);
  });
  try {
    await call('initialize', { clientInfo: { name: 'quickmap_audit', title: 'QuickMap Audit', version: '0.1' }, capabilities: null });
    child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
    const config = await call('config/read', { includeLayers: false });
    const serverConfig = config?.config?.mcp_servers || config?.config?.mcpServers || {};
    let threadId;
    if (withThread) {
      const disabledMcp = Object.fromEntries(Object.keys(serverConfig).map((name) => [name, { enabled: false }]));
      const started = await call('thread/start', {
        cwd: process.cwd(), approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true,
        config: { mcp_servers: disabledMcp, features: { apps: false, plugins: false, hooks: false, shell_tool: false, multi_agent: false }, web_search: 'disabled' },
      });
      threadId = started?.thread?.id;
      process.stdout.write(`${label}: threadStarted=${!!threadId}, error=${JSON.stringify(started?.message)}\n`);
    }
    const status = await call('mcpServerStatus/list', { limit: 100, detail: 'toolsAndAuthOnly', ...(threadId ? { threadId } : {}) });
    const quickmapStatus = (status?.data || []).find((entry) => entry.name === 'quickmap');
    process.stdout.write(`${label}: configured=${JSON.stringify(Object.keys(serverConfig))}, quickmapEnabled=${JSON.stringify(serverConfig?.quickmap?.enabled)}, status=${JSON.stringify((status?.data || []).map((entry) => ({ name: entry.name, runtimeStatus: entry.runtimeStatus, toolCount: entry.tools?.length })))}, quickmapFields=${JSON.stringify(Object.keys(quickmapStatus || {}))}\n`);
  } finally {
    lines.close();
    child.kill();
  }
}

await inspect('thread-disabled', ['--disable', 'apps', '--disable', 'plugins', '--disable', 'hooks', '--disable', 'shell_tool', '--disable', 'multi_agent', '-c', 'web_search="disabled"'], true);
