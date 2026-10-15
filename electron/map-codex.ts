import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { join, isAbsolute } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import { HORMUZ_STORY } from '../src/story/hormuz';
import type { MapAskEvent } from '../src/bridge';

const MAX_PROMPT_LENGTH = 2000;
const MAX_ANSWER_LENGTH = 4000;
const MAX_MESSAGE_LENGTH = 2_000_000;
const REQUEST_TIMEOUT_MS = 20_000;
const TURN_TIMEOUT_MS = 120_000;
const STEP_IDS = HORMUZ_STORY.steps.map((step) => step.id);
const SOURCE_IDS = Object.keys(HORMUZ_STORY.sources);
const stepIds = new Set<string>(STEP_IDS);
const sourceIds = new Set<string>(SOURCE_IDS);
const sourceIdsByStep = new Map<string, Set<string>>(HORMUZ_STORY.steps.map((step) => [step.id, new Set<string>(step.sourceIds)]));

// These process-local switches remove the inherited interactive tool surfaces.
// Individual user MCP servers are disabled separately in thread config below.
export const SAFE_CODEX_ARGS = [
  'app-server', '--disable', 'apps', '--disable', 'plugins', '--disable', 'hooks',
  '--disable', 'shell_tool', '--disable', 'multi_agent', '-c', 'web_search="disabled"',
] as const;

export type MapCodexFailureCode =
  | 'invalid_prompt' | 'busy' | 'codex_missing' | 'auth_required' | 'approval_required'
  | 'timeout' | 'disconnected' | 'invalid_response' | 'tool_isolation_failed' | 'server_error';

export class MapCodexFailure extends Error {
  constructor(public readonly code: MapCodexFailureCode, message: string) {
    super(message);
    this.name = 'MapCodexFailure';
  }
}

const messages: Record<MapCodexFailureCode, string> = {
  invalid_prompt: '请输入 1–2000 字的问题。',
  busy: '请等待当前回答结束，或先取消当前回答。',
  codex_missing: '未找到本机 Codex CLI。请安装 Codex 或设置 QUICKMAP_CODEX_PATH。',
  auth_required: '本机 Codex 尚未登录或登录已失效。请先在 Codex 中登录。',
  approval_required: '地图讲解不会申请本机操作权限；Codex 的授权请求已被拒绝。',
  timeout: 'Codex 响应超时，请重试。',
  disconnected: 'Codex app-server 连接中断，请重试。',
  invalid_response: 'Codex 返回了不符合地图故事约束的内容，请重试。',
  tool_isolation_failed: '无法隔离本机 Codex 工具，地图问答已停止。',
  server_error: 'Codex 暂时无法回答，请稍后重试。',
};

type RpcPending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type ActiveAsk = {
  requestId: string;
  threadId?: string;
  turnId?: string;
  timer: NodeJS.Timeout;
  queued: RpcMessage[];
  itemText: Map<string, string>;
  finalText: string;
  visibleAnswer: string;
};

type RpcMessage = { id?: string | number; method?: string; params?: unknown; result?: unknown; error?: unknown };

export type MapCodexOptions = {
  dataDir: string;
  onEvent: (event: MapAskEvent) => void;
  // The overrides are used by the deterministic protocol tests.
  command?: string;
  args?: string[];
  turnTimeoutMs?: number;
  ephemeral?: boolean;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function failure(code: MapCodexFailureCode): MapCodexFailure {
  return new MapCodexFailure(code, messages[code]);
}

function classify(error: unknown): MapCodexFailure {
  if (error instanceof MapCodexFailure) return error;
  const detail = error instanceof Error ? error.message : String(error);
  if (/ENOENT|not found/i.test(detail)) return failure('codex_missing');
  if (/unauthorized|authentication|not logged in|login required|401/i.test(detail)) return failure('auth_required');
  if (/permission|approval/i.test(detail)) return failure('approval_required');
  if (/timeout/i.test(detail)) return failure('timeout');
  return failure('server_error');
}

function storyInstructions(): string {
  const sources = Object.entries(HORMUZ_STORY.sources).map(([id, source]) => ({
    id, title: source.title, period: source.period,
  }));
  const steps = HORMUZ_STORY.steps.map((step) => ({
    id: step.id, title: step.title, sourceIds: step.sourceIds,
    paragraphs: step.paragraphs.map(({ text, sourceIds: paragraphSources }) => ({ text, sourceIds: paragraphSources })),
    claims: step.claims.map(({ value, label, period, unit, sourceId, qualifier }) => ({ value, label, period, unit, sourceId, qualifier })),
  }));
  return [
    '你是 QuickMap 的地图讲解员，只使用下面这份已审核的霍尔木兹故事回答中文问题。',
    '这是 QuickMap 自己的独立 Codex 会话，不是用户当前 Codex 桌面聊天。',
    '不要调用工具、访问文件、搜索网络、执行命令或请求授权；不要输出 URL、Markdown 链接、HTML、GeoJSON、坐标或控制命令。',
    '故事里的航线、管线与海峡点位均为示意。2025 常态与 2026 扰动分开，石油与 LNG 分开，来源和时段保持一致。',
    '只能从列出的步骤 ID 和来源 ID 中选择。若问题超出故事范围，简短说明目前仅支持霍尔木兹故事，并返回空的 ID 数组。',
    '最终回答必须是 JSON 对象：answer 为纯文本中文；stepIds 为用到的步骤 ID 数组；sourceIds 为用到的来源 ID 数组。',
    '请在 answer 中自然分段，尽量简洁。禁止另造未经材料支持的数字或事实。',
    JSON.stringify({ storyId: HORMUZ_STORY.id, version: HORMUZ_STORY.version, asOf: HORMUZ_STORY.asOf, sources, steps }),
  ].join('\n');
}

export const MAP_ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    stepIds: { type: 'array', items: { type: 'string', enum: STEP_IDS } },
    sourceIds: { type: 'array', items: { type: 'string', enum: SOURCE_IDS } },
  },
  required: ['answer', 'stepIds', 'sourceIds'],
  additionalProperties: false,
};

export function isSafeAnswerText(answer: string): boolean {
  return !/[{}\[\]`]/.test(answer) &&
    !/\b[a-z][a-z0-9+.-]{1,31}:\S/i.test(answer) &&
    !/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/i.test(answer) &&
    !/\b(?:GeoJSON|FeatureCollection|MultiPoint|LineString|MultiPolygon|Polygon|coordinates|geometryJson|focus_region|add_overlay|set_story_step|upsert_overlay|remove_overlay|clear_overlays|show_place|powershell|cmd\.exe|bash|curl|wget)\b/i.test(answer) &&
    !/\brm\s+-rf\b|\bdel\s+\/[sq]\b/i.test(answer);
}

/** Decode only the already complete prefix of the JSON `answer` string. */
export function streamedAnswerPrefix(raw: string): string | null {
  const match = /"answer"\s*:\s*"/.exec(raw);
  if (!match) return null;
  const start = match.index + match[0].length;
  let end = start;
  for (let index = start; index < raw.length; index++) {
    const character = raw[index];
    if (character === '"') break;
    if (character === '\\') {
      if (index + 1 >= raw.length) break;
      if (raw[index + 1] === 'u') {
        if (index + 5 >= raw.length) break;
        index += 5;
      } else index++;
    }
    end = index + 1;
  }
  try { return JSON.parse(`"${raw.slice(start, end)}"`) as string; }
  catch { return null; }
}

export function validateMapAnswer(raw: string): { answer: string; stepIds: string[]; sourceIds: string[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw failure('invalid_response'); }
  const result = object(parsed);
  if (!result || typeof result.answer !== 'string' || !Array.isArray(result.stepIds) || !Array.isArray(result.sourceIds)) {
    throw failure('invalid_response');
  }
  const answer = result.answer.trim();
  if (!answer || answer.length > MAX_ANSWER_LENGTH || !isSafeAnswerText(answer)) throw failure('invalid_response');
  if (!result.stepIds.every((id) => typeof id === 'string' && stepIds.has(id)) ||
      !result.sourceIds.every((id) => typeof id === 'string' && sourceIds.has(id))) throw failure('invalid_response');
  const usedSteps = [...new Set(result.stepIds as string[])];
  const usedSources = [...new Set(result.sourceIds as string[])];
  if (usedSteps.length === 0 && usedSources.length !== 0) throw failure('invalid_response');
  if (usedSteps.length > 0) {
    if (usedSources.length === 0) throw failure('invalid_response');
    const permitted = new Set(usedSteps.flatMap((id) => [...(sourceIdsByStep.get(id) || [])]));
    if (usedSources.some((id) => !permitted.has(id))) throw failure('invalid_response');
  }
  return { answer: usedSteps.length ? answer : '目前地图内问答只收录了霍尔木兹海峡故事。你可以问我它为什么重要、能源流向或陆上绕行。',
    stepIds: usedSteps, sourceIds: usedSources };
}

async function installedCodexPath(): Promise<string | undefined> {
  const override = process.env.QUICKMAP_CODEX_PATH;
  if (override) {
    if (!isAbsolute(override)) throw failure('codex_missing');
    try { await access(override); return override; } catch { throw failure('codex_missing'); }
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return undefined;
  const binRoot = join(localAppData, 'OpenAI', 'Codex', 'bin');
  try {
    const directories = await readdir(binRoot, { withFileTypes: true });
    const candidates = await Promise.all(directories.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const path = join(binRoot, entry.name, 'codex.exe');
      try { return { path, modified: (await stat(path)).mtimeMs }; } catch { return null; }
    }));
    return candidates.filter((candidate): candidate is { path: string; modified: number } => candidate !== null)
      .sort((left, right) => right.modified - left.modified)[0]?.path;
  } catch { return undefined; }
}

export class MapCodexSession {
  private process?: ChildProcessWithoutNullStreams;
  private lines?: Interface;
  private ready = false;
  private connecting?: Promise<void>;
  private pending = new Map<number, RpcPending>();
  private nextId = 1;
  private active?: ActiveAsk;
  private threadId?: string;
  private threadConfig?: Record<string, unknown>;
  private conversationGeneration = 0;
  private closed = false;

  constructor(private readonly options: MapCodexOptions) {}

  ask(prompt: unknown): { requestId: string } {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT_LENGTH) throw failure('invalid_prompt');
    if (this.active) throw failure('busy');
    const requestId = randomUUID();
    const active: ActiveAsk = {
      requestId, queued: [], itemText: new Map(), finalText: '', visibleAnswer: '',
      timer: setTimeout(() => this.fail(active, failure('timeout')), this.options.turnTimeoutMs ?? TURN_TIMEOUT_MS),
    };
    this.active = active;
    queueMicrotask(() => { if (this.active === active) this.emit({ requestId, type: 'started' }); });
    void this.run(active, prompt.trim()).catch((error: unknown) => this.fail(active, classify(error)));
    return { requestId };
  }

  async cancel(requestId?: unknown): Promise<void> {
    const active = this.active;
    if (!active || (requestId !== undefined && requestId !== active.requestId)) return;
    this.active = undefined;
    clearTimeout(active.timer);
    this.emit({ requestId: active.requestId, type: 'cancelled' });
    if (active.threadId && active.turnId) {
      await this.rpc('turn/interrupt', { threadId: active.threadId, turnId: active.turnId }).catch(() => undefined);
    }
  }

  async reset(): Promise<void> {
    await this.cancel();
    this.conversationGeneration++;
    this.threadId = undefined;
    try { await unlink(this.sessionFile()); } catch { /* No saved conversation yet. */ }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.active) clearTimeout(this.active.timer);
    this.active = undefined;
    this.lines?.close();
    const child = this.process;
    this.process = undefined;
    this.ready = false;
    this.rejectPending(failure('disconnected'));
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 3000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill();
      });
    }
  }

  private sessionFile(): string { return join(this.options.dataDir, 'thread.json'); }

  private emit(event: MapAskEvent): void { this.options.onEvent(event); }

  private async run(active: ActiveAsk, prompt: string): Promise<void> {
    const threadId = await this.ensureThread(this.conversationGeneration, active.requestId);
    if (this.active !== active) return;
    active.threadId = threadId;
    const response = object(await this.rpc('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt }],
      cwd: this.options.dataDir,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      outputSchema: MAP_ANSWER_SCHEMA,
    }));
    const turnId = string(object(response?.turn)?.id);
    if (!turnId) throw failure('server_error');
    active.turnId = turnId;
    if (this.active !== active) {
      void this.rpc('turn/interrupt', { threadId, turnId }).catch(() => undefined);
      return;
    }
    for (const message of active.queued) this.handleTurnNotification(active, message);
    active.queued.length = 0;
  }

  private async ensureThread(generation: number, requestId: string): Promise<string> {
    await this.connect();
    if (generation !== this.conversationGeneration) throw failure('disconnected');
    if (this.threadId) return this.threadId;
    if (!this.threadConfig) throw failure('tool_isolation_failed');
    const account = object(await this.rpc('account/read', { refreshToken: false }));
    if (generation !== this.conversationGeneration) throw failure('disconnected');
    if (account?.requiresOpenaiAuth === true && account.account === null) throw failure('auth_required');
    let savedRaw: string | undefined;
    if (!this.options.ephemeral) {
      try { savedRaw = await readFile(this.sessionFile(), 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (savedRaw !== undefined) {
      let savedId: string | undefined;
      try {
        const saved = object(JSON.parse(savedRaw));
        const candidate = string(saved?.threadId);
        if (saved?.storyVersion === HORMUZ_STORY.version && candidate && /^[A-Za-z0-9_-]{1,128}$/.test(candidate)) savedId = candidate;
      } catch { /* Invalid saved state starts a fresh conversation. */ }
      if (savedId) {
        try {
          const resumed = object(await this.rpc('thread/resume', {
            threadId: savedId, excludeTurns: true, cwd: this.options.dataDir,
            approvalPolicy: 'never', sandbox: 'read-only', developerInstructions: storyInstructions(),
            config: this.threadConfig,
          }));
          const id = string(object(resumed?.thread)?.id);
          if (generation !== this.conversationGeneration) throw failure('disconnected');
          if (id === savedId) {
            await this.verifyToolIsolation(id);
            this.threadId = id;
            return id;
          }
        } catch (error) {
          if (error instanceof MapCodexFailure && error.code === 'tool_isolation_failed') throw error;
          if (generation !== this.conversationGeneration) throw failure('disconnected');
        }
      }
      this.emit({ requestId, type: 'conversation_reset', message: '原地图问答会话无法继续，已新建会话并清除旧对话显示。' });
    }
    const started = object(await this.rpc('thread/start', {
      cwd: this.options.dataDir, approvalPolicy: 'never', sandbox: 'read-only',
      serviceName: 'quickmap', developerInstructions: storyInstructions(), ephemeral: !!this.options.ephemeral,
      config: this.threadConfig,
    }));
    const id = string(object(started?.thread)?.id);
    if (!id) throw failure('server_error');
    if (generation !== this.conversationGeneration) throw failure('disconnected');
    await this.verifyToolIsolation(id);
    this.threadId = id;
    if (!this.options.ephemeral) {
      await mkdir(this.options.dataDir, { recursive: true, mode: 0o700 });
      await writeFile(this.sessionFile(), JSON.stringify({ storyVersion: HORMUZ_STORY.version, threadId: id }), { mode: 0o600 });
    }
    return id;
  }

  private async verifyToolIsolation(threadId: string): Promise<void> {
    const status = object(await this.rpc('mcpServerStatus/list', {
      threadId, limit: 1000, detail: 'toolsAndAuthOnly',
    }));
    const servers = status?.data;
    if (!Array.isArray(servers) || status?.nextCursor ||
        servers.some((server) => object(server)?.runtimeStatus !== 'disabled')) {
      throw failure('tool_isolation_failed');
    }
  }

  private async connect(): Promise<void> {
    if (this.closed) throw failure('disconnected');
    if (this.ready && this.process) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.openConnection().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private async openConnection(): Promise<void> {
    await mkdir(this.options.dataDir, { recursive: true, mode: 0o700 });
    const command = this.options.command || await installedCodexPath() || 'codex';
    const args = this.options.args || [...SAFE_CODEX_ARGS];
    const child = spawn(command, args, {
      cwd: this.options.dataDir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false,
    });
    this.process = child;
    child.on('exit', () => this.onDisconnect(child, failure('disconnected')));
    child.on('error', (error) => this.onDisconnect(child, classify(error)));
    child.stdin.on('error', () => this.onDisconnect(child, failure('disconnected')));
    child.stderr.on('data', () => { /* Never forward CLI diagnostics or credentials to the renderer. */ });
    try {
      await once(child, 'spawn');
      this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
      this.lines.on('line', (line) => this.onLine(line));
      await this.rpc('initialize', {
        clientInfo: { name: 'quickmap', title: 'QuickMap', version: '0.2.0' }, capabilities: null,
      });
      this.notify('initialized', {});
      const read = object(await this.rpc('config/read', { includeLayers: false }));
      const config = object(read?.config);
      if (!config) throw failure('tool_isolation_failed');
      const mcp = object(config.mcp_servers ?? config.mcpServers) || {};
      this.threadConfig = {
        mcp_servers: Object.fromEntries(Object.keys(mcp).map((name) => [name, { enabled: false }])),
        features: { apps: false, plugins: false, hooks: false, shell_tool: false, multi_agent: false },
        web_search: 'disabled',
      };
      this.ready = true;
    } catch (error) {
      child.kill();
      this.process = undefined;
      throw classify(error);
    }
  }

  private onDisconnect(child: ChildProcessWithoutNullStreams, cause: MapCodexFailure): void {
    if (this.process !== child) return;
    this.process = undefined;
    this.ready = false;
    this.lines?.close();
    this.lines = undefined;
    this.threadId = undefined;
    this.threadConfig = undefined;
    this.rejectPending(cause);
    if (this.active) this.fail(this.active, cause);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private onLine(line: string): void {
    if (line.length > MAX_MESSAGE_LENGTH) {
      this.process?.kill();
      if (this.active) this.fail(this.active, failure('invalid_response'));
      return;
    }
    let message: RpcMessage;
    try { message = JSON.parse(line) as RpcMessage; }
    catch { this.process?.kill(); return; }
    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message);
      return;
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        const detail = string(object(message.error)?.message) || 'app-server request failed';
        pending.reject(classify(new Error(detail)));
      } else pending.resolve(message.result);
      return;
    }
    if (message.method) this.onNotification(message);
  }

  private handleServerRequest(message: RpcMessage): void {
    const method = message.method;
    let result: unknown;
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval' ||
        method === 'execCommandApproval' || method === 'applyPatchApproval') result = { decision: 'decline' };
    else if (method === 'mcpServer/elicitation/request') result = { action: 'decline', content: null };
    try {
      if (result) this.write({ id: message.id, result });
      else this.write({ id: message.id, error: { code: -32601, message: 'QuickMap does not grant app-server requests.' } });
    } catch { /* The stream may already have closed. */ }
    if (this.active) this.fail(this.active, failure('approval_required'));
  }

  private onNotification(message: RpcMessage): void {
    const active = this.active;
    if (!active) return;
    const params = object(message.params);
    if (string(params?.threadId) !== active.threadId) return;
    if (!active.turnId) {
      if (active.queued.length < 100) active.queued.push(message);
      else this.fail(active, failure('invalid_response'));
      return;
    }
    this.handleTurnNotification(active, message);
  }

  private handleTurnNotification(active: ActiveAsk, message: RpcMessage): void {
    if (this.active !== active) return;
    const params = object(message.params);
    const turn = object(params?.turn);
    const eventTurnId = string(params?.turnId) || string(turn?.id);
    if (eventTurnId !== active.turnId) return;
    if (message.method === 'item/started') {
      const type = string(object(params?.item)?.type);
      if (type && ['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'collabToolCall'].includes(type)) {
        this.fail(active, failure('tool_isolation_failed'));
      }
    } else if (message.method === 'item/agentMessage/delta') {
      const itemId = string(params?.itemId);
      const delta = string(params?.delta);
      if (!itemId || delta === undefined) return;
      const raw = (active.itemText.get(itemId) || '') + delta;
      if (raw.length > MAX_MESSAGE_LENGTH) { this.fail(active, failure('invalid_response')); return; }
      active.itemText.set(itemId, raw);
      const prefix = streamedAnswerPrefix(raw);
      if (prefix === null || prefix.length > MAX_ANSWER_LENGTH || !isSafeAnswerText(prefix)) {
        if (prefix !== null && (prefix.length > MAX_ANSWER_LENGTH || !isSafeAnswerText(prefix))) this.fail(active, failure('invalid_response'));
        return;
      }
      if (prefix.startsWith(active.visibleAnswer)) {
        const text = prefix.slice(active.visibleAnswer.length);
        if (text) {
          active.visibleAnswer = prefix;
          this.emit({ requestId: active.requestId, type: 'delta', text });
        }
      }
    } else if (message.method === 'item/completed') {
      const item = object(params?.item);
      if (item?.type === 'agentMessage' && typeof item.text === 'string') active.finalText = item.text;
    } else if (message.method === 'error') {
      const detail = string(object(params?.error)?.message) || 'Codex turn failed';
      this.fail(active, classify(new Error(detail)));
    } else if (message.method === 'turn/completed') {
      if (turn?.status !== 'completed') {
        const detail = string(object(turn?.error)?.message) || 'Codex turn did not complete';
        this.fail(active, turn?.status === 'interrupted' ? failure('disconnected') : classify(new Error(detail)));
        return;
      }
      const items = Array.isArray(turn.items) ? turn.items : [];
      const authoritative = items.filter((item) => object(item)?.type === 'agentMessage').at(-1);
      const raw = string(object(authoritative)?.text) || active.finalText || [...active.itemText.values()].at(-1) || '';
      try {
        const answer = validateMapAnswer(raw);
        clearTimeout(active.timer);
        this.active = undefined;
        this.emit({ requestId: active.requestId, type: 'completed', ...answer });
      } catch (error) { this.fail(active, classify(error)); }
    }
  }

  private fail(active: ActiveAsk, error: MapCodexFailure): void {
    if (this.active !== active) return;
    this.active = undefined;
    clearTimeout(active.timer);
    this.emit({ requestId: active.requestId, type: 'error', code: error.code, message: error.message });
    if (active.threadId && active.turnId) {
      void this.rpc('turn/interrupt', { threadId: active.threadId, turnId: active.turnId }).catch(() => undefined);
    }
  }

  private rpc(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(failure('timeout'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(classify(error));
      }
    });
  }

  private notify(method: string, params: unknown): void { this.write({ method, params }); }

  private write(message: RpcMessage): void {
    const input = this.process?.stdin;
    if (!input?.writable) throw failure('disconnected');
    input.write(`${JSON.stringify(message)}\n`);
  }
}
