import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs from 'sql.js';
import worker from '../worker/src/index.js';
import { createSession, hashPassword } from '../worker/src/auth.js';
import { getUserByUsername } from '../worker/src/data/users.js';
import { createD1Adapter, createKvAdapter } from './support/d1.js';

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
    `INSERT INTO users (username, display_name, password_hash, password_salt, is_super_admin)
     VALUES (?, ?, ?, ?, ?)`,
    ['15629038878', 'User 156', password.hash, password.salt, 0]
  );

  database.run(`INSERT OR IGNORE INTO rbac_user_roles (user_id, role_id) VALUES (1, 1), (2, 1)`);

  const env = { DB: createD1Adapter(database), SESSIONS: createKvAdapter() };
  const adminSession = await createSession(env, await getUserByUsername(env.DB, 'admin'));

  async function request(path, body, { method = body ? 'POST' : 'GET', token = adminSession.token } = {}) {
    const response = await worker.fetch(
      new Request(`https://test.local/api${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json'
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      }),
      env,
      { waitUntil() {} }
    );
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: response.status, body: json, text };
  }

  return { database, env, adminSession, request };
}

test('后台删除用户：自动归档重命名 username、解除 RBAC 关联，并允许原手机号重新注册', async () => {
  const h = await createTestHarness();

  // 1. 删除前：普通用户组成员数为 2（admin 与 15629038878）
  const rolesBefore = await h.request('/admin/rbac/roles');
  assert.equal(rolesBefore.status, 200);
  const defaultRoleBefore = rolesBefore.body.roles.find((r) => r.id === 1);
  assert.equal(defaultRoleBefore.memberCount, 2);

  const membersBefore = await h.request('/admin/rbac/roles/1/members');
  assert.equal(membersBefore.status, 200);
  assert.equal(membersBefore.body.members.length, 2);

  // 2. 执行删除普通用户 (id=2)
  const delRes = await h.request('/admin/users/2', null, { method: 'DELETE' });
  assert.equal(delRes.status, 200);
  assert.equal(delRes.body.ok, true);

  // 验证底层数据库状态
  const archivedUser = await h.env.DB.prepare('SELECT id, username, deleted_at, is_disabled FROM users WHERE id = 2').first();
  assert.equal(archivedUser.id, 2);
  assert.equal(archivedUser.username, '__del_2_15629038878');
  assert.ok(archivedUser.deleted_at !== null);
  assert.equal(archivedUser.is_disabled, 1);

  // 3. 删除后：RBAC 用户组列表与成员抽屉已排除已删除用户
  const rolesAfter = await h.request('/admin/rbac/roles');
  const defaultRoleAfter = rolesAfter.body.roles.find((r) => r.id === 1);
  assert.equal(defaultRoleAfter.memberCount, 1);

  const membersAfter = await h.request('/admin/rbac/roles/1/members');
  assert.equal(membersAfter.body.members.length, 1);
  assert.equal(membersAfter.body.members[0].username, 'admin');

  // 4. 原手机号 15629038878 释放，创建注册链接并重新注册
  const inviteRes = await h.request('/admin/register-links', { note: 'test re-register', maxUses: 5 }, { method: 'POST' });
  assert.equal(inviteRes.status, 200);
  const inviteToken = inviteRes.body.invite.token;

  const regRes = await h.request(`/register-links/${inviteToken}/register`, {
    username: '15629038878',
    password: 'NewPassword123',
    displayName: 'ReRegisteredUser'
  }, { method: 'POST', token: null });

  assert.equal(regRes.status, 200);
  assert.equal(regRes.body.ok, true);

  // 5. 验证新用户已成功插入，拥有新 id 且状态正常
  const newUser = await h.env.DB.prepare('SELECT id, username, display_name, deleted_at, is_disabled FROM users WHERE username = ?')
    .bind('15629038878').first();
  assert.ok(newUser);
  assert.equal(newUser.id, 3);
  assert.equal(newUser.username, '15629038878');
  assert.equal(newUser.deleted_at, null);
  assert.equal(newUser.is_disabled, 0);

  // 老用户记录依然完整存在且独立
  const oldUser = await h.env.DB.prepare('SELECT id, username, deleted_at FROM users WHERE id = 2').first();
  assert.equal(oldUser.username, '__del_2_15629038878');
  assert.ok(oldUser.deleted_at !== null);
});

test('后台删除用户：禁止删除超级管理员', async () => {
  const h = await createTestHarness();
  const delSuper = await h.request('/admin/users/1', null, { method: 'DELETE' });
  assert.equal(delSuper.status, 403);
});
