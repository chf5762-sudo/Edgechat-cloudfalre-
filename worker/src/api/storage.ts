import { runAuthorizedBatch } from '../rbac/authorization.ts';
import { ApiError } from '../errors.js';
import { summarizeR2Objects } from '../storage-statistics.js';
import { listStorageOwners } from '../data/users.js';
import { saveUploadedFile } from './upload.js';
import { decryptAttachment, encryptAttachment } from '../encryption.js';
import { errorResponse } from '../utils.js';

// ─── helpers ───────────────────────────────────────────────────────────────

function nanoid(len = 16) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  for (const b of arr) s += chars[b % chars.length];
  return s;
}

function now() { return new Date().toISOString(); }

async function requireOwner(c: any, type: 'file' | 'folder', id: string) {
  const session = c.get('session');
  if (type === 'file') {
    const row = await c.env.DB.prepare(
      `SELECT owner_user_id, trashed_at FROM uploaded_files WHERE object_key = ? LIMIT 1`
    ).bind(id).first() as any;
    if (!row) throw new ApiError('文件不存在或已被删除', 404);
    if (row.owner_user_id !== session.userId && !session.isAdmin) throw new ApiError('无权操作此文件', 403);
    return row;
  } else {
    const row = await c.env.DB.prepare(
      `SELECT owner_user_id, trashed_at FROM storage_folders WHERE id = ? LIMIT 1`
    ).bind(id).first() as any;
    if (!row) throw new ApiError('文件夹不存在', 404);
    if (row.owner_user_id !== session.userId && !session.isAdmin) throw new ApiError('无权操作此文件夹', 403);
    return row;
  }
}

// ─── route registration ────────────────────────────────────────────────────

export function registerStorageRoutes(app: any) {

  // ═══════════════════════════════════════════════════════════════
  // FILES – list
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/storage/files', async (c: any) => {
    const session = c.get('session');
    const search = (c.req.query('q') || '').trim();
    const folderId = c.req.query('folder_id') || null; // null = root
    const sort = c.req.query('sort') || 'created_at';
    const order = c.req.query('order') === 'asc' ? 'ASC' : 'DESC';
    const trash = c.req.query('trash') === '1';

    const sortCol = ['filename', 'size', 'created_at', 'updated_at'].includes(sort) ? sort : 'created_at';

    let sql = `SELECT object_key, owner_user_id, filename, content_type, size, created_at, updated_at, folder_id, trashed_at
               FROM uploaded_files
               WHERE (owner_user_id = ? OR EXISTS (SELECT 1 FROM users WHERE id = ? AND is_admin = 1))`;
    const params: any[] = [session.userId, session.userId];

    if (trash) {
      sql += ` AND trashed_at IS NOT NULL`;
    } else {
      sql += ` AND trashed_at IS NULL`;
      // Filter by folder
      if (folderId === null || folderId === '' || folderId === 'root') {
        sql += ` AND folder_id IS NULL`;
      } else {
        sql += ` AND folder_id = ?`;
        params.push(Number(folderId));
      }
    }

    if (search) {
      sql += ` AND filename LIKE ?`;
      params.push(`%${search}%`);
    }
    sql += ` AND NOT EXISTS (SELECT 1 FROM pending_r2_delete WHERE pending_r2_delete.object_key = uploaded_files.object_key)`;
    sql += ` ORDER BY ${sortCol} ${order} LIMIT 500`;

    const { results } = await c.env.DB.prepare(sql).bind(...params).all();
    const files = (results || []).map((r: any) => ({
      key: r.object_key,
      name: r.filename,
      type: r.content_type,
      size: Number(r.size || 0),
      url: `/files/${encodeURIComponent(r.object_key)}`,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      folderId: r.folder_id ?? null,
      trashedAt: r.trashed_at ?? null,
    }));
    return c.json({ files });
  });

  // ═══════════════════════════════════════════════════════════════
  // FILES – upload
  // ═══════════════════════════════════════════════════════════════
  app.post('/api/storage/files', async (c: any) => {
    if (!c.env.FILES) return errorResponse('当前部署没有绑定 R2，无法上传文件', 503);
    const session = c.get('session');
    const formData = await c.req.formData();
    const file = formData.get('file');
    const rawFolderId = formData.get('folder_id');
    const folderId = rawFolderId ? Number(rawFolderId) : null;

    if (!(file instanceof File)) return errorResponse('请选择有效文件');

    try {
      const result = await saveUploadedFile(c.env, session, file, { allowAllTypes: true });
      // Update folder_id and updated_at
      if (folderId !== null) {
        await c.env.DB.prepare(
          `UPDATE uploaded_files SET folder_id = ?, updated_at = ? WHERE object_key = ?`
        ).bind(folderId, now(), result.file.key).run();
      } else {
        await c.env.DB.prepare(
          `UPDATE uploaded_files SET updated_at = ? WHERE object_key = ?`
        ).bind(now(), result.file.key).run();
      }
      return c.json({
        ok: true,
        file: {
          key: result.file.key,
          name: result.file.name,
          type: result.file.type,
          size: result.file.size,
          url: result.file.url,
          createdAt: now(),
          updatedAt: now(),
          folderId,
        }
      });
    } catch (error: any) {
      return errorResponse(error?.message || '文件上传失败', 400);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // FILES – rename / move
  // ═══════════════════════════════════════════════════════════════
  app.patch('/api/storage/files/:key{.+}', async (c: any) => {
    const key = decodeURIComponent(c.req.param('key'));
    await requireOwner(c, 'file', key);
    const body = await c.req.json().catch(() => ({}));
    const updates: string[] = [];
    const params: any[] = [];

    if (body.filename !== undefined) { updates.push('filename = ?'); params.push(String(body.filename).trim()); }
    if (body.folder_id !== undefined) { updates.push('folder_id = ?'); params.push(body.folder_id === null ? null : Number(body.folder_id)); }
    if (!updates.length) return errorResponse('无更新内容');

    updates.push('updated_at = ?'); params.push(now());
    params.push(key);
    await c.env.DB.prepare(`UPDATE uploaded_files SET ${updates.join(', ')} WHERE object_key = ?`).bind(...params).run();
    return c.json({ ok: true });
  });

  // ═══════════════════════════════════════════════════════════════
  // FILES – read text content
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/storage/files/:key{.+}/content', async (c: any) => {
    const key = decodeURIComponent(c.req.param('key'));
    await requireOwner(c, 'file', key);
    if (!c.env.FILES) return errorResponse('R2 未绑定', 503);
    const obj = await c.env.FILES.get(key);
    if (!obj) return errorResponse('文件不存在于存储', 404);
    try {
      const buf = await obj.arrayBuffer();
      let rawBytes: Uint8Array;
      try {
        const dec = await decryptAttachment(c.env, buf, key);
        rawBytes = dec.bytes;
      } catch {
        rawBytes = new Uint8Array(buf);
      }
      const text = new TextDecoder('utf-8').decode(rawBytes);
      return c.json({ content: text });
    } catch (e: any) {
      return errorResponse('无法解析文件内容: ' + e.message, 400);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // FILES – save text content (auto-save)
  // ═══════════════════════════════════════════════════════════════
  const saveContentHandler = async (c: any) => {
    const key = decodeURIComponent(c.req.param('key'));
    await requireOwner(c, 'file', key);
    if (!c.env.FILES) return errorResponse('R2 未绑定', 503);
    const body = await c.req.json().catch(() => ({}));
    const content = body.content ?? '';
    const enc = new TextEncoder();
    const bytes = enc.encode(content);
    const row = await c.env.DB.prepare(
      `SELECT content_type, filename FROM uploaded_files WHERE object_key = ? LIMIT 1`
    ).bind(key).first() as any;

    let toStore: ArrayBuffer;
    try {
      toStore = await encryptAttachment(c.env, bytes.buffer, key);
    } catch {
      toStore = bytes.buffer;
    }

    const contentType = row?.content_type || 'text/plain';
    await c.env.FILES.put(key, toStore, {
      httpMetadata: { contentType, cacheControl: 'private, no-store' },
      customMetadata: { filename: row?.filename || 'file.txt', edgechatEncryption: 'v1' }
    });
    await c.env.DB.prepare(
      `UPDATE uploaded_files SET size = ?, updated_at = ? WHERE object_key = ?`
    ).bind(bytes.length, now(), key).run();
    return c.json({ ok: true, size: bytes.length });
  };
  if (typeof app.put === 'function') {
    app.put('/api/storage/files/:key{.+}/content', saveContentHandler);
  }
  app.post('/api/storage/files/:key{.+}/content', saveContentHandler);

  // ═══════════════════════════════════════════════════════════════
  // FILES – create public share link
  // ═══════════════════════════════════════════════════════════════
  app.post('/api/storage/files/:key{.+}/share', async (c: any) => {
    const key = decodeURIComponent(c.req.param('key'));
    await requireOwner(c, 'file', key);
    const session = c.get('session');

    // Return existing share token if present
    const existing = await c.env.DB.prepare(
      `SELECT token FROM storage_shares WHERE object_key = ? AND folder_id IS NULL LIMIT 1`
    ).bind(key).first() as any;
    if (existing) {
      const url = `${new URL(c.req.url).origin}/s/${existing.token}`;
      return c.json({ ok: true, url, token: existing.token });
    }

    const token = nanoid(20);
    const id = nanoid(16);
    await c.env.DB.prepare(
      `INSERT INTO storage_shares (id, object_key, owner_user_id, token, created_at) VALUES (?, ?, ?, ?, ?)`
    ).bind(id, key, session.userId, token, now()).run();

    const url = `${new URL(c.req.url).origin}/s/${token}`;
    return c.json({ ok: true, url, token });
  });

  // ═══════════════════════════════════════════════════════════════
  // FILES – delete / trash
  // ═══════════════════════════════════════════════════════════════
  app.delete('/api/storage/files/:key{.+}', async (c: any) => {
    const key = decodeURIComponent(c.req.param('key'));
    const row = await requireOwner(c, 'file', key);
    const permanent = c.req.query('permanent') === '1';

    if (permanent || row.trashed_at) {
      // Hard delete
      if (c.env.FILES) await c.env.FILES.delete(key).catch(() => {});
      await c.env.DB.prepare('DELETE FROM uploaded_files WHERE object_key = ?').bind(key).run();
      await c.env.DB.prepare('DELETE FROM storage_shares WHERE object_key = ?').bind(key).run();
    } else {
      // Soft delete (move to trash)
      await c.env.DB.prepare(
        `UPDATE uploaded_files SET trashed_at = ?, updated_at = ? WHERE object_key = ?`
      ).bind(now(), now(), key).run();
    }
    return c.json({ ok: true, key });
  });

  // ═══════════════════════════════════════════════════════════════
  // FILES & FOLDERS – batch operations
  // ═══════════════════════════════════════════════════════════════
  app.post('/api/storage/files/batch', async (c: any) => {
    const session = c.get('session');
    const body = await c.req.json().catch(() => ({}));
    const { action, keys = [], folder_ids = [], folder_id } = body;

    if (!['delete', 'restore', 'move', 'permanent-delete'].includes(action)) {
      return errorResponse('无效操作');
    }
    if ((!Array.isArray(keys) || keys.length === 0) && (!Array.isArray(folder_ids) || folder_ids.length === 0)) {
      return errorResponse('请选择项目');
    }

    for (const key of keys) {
      const row = await c.env.DB.prepare(
        `SELECT owner_user_id FROM uploaded_files WHERE object_key = ? LIMIT 1`
      ).bind(key).first() as any;
      if (!row || (row.owner_user_id !== session.userId && !session.isAdmin)) continue;

      if (action === 'delete') {
        await c.env.DB.prepare(
          `UPDATE uploaded_files SET trashed_at = ?, updated_at = ? WHERE object_key = ?`
        ).bind(now(), now(), key).run();
      } else if (action === 'restore') {
        await c.env.DB.prepare(
          `UPDATE uploaded_files SET trashed_at = NULL, updated_at = ? WHERE object_key = ?`
        ).bind(now(), key).run();
      } else if (action === 'move') {
        const fid = folder_id === null ? null : Number(folder_id);
        await c.env.DB.prepare(
          `UPDATE uploaded_files SET folder_id = ?, updated_at = ? WHERE object_key = ?`
        ).bind(fid, now(), key).run();
      } else if (action === 'permanent-delete') {
        if (c.env.FILES) await c.env.FILES.delete(key).catch(() => {});
        await c.env.DB.prepare('DELETE FROM uploaded_files WHERE object_key = ?').bind(key).run();
        await c.env.DB.prepare('DELETE FROM storage_shares WHERE object_key = ?').bind(key).run();
      }
    }

    for (const rawFid of folder_ids) {
      const fid = Number(rawFid);
      const row = await c.env.DB.prepare(
        `SELECT owner_user_id FROM storage_folders WHERE id = ? LIMIT 1`
      ).bind(fid).first() as any;
      if (!row || (row.owner_user_id !== session.userId && !session.isAdmin)) continue;

      if (action === 'delete') {
        await c.env.DB.prepare(
          `UPDATE storage_folders SET trashed_at = ?, updated_at = ? WHERE id = ?`
        ).bind(now(), now(), fid).run();
        await c.env.DB.prepare(
          `UPDATE uploaded_files SET trashed_at = ?, updated_at = ? WHERE folder_id = ? AND trashed_at IS NULL`
        ).bind(now(), now(), fid).run();
      } else if (action === 'restore') {
        await c.env.DB.prepare(
          `UPDATE storage_folders SET trashed_at = NULL, updated_at = ? WHERE id = ?`
        ).bind(now(), fid).run();
        await c.env.DB.prepare(
          `UPDATE uploaded_files SET trashed_at = NULL, updated_at = ? WHERE folder_id = ? AND trashed_at IS NOT NULL`
        ).bind(now(), fid).run();
      } else if (action === 'permanent-delete') {
        await c.env.DB.prepare(
          `UPDATE uploaded_files SET folder_id = NULL, updated_at = ? WHERE folder_id = ?`
        ).bind(now(), fid).run();
        await c.env.DB.prepare('DELETE FROM storage_folders WHERE id = ?').bind(fid).run();
        await c.env.DB.prepare('DELETE FROM storage_shares WHERE folder_id = ?').bind(fid).run();
      }
    }

    return c.json({ ok: true });
  });

  // ═══════════════════════════════════════════════════════════════
  // TRASH – purge all
  // ═══════════════════════════════════════════════════════════════
  app.delete('/api/storage/trash', async (c: any) => {
    const session = c.get('session');
    const { results: trashedFiles } = await c.env.DB.prepare(
      `SELECT object_key FROM uploaded_files WHERE owner_user_id = ? AND trashed_at IS NOT NULL`
    ).bind(session.userId).all();

    for (const row of trashedFiles || []) {
      if (c.env.FILES) await c.env.FILES.delete(row.object_key).catch(() => {});
      await c.env.DB.prepare('DELETE FROM uploaded_files WHERE object_key = ?').bind(row.object_key).run();
    }

    // Also purge trashed folders
    const { results: trashedFolders } = await c.env.DB.prepare(
      `SELECT id FROM storage_folders WHERE owner_user_id = ? AND trashed_at IS NOT NULL`
    ).bind(session.userId).all();
    for (const row of trashedFolders || []) {
      await c.env.DB.prepare('DELETE FROM storage_folders WHERE id = ?').bind(row.id).run();
    }

    return c.json({ ok: true, deleted: (trashedFiles?.length || 0) + (trashedFolders?.length || 0) });
  });

  // ═══════════════════════════════════════════════════════════════
  // FOLDERS – list
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/storage/folders', async (c: any) => {
    const session = c.get('session');
    const parentId = c.req.query('parent_id') || null;
    const trash = c.req.query('trash') === '1';

    let sql = `SELECT id, name, parent_id, created_at, updated_at, trashed_at
               FROM storage_folders
               WHERE owner_user_id = ?`;
    const params: any[] = [session.userId];

    if (trash) {
      sql += ` AND trashed_at IS NOT NULL`;
    } else {
      sql += ` AND trashed_at IS NULL`;
      if (parentId === null || parentId === '' || parentId === 'root') {
        sql += ` AND parent_id IS NULL`;
      } else {
        sql += ` AND parent_id = ?`;
        params.push(Number(parentId));
      }
    }
    sql += ` ORDER BY name ASC`;

    const { results } = await c.env.DB.prepare(sql).bind(...params).all();
    const folders = (results || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      parentId: r.parent_id ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      trashedAt: r.trashed_at ?? null,
    }));
    return c.json({ folders });
  });

  // ═══════════════════════════════════════════════════════════════
  // FOLDERS – create
  // ═══════════════════════════════════════════════════════════════
  app.post('/api/storage/folders', async (c: any) => {
    const session = c.get('session');
    const body = await c.req.json().catch(() => ({}));
    const name = (body.name || '').trim();
    if (!name) return errorResponse('请输入文件夹名称');
    const parentId = body.parent_id !== undefined ? (body.parent_id === null ? null : Number(body.parent_id)) : null;
    const n = now();

    const result = await c.env.DB.prepare(
      `INSERT INTO storage_folders (owner_user_id, parent_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(session.userId, parentId, name, n, n).run();

    return c.json({
      ok: true,
      folder: { id: result.meta.last_row_id, name, parentId, createdAt: n, updatedAt: n }
    }, 201);
  });

  // ═══════════════════════════════════════════════════════════════
  // FOLDERS – rename
  // ═══════════════════════════════════════════════════════════════
  app.patch('/api/storage/folders/:id', async (c: any) => {
    const id = Number(c.req.param('id'));
    await requireOwner(c, 'folder', String(id));
    const body = await c.req.json().catch(() => ({}));
    const name = (body.name || '').trim();
    if (!name) return errorResponse('请输入文件夹名称');
    await c.env.DB.prepare(
      `UPDATE storage_folders SET name = ?, updated_at = ? WHERE id = ?`
    ).bind(name, now(), id).run();
    return c.json({ ok: true });
  });

  // ═══════════════════════════════════════════════════════════════
  // FOLDERS – delete (soft / hard)
  // ═══════════════════════════════════════════════════════════════
  app.delete('/api/storage/folders/:id', async (c: any) => {
    const id = Number(c.req.param('id'));
    const row = await requireOwner(c, 'folder', String(id));
    const permanent = c.req.query('permanent') === '1';

    if (permanent || row.trashed_at) {
      // Move files in folder to root before hard delete
      await c.env.DB.prepare(
        `UPDATE uploaded_files SET folder_id = NULL, updated_at = ? WHERE folder_id = ?`
      ).bind(now(), id).run();
      await c.env.DB.prepare('DELETE FROM storage_folders WHERE id = ?').bind(id).run();
    } else {
      // Soft delete
      await c.env.DB.prepare(
        `UPDATE storage_folders SET trashed_at = ?, updated_at = ? WHERE id = ?`
      ).bind(now(), now(), id).run();
      // Also trash files inside
      await c.env.DB.prepare(
        `UPDATE uploaded_files SET trashed_at = ?, updated_at = ? WHERE folder_id = ? AND trashed_at IS NULL`
      ).bind(now(), now(), id).run();
    }
    return c.json({ ok: true });
  });

  // ═══════════════════════════════════════════════════════════════
  // FOLDERS – restore from trash
  // ═══════════════════════════════════════════════════════════════
  app.post('/api/storage/folders/:id/restore', async (c: any) => {
    const id = Number(c.req.param('id'));
    await requireOwner(c, 'folder', String(id));
    await c.env.DB.prepare(
      `UPDATE storage_folders SET trashed_at = NULL, updated_at = ? WHERE id = ?`
    ).bind(now(), id).run();
    await c.env.DB.prepare(
      `UPDATE uploaded_files SET trashed_at = NULL, updated_at = ? WHERE folder_id = ? AND trashed_at IS NOT NULL`
    ).bind(now(), id).run();
    return c.json({ ok: true });
  });

  // ═══════════════════════════════════════════════════════════════
  // FOLDERS – create share link
  // ═══════════════════════════════════════════════════════════════
  app.post('/api/storage/folders/:id/share', async (c: any) => {
    const id = Number(c.req.param('id'));
    await requireOwner(c, 'folder', String(id));
    const session = c.get('session');

    const existing = await c.env.DB.prepare(
      `SELECT token FROM storage_shares WHERE folder_id = ? LIMIT 1`
    ).bind(id).first() as any;
    if (existing) {
      const url = `${new URL(c.req.url).origin}/s/${existing.token}`;
      return c.json({ ok: true, url, token: existing.token });
    }

    const token = nanoid(20);
    const shareId = nanoid(16);
    await c.env.DB.prepare(
      `INSERT INTO storage_shares (id, folder_id, owner_user_id, token, created_at) VALUES (?, ?, ?, ?, ?)`
    ).bind(shareId, id, session.userId, token, now()).run();

    const url = `${new URL(c.req.url).origin}/s/${token}`;
    return c.json({ ok: true, url, token });
  });

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC SHARE – serve file or folder listing (no auth)
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/storage/share-view/:token', async (c: any) => {
    const token = c.req.param('token');    const share = await c.env.DB.prepare(
      `SELECT object_key, folder_id FROM storage_shares WHERE token = ? LIMIT 1`
    ).bind(token).first() as any;

    if (!share) {
      return c.html(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px">
        <h2>链接无效或已过期</h2><p>该分享链接不存在或已被删除。</p></body></html>`, 404);
    }

    // File share
    if (share.object_key) {
      const row = await c.env.DB.prepare(
        `SELECT filename, content_type FROM uploaded_files WHERE object_key = ? LIMIT 1`
      ).bind(share.object_key).first() as any;
      if (!row || !c.env.FILES) {
        return c.html(`<html><body>文件不存在</body></html>`, 404);
      }
      const obj = await c.env.FILES.get(share.object_key);
      if (!obj) return c.html(`<html><body>文件不存在于存储</body></html>`, 404);
      let body: any;
      try {
        const buf = await obj.arrayBuffer();
        try {
          const dec = await decryptAttachment(c.env, buf, share.object_key);
          body = dec.bytes;
        } catch {
          body = buf;
        }
      } catch {
        body = obj.body;
      }
      return new Response(body, {
        headers: {
          'Content-Type': row.content_type || 'application/octet-stream',
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
          'Cache-Control': 'public, max-age=3600',
        }
      });
    }

    // Folder share – list contents as HTML
    if (share.folder_id) {
      const folder = await c.env.DB.prepare(
        `SELECT name FROM storage_folders WHERE id = ? LIMIT 1`
      ).bind(share.folder_id).first() as any;
      const { results: files } = await c.env.DB.prepare(
        `SELECT object_key, filename, content_type, size, created_at FROM uploaded_files
         WHERE folder_id = ? AND trashed_at IS NULL ORDER BY filename ASC`
      ).bind(share.folder_id).all();

      const rows = (files || []).map((f: any) => {
        const fileShareUrl = `/files/${encodeURIComponent(f.object_key)}`;
        const size = Number(f.size || 0);
        const kb = size > 1024 * 1024 ? `${(size/1024/1024).toFixed(1)} MB` : `${(size/1024).toFixed(1)} KB`;
        return `<tr>
          <td style="padding:8px 12px"><a href="${fileShareUrl}" target="_blank" style="color:#2563eb;text-decoration:none">${f.filename}</a></td>
          <td style="padding:8px 12px;color:#666">${f.content_type}</td>
          <td style="padding:8px 12px;color:#666">${kb}</td>
        </tr>`;
      }).join('');

      return c.html(`<!DOCTYPE html><html><head><meta charset="utf-8">
        <title>共享文件夹: ${folder?.name || '未知'}</title>
        <style>body{font-family:system-ui,sans-serif;padding:40px;max-width:900px;margin:0 auto}
        h1{font-size:1.5rem;margin-bottom:4px}p{color:#666;margin-bottom:24px}
        table{width:100%;border-collapse:collapse}th{text-align:left;padding:8px 12px;border-bottom:2px solid #e2e8f0;font-size:.875rem;color:#374151}
        tr:hover{background:#f8fafc}tr{border-bottom:1px solid #f1f5f9}</style>
        </head><body>
        <h1>📂 ${folder?.name || '共享文件夹'}</h1>
        <p>${(files||[]).length} 个文件</p>
        <table><thead><tr><th>文件名</th><th>类型</th><th>大小</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" style="padding:20px;text-align:center;color:#9ca3af">文件夹为空</td></tr>'}</tbody>
        </table></body></html>`);
    }

    return c.html(`<html><body>无效链接</body></html>`, 404);
  });

  // ═══════════════════════════════════════════════════════════════
  // NOTES IMAGES – upload for inline embedding
  // ═══════════════════════════════════════════════════════════════
  app.post('/api/notes/images', async (c: any) => {
    if (!c.env.FILES) return errorResponse('R2 未绑定', 503);
    const session = c.get('session');
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return errorResponse('请选择图片文件');
    if (!file.type.startsWith('image/')) return errorResponse('仅支持图片文件');

    const ext = file.name.split('.').pop() || 'png';
    const key = `notes/images/${session.userId}/${nanoid(12)}.${ext}`;
    const buf = await file.arrayBuffer();
    await c.env.FILES.put(key, buf, { httpMetadata: { contentType: file.type } });
    const url = `/files/${encodeURIComponent(key)}`;
    return c.json({ ok: true, url });
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN routes (unchanged)
  // ═══════════════════════════════════════════════════════════════
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
