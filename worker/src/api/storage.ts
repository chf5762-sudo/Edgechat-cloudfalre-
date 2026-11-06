import { runAuthorizedBatch } from '../rbac/authorization.ts';
import { ApiError } from '../errors.js';
import { summarizeR2Objects } from '../storage-statistics.js';
import { listStorageOwners } from '../data/users.js';
import { saveUploadedFile } from './upload.js';
import { errorResponse } from '../utils.js';

export function registerStorageRoutes(app: any) {
  // Cloud storage file list for current user
  app.get('/api/storage/files', async (c: any) => {
    const session = c.get('session');
    const search = (c.req.query('q') || '').trim();

    let sql = `SELECT object_key, owner_user_id, filename, content_type, size, created_at
               FROM uploaded_files
               WHERE (owner_user_id = ? OR EXISTS (SELECT 1 FROM users WHERE id = ? AND is_admin = 1))
                 AND NOT EXISTS (SELECT 1 FROM pending_r2_delete WHERE pending_r2_delete.object_key = uploaded_files.object_key)`;
    const params: any[] = [session.userId, session.userId];
    if (search) {
      sql += ` AND filename LIKE ?`;
      params.push(`%${search}%`);
    }
    sql += ` ORDER BY created_at DESC LIMIT 100`;

    const { results } = await c.env.DB.prepare(sql).bind(...params).all();
    const files = (results || []).map((r: any) => ({
      key: r.object_key,
      name: r.filename,
      type: r.content_type,
      size: Number(r.size || 0),
      url: `/files/${encodeURIComponent(r.object_key)}`,
      createdAt: r.created_at,
    }));
    return c.json({ files });
  });

  // Cloud storage upload: accepts any file type
  app.post('/api/storage/files', async (c: any) => {
    if (!c.env.FILES) {
      return errorResponse('当前部署没有绑定 R2，无法上传文件', 503);
    }
    const session = c.get('session');
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return errorResponse('请选择有效文件');
    }

    try {
      const result = await saveUploadedFile(c.env, session, file, { allowAllTypes: true });
      return c.json({
        ok: true,
        file: {
          key: result.file.key,
          name: result.file.name,
          type: result.file.type,
          size: result.file.size,
          url: result.file.url,
          createdAt: new Date().toISOString(),
        }
      });
    } catch (error: any) {
      return errorResponse(error?.message || '文件上传失败', 400);
    }
  });

  // Cloud storage delete: deletes from R2 and removes record
  app.delete('/api/storage/files/:key{.+}', async (c: any) => {
    const session = c.get('session');
    const key = decodeURIComponent(c.req.param('key'));
    if (!key) return errorResponse('缺少文件键值', 400);

    const row = await c.env.DB.prepare(
      `SELECT owner_user_id FROM uploaded_files WHERE object_key = ? LIMIT 1`
    ).bind(key).first() as any;

    if (!row) {
      return errorResponse('文件不存在或已被删除', 404);
    }

    if (row.owner_user_id !== session.userId && !session.isAdmin) {
      return errorResponse('无权删除此文件', 403);
    }

    if (c.env.FILES) {
      await c.env.FILES.delete(key).catch(() => {});
    }
    await c.env.DB.prepare('DELETE FROM uploaded_files WHERE object_key = ?').bind(key).run();

    return c.json({ ok: true, key });
  });

  // Admin storage routes
  app.get('/api/admin/storage', async (c: any) => {
    const row = await c.env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key = 'admin_storage_snapshot'").first();
    return c.json(row ? JSON.parse(row.setting_value) : { items: [], users: [], scannedAt: null });
  });
  app.post('/api/admin/storage/scan', async (c: any) => {
    if (!c.env.FILES) throw new ApiError('当前部署没有绑定 R2，无法统计存储空间', 503);
    const cursor = c.req.query('cursor') || '';
    const key = `storage-scan:${c.get('session').userId}`;
    let state = cursor ? JSON.parse(await c.env.SESSIONS.get(key) || 'null') : null;
    if (cursor && (!state || state.cursor !== cursor || state.pages >= 100)) throw new ApiError('扫描游标无效或超过单次扫描范围', 400);
    const db = c.get('authorizationDatabase');
    if (!cursor) {
      await runAuthorizedBatch(db, c.get('authorizationContext'), [], {
        sql: "NOT EXISTS (SELECT 1 FROM admin_audit_log WHERE actor_id = ? AND action = 'storage.scan' AND created_at > datetime('now', '-1 minute'))",
        params: [c.get('session').userId],
      });
      state = { pages: 0, items: {}, users: await listStorageOwners(db) };
    }
    const listed = await c.env.FILES.list({ limit: 1000, ...(cursor ? { cursor } : {}), include: [] });
    const items = summarizeR2Objects(listed.objects);
    for (const item of items) {
      const previous = state.items[item.ownerKey];
      state.items[item.ownerKey] = previous ? { ...item, bytes: previous.bytes + item.bytes,
        objectCount: previous.objectCount + item.objectCount, latestUploadedAt: [previous.latestUploadedAt, item.latestUploadedAt].filter(Boolean).sort().pop() || null } : item;
    }
    state.pages++;
    state.cursor = listed.truncated ? listed.cursor : null;
    if (listed.truncated) await c.env.SESSIONS.put(key, JSON.stringify(state), { expirationTtl: 600 });
    else {
      const snapshot = { items: Object.values(state.items), users: state.users, scannedAt: new Date().toISOString() };
      await runAuthorizedBatch(db, c.get('authorizationContext'), [db.prepare(`INSERT INTO site_settings (setting_key, setting_value)
        VALUES ('admin_storage_snapshot', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP`).bind(JSON.stringify(snapshot))]);
      await c.env.SESSIONS.delete(key);
    }
    return c.json({ items, users: cursor ? undefined : state.users, scannedObjects: listed.objects.length, truncated: listed.truncated, cursor: state.cursor });
  });
}
