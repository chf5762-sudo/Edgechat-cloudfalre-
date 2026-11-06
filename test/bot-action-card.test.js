import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs from 'sql.js';
import worker from '../worker/src/index.js';
import { createSession, hashPassword } from '../worker/src/auth.js';
import { getUserByUsername } from '../worker/src/data/users.js';
import { createD1Adapter, createKvAdapter } from './support/d1.js';
import { renderMermaidSvg } from '../frontend/src/composables/useMermaid.ts';

const SQL = await initSqlJs();
const schema = readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8');
const password = await hashPassword('Test123456');

async function createTestHarness() {
  const database = new SQL.Database();
  database.exec(schema);

  database.run(
    `INSERT INTO users (username, display_name, password_hash, password_salt, is_super_admin)
     VALUES (?, ?, ?, ?, ?)`,
    ['admin', 'Admin', password.hash, password.salt, 1]
  );
  database.run(
    `INSERT OR IGNORE INTO channels (id, name, description, kind, created_by)
     VALUES (1, 'general', 'General Channel', 'public', 1)`
  );
  database.run(`INSERT OR IGNORE INTO channel_members (channel_id, user_id, role) VALUES (1, 1, 'admin')`);

  const env = {
    DB: createD1Adapter(database),
    SESSIONS: createKvAdapter(),
    EDGECHAT_ENCRYPTION_KEYRING: JSON.stringify({ activeKeyId: 'test', keys: { test: Buffer.alloc(32, 1).toString('base64') } })
  };
  const adminSession = await createSession(env, await getUserByUsername(env.DB, 'admin'));

  async function request(path, body, { method = body ? 'POST' : 'GET', token = adminSession.token, headers = {} } = {}) {
    const response = await worker.fetch(
      new Request(`https://test.local/api${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
          ...headers
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      }),
      env,
      { waitUntil(promise) { promise.catch(() => {}); } }
    );
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      return { status: response.status, headers: response.headers, text: await response.text() };
    }
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: response.status, body: json, text, headers: response.headers };
  }

  return { database, env, adminSession, request };
}

test('Bot 协议：GET /api/bot/stream 建立标准 SSE 事件流连接', async () => {
  const h = await createTestHarness();
  const res = await h.request('/bot/stream?channelId=1');
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type')?.includes('text/event-stream'));
  assert.ok(res.text.includes('event: connected'));
  assert.ok(res.text.includes('Bot Agent SSE stream established'));
});

test('Bot 协议：POST /api/bot/action-callback 接收交互卡片点击确认', async () => {
  const h = await createTestHarness();
  const res = await h.request('/bot/action-callback', {
    channelId: 1,
    actionId: 'confirm_deploy',
    actionPayload: '批准上线',
    cardTitle: '边缘节点部署方案'
  }, { method: 'POST' });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.status, 'acknowledged');
  assert.equal(res.body.actionId, 'confirm_deploy');
  assert.ok(res.body.recordedText.includes('批准上线'));
});

test('Bot 协议：POST /api/bot/send-card 发送富交互卡片并持久化', async () => {
  const h = await createTestHarness();
  const res = await h.request('/bot/send-card', {
    channelId: 1,
    kind: 'public',
    title: '系统重构架构图与确认',
    description: '方案由 Bot Agent 生成',
    mermaid: 'graph LR\n A[Client] --> B[Server]',
    document: '# 方案说明\n详细步骤...',
    actions: [
      { id: 'approve', label: '确认执行', style: 'primary', payload: 'yes' },
      { id: 'reject', label: '驳回', style: 'danger', payload: 'no' }
    ]
  }, { method: 'POST' });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.messageId > 0);
  assert.equal(res.body.card.title, '系统重构架构图与确认');
});

test('Mermaid 渲染器：支持将 Mermaid 代码转换为 SVG 矢量图', async () => {
  const code = `graph TD\n A[用户请求] --> B[边缘节点]\n B --> C[D1 数据库]`;
  const svg = await renderMermaidSvg(code);
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('用户请求'));
  assert.ok(svg.includes('边缘节点'));
  assert.ok(svg.includes('D1 数据库'));
});
