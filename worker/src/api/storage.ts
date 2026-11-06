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

export const AGENT_SHARED_FOLDER_NAME = 'agent-共享免密目录';
export const AGENT_SHARED_TOKEN = 'agent-shared';

export function formatTimestampPrefix(date = new Date()): string {
  const YYYY = date.getUTCFullYear();
  const MM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const DD = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${YYYY}${MM}${DD}_${hh}${mm}${ss}`;
}

export function applyAutoTimestamp(originalName: string): string {
  let name = (originalName || 'report.md').trim();
  name = name.split('/').pop() || name;
  name = name.split('\\').pop() || name;
  if (/^\d{8}_\d{6}_/.test(name)) {
    return name;
  }
  const prefix = formatTimestampPrefix();
  return `${prefix}_${name}`;
}

export function getMimeTypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    csv: 'text/csv',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    zip: 'application/zip',
    tar: 'application/x-tar',
    gz: 'application/gzip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    wav: 'audio/wav',
    html: 'text/plain',
    js: 'text/javascript',
    ts: 'text/plain',
    py: 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}

export async function ensureAgentSharedFolder(db: any): Promise<{ id: number; token: string; ownerUserId: number }> {
  let folder = await db.prepare(
    `SELECT id, owner_user_id FROM storage_folders WHERE name = ? AND trashed_at IS NULL AND deleted_at IS NULL LIMIT 1`
  ).bind(AGENT_SHARED_FOLDER_NAME).first() as any;

  let ownerUserId = 1;
  if (!folder) {
    const admin = await db.prepare(`SELECT id FROM users WHERE is_admin = 1 ORDER BY id ASC LIMIT 1`).first() as any;
    if (admin?.id) ownerUserId = admin.id;

    const n = now();
    const res = await db.prepare(
      `INSERT INTO storage_folders (owner_user_id, parent_id, name, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?)`
    ).bind(ownerUserId, AGENT_SHARED_FOLDER_NAME, n, n).run();
    folder = { id: res.meta.last_row_id, owner_user_id: ownerUserId };
  } else {
    ownerUserId = Number(folder.owner_user_id) || 1;
  }

  const existingShare = await db.prepare(
    `SELECT id, token, folder_id FROM storage_shares WHERE token = ? LIMIT 1`
  ).bind(AGENT_SHARED_TOKEN).first() as any;

  if (!existingShare) {
    await db.prepare(
      `INSERT INTO storage_shares (id, folder_id, owner_user_id, token, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(nanoid(16), folder.id, ownerUserId, AGENT_SHARED_TOKEN, now()).run();
  } else if (existingShare.folder_id !== folder.id) {
    await db.prepare(
      `UPDATE storage_shares SET folder_id = ? WHERE token = ?`
    ).bind(folder.id, AGENT_SHARED_TOKEN).run();
  }

  return { id: folder.id, token: AGENT_SHARED_TOKEN, ownerUserId };
}

export async function getDescendantFolderIds(db: any, rootFolderId: number): Promise<number[]> {
  try {
    const { results } = await db.prepare(
      `WITH RECURSIVE sf AS (
         SELECT id FROM storage_folders WHERE id = ?
         UNION ALL
         SELECT f.id FROM storage_folders f JOIN sf ON f.parent_id = sf.id
         WHERE f.trashed_at IS NULL AND f.deleted_at IS NULL
       )
       SELECT id FROM sf`
    ).bind(rootFolderId).all();
    return (results || []).map((r: any) => Number(r.id));
  } catch {
    const { results } = await db.prepare(
      `SELECT id FROM storage_folders WHERE (id = ? OR parent_id = ?) AND trashed_at IS NULL AND deleted_at IS NULL`
    ).bind(rootFolderId, rootFolderId).all();
    return (results || []).map((r: any) => Number(r.id));
  }
}

export async function ensureProjectFolder(db: any, rootFolderId: number, projectName: string, ownerUserId: number): Promise<number> {
  const cleanName = projectName.trim();
  if (!cleanName) return rootFolderId;

  const existing = await db.prepare(
    `SELECT id FROM storage_folders WHERE parent_id = ? AND name = ? AND trashed_at IS NULL AND deleted_at IS NULL LIMIT 1`
  ).bind(rootFolderId, cleanName).first() as any;

  if (existing?.id) return existing.id;

  const n = now();
  const res = await db.prepare(
    `INSERT INTO storage_folders (owner_user_id, parent_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(ownerUserId, rootFolderId, cleanName, n, n).run();
  return res.meta.last_row_id;
}

export async function getDecryptedTextContent(env: any, objectKey: string, contentType = '', filename = ''): Promise<string> {
  const filesBucket = env.FILES || env.STORAGE;
  if (!filesBucket) return '';
  try {
    const obj = await filesBucket.get(objectKey);
    if (!obj) return '';
    const buf = await obj.arrayBuffer();
    try {
      const dec = await decryptAttachment(env, buf, objectKey);
      return new TextDecoder('utf-8').decode(dec.bytes);
    } catch {
      return new TextDecoder('utf-8').decode(new Uint8Array(buf));
    }
  } catch {
    return '';
  }
}

export function buildLatestFileInfo(row: any, content?: string, origin = '') {
  if (!row) return null;
  const url = origin
    ? `${origin}/files/${encodeURIComponent(row.object_key)}`
    : `/files/${encodeURIComponent(row.object_key)}`;
  return {
    key: row.object_key,
    name: row.filename,
    filename: row.filename,
    size: Number(row.size || 0),
    type: row.content_type,
    folderId: row.folder_id,
    folderName: row.folder_name,
    project: row.folder_name && row.folder_name !== AGENT_SHARED_FOLDER_NAME ? row.folder_name : null,
    url,
    createdAt: row.created_at,
    created_at: row.created_at,
    ...(content !== undefined ? { content } : {}),
  };
}

export async function getProjectsLatestSummary(env: any, rootFolderId: number, origin = ''): Promise<{
  overallLatest: any;
  projects: Array<{
    project: string;
    folderId: number;
    hasFiles: boolean;
    latestFile: any;
    isOverallLatest: boolean;
    badge: string;
  }>;
}> {
  const db = env.DB;

  // 1. Get direct child project folders of the shared root folder
  const { results: childFolders } = await db.prepare(
    `SELECT id, name FROM storage_folders WHERE parent_id = ? AND trashed_at IS NULL AND deleted_at IS NULL ORDER BY name ASC`
  ).bind(rootFolderId).all();

  // 2. Find overall latest file across root and all descendant folders
  let allFolderIds = await getDescendantFolderIds(db, rootFolderId);
  if (!allFolderIds.includes(rootFolderId)) {
    allFolderIds.push(rootFolderId);
  }
  const rootPlaceholders = allFolderIds.map(() => '?').join(',');
  const overallRow = await db.prepare(`
    SELECT uf.object_key, uf.filename, uf.content_type, uf.size, uf.created_at, uf.folder_id, f.name as folder_name
    FROM uploaded_files uf
    LEFT JOIN storage_folders f ON f.id = uf.folder_id
    WHERE uf.folder_id IN (${rootPlaceholders})
      AND uf.trashed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM pending_r2_delete WHERE pending_r2_delete.object_key = uf.object_key)
    ORDER BY uf.created_at DESC
    LIMIT 1
  `).bind(...allFolderIds).first() as any;

  let overallContent = '';
  if (overallRow) {
    overallContent = await getDecryptedTextContent(env, overallRow.object_key, overallRow.content_type, overallRow.filename);
  }
  const overallLatest = overallRow ? buildLatestFileInfo(overallRow, overallContent, origin) : null;

  // 3. For each project child folder, query its latest file
  const projects: Array<{
    project: string;
    folderId: number;
    hasFiles: boolean;
    latestFile: any;
    isOverallLatest: boolean;
    badge: string;
  }> = [];

  for (const pf of (childFolders || [])) {
    let pfFolderIds = await getDescendantFolderIds(db, pf.id);
    if (!pfFolderIds.includes(pf.id)) {
      pfFolderIds.push(pf.id);
    }
    const pfPlaceholders = pfFolderIds.map(() => '?').join(',');
    const pfRow = await db.prepare(`
      SELECT uf.object_key, uf.filename, uf.content_type, uf.size, uf.created_at, uf.folder_id, f.name as folder_name
      FROM uploaded_files uf
      LEFT JOIN storage_folders f ON f.id = uf.folder_id
      WHERE uf.folder_id IN (${pfPlaceholders})
        AND uf.trashed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM pending_r2_delete WHERE pending_r2_delete.object_key = uf.object_key)
      ORDER BY uf.created_at DESC
      LIMIT 1
    `).bind(...pfFolderIds).first() as any;

    if (pfRow) {
      const isOverallLatest = Boolean(overallRow && pfRow.object_key === overallRow.object_key);
      let pfContent = '';
      if (isOverallLatest && overallContent) {
        pfContent = overallContent;
      } else {
        pfContent = await getDecryptedTextContent(env, pfRow.object_key, pfRow.content_type, pfRow.filename);
      }
      const latestFile = buildLatestFileInfo(pfRow, pfContent, origin);
      projects.push({
        project: pf.name,
        folderId: pf.id,
        hasFiles: true,
        latestFile,
        isOverallLatest,
        badge: isOverallLatest ? '👑 全局最新' : '项目最新',
      });
    } else {
      projects.push({
        project: pf.name,
        folderId: pf.id,
        hasFiles: false,
        latestFile: null,
        isOverallLatest: false,
        badge: '暂无报告',
      });
    }
  }

  return { overallLatest, projects };
}

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
      `SELECT owner_user_id, name, trashed_at FROM storage_folders WHERE id = ? LIMIT 1`
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
        `SELECT owner_user_id, name FROM storage_folders WHERE id = ? LIMIT 1`
      ).bind(fid).first() as any;
      if (!row || (row.owner_user_id !== session.userId && !session.isAdmin)) continue;
      if (row.name === AGENT_SHARED_FOLDER_NAME && (action === 'delete' || action === 'permanent-delete')) continue;

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
    const row = await requireOwner(c, 'folder', String(id));
    if (row.name === AGENT_SHARED_FOLDER_NAME) {
      return errorResponse('该共享免密目录为系统受保护根目录，不可重命名', 403);
    }
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
    if (row.name === AGENT_SHARED_FOLDER_NAME) {
      return errorResponse('该共享免密目录为系统受保护根目录，不可删除', 403);
    }
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
  // PUBLIC SHARES – anonymous collaborative folder endpoints
  // ═══════════════════════════════════════════════════════════════

  // Helper to retrieve files for a share
  async function queryShareFiles(env: any, share: any, project = '') {
    const targetFolderId = share.folder_id;
    let targetFolderIds: number[] = [];

    if (project) {
      const projFolder = await env.DB.prepare(
        `SELECT id FROM storage_folders WHERE parent_id = ? AND name = ? AND trashed_at IS NULL AND deleted_at IS NULL LIMIT 1`
      ).bind(targetFolderId, project).first() as any;
      if (projFolder?.id) {
        targetFolderIds = await getDescendantFolderIds(env.DB, projFolder.id);
      } else {
        return [];
      }
    } else {
      targetFolderIds = await getDescendantFolderIds(env.DB, targetFolderId);
    }

    if (targetFolderIds.length === 0) targetFolderIds = [targetFolderId];
    const placeholders = targetFolderIds.map(() => '?').join(',');
    const sql = `
      SELECT uf.object_key, uf.filename, uf.content_type, uf.size, uf.created_at, uf.folder_id, f.name as folder_name
      FROM uploaded_files uf
      LEFT JOIN storage_folders f ON f.id = uf.folder_id
      WHERE uf.folder_id IN (${placeholders})
        AND uf.trashed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM pending_r2_delete WHERE pending_r2_delete.object_key = uf.object_key)
      ORDER BY uf.created_at DESC
      LIMIT 500
    `;
    const { results } = await env.DB.prepare(sql).bind(...targetFolderIds).all();
    return (results || []).map((r: any) => ({
      key: r.object_key,
      name: r.filename,
      filename: r.filename,
      type: r.content_type,
      size: Number(r.size || 0),
      url: `/files/${encodeURIComponent(r.object_key)}`,
      folderId: r.folder_id,
      folderName: r.folder_name,
      project: r.folder_name && r.folder_name !== AGENT_SHARED_FOLDER_NAME ? r.folder_name : null,
      createdAt: r.created_at,
      created_at: r.created_at,
    }));
  }

  // 1. GET /api/storage/shares/:token/files
  app.get('/api/storage/shares/:token/files', async (c: any) => {
    const token = c.req.param('token');
    if (token === AGENT_SHARED_TOKEN) {
      await ensureAgentSharedFolder(c.env.DB);
    }
    const share = await c.env.DB.prepare(
      `SELECT id, folder_id, object_key, owner_user_id FROM storage_shares WHERE token = ? LIMIT 1`
    ).bind(token).first() as any;

    if (!share) {
      return errorResponse('分享链接不存在或已过期', 404);
    }

    if (share.object_key) {
      const file = await c.env.DB.prepare(
        `SELECT object_key, filename, content_type, size, created_at, folder_id FROM uploaded_files WHERE object_key = ? LIMIT 1`
      ).bind(share.object_key).first() as any;
      if (!file) return errorResponse('文件不存在', 404);
      return c.json({
        success: true,
        file: {
          key: file.object_key,
          name: file.filename,
          filename: file.filename,
          type: file.content_type,
          size: Number(file.size || 0),
          url: `/files/${encodeURIComponent(file.object_key)}`,
          folderId: file.folder_id,
          createdAt: file.created_at,
          created_at: file.created_at,
        }
      });
    }

    const folder = await c.env.DB.prepare(
      `SELECT id, name FROM storage_folders WHERE id = ? LIMIT 1`
    ).bind(share.folder_id).first() as any;

    const project = (c.req.query('project') || c.req.query('subfolder') || '').trim();
    const files = await queryShareFiles(c.env, share, project);

    return c.json({
      success: true,
      folder: { id: share.folder_id, name: folder?.name || '共享文件夹' },
      project: project || null,
      files,
      count: files.length,
    });
  });

  // 2. GET /api/storage/shares/:token/latest
  app.get('/api/storage/shares/:token/latest', async (c: any) => {
    const token = c.req.param('token');
    if (token === AGENT_SHARED_TOKEN) {
      await ensureAgentSharedFolder(c.env.DB);
    }
    const share = await c.env.DB.prepare(
      `SELECT id, folder_id, object_key, owner_user_id FROM storage_shares WHERE token = ? LIMIT 1`
    ).bind(token).first() as any;

    if (!share) {
      return errorResponse('分享链接不存在或已过期', 404);
    }

    const project = (c.req.query('project') || c.req.query('subfolder') || '').trim();
    const isRaw = c.req.query('raw') === '1' || c.req.query('raw') === 'true';

    // File share
    if (share.object_key) {
      const targetRow = await c.env.DB.prepare(
        `SELECT uf.object_key, uf.filename, uf.content_type, uf.size, uf.created_at, uf.folder_id, f.name as folder_name
         FROM uploaded_files uf
         LEFT JOIN storage_folders f ON f.id = uf.folder_id
         WHERE uf.object_key = ? LIMIT 1`
      ).bind(share.object_key).first() as any;

      if (!targetRow) return c.json({ success: true, file: null, message: '文件不存在' });
      const textContent = await getDecryptedTextContent(c.env, targetRow.object_key, targetRow.content_type, targetRow.filename);

      if (isRaw) {
        return new Response(textContent, {
          headers: {
            'Content-Type': targetRow.content_type || 'text/plain; charset=utf-8',
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(targetRow.filename)}`,
            'Cache-Control': 'no-cache',
          }
        });
      }

      return c.json({
        success: true,
        file: buildLatestFileInfo(targetRow, textContent),
      });
    }

    // Folder share
    if (share.folder_id) {
      if (project) {
        const projFolder = await c.env.DB.prepare(
          `SELECT id FROM storage_folders WHERE parent_id = ? AND name = ? AND trashed_at IS NULL AND deleted_at IS NULL LIMIT 1`
        ).bind(share.folder_id, project).first() as any;

        if (!projFolder?.id) {
          return c.json({ success: true, file: null, message: `项目 ${project} 尚无文件` });
        }

        let targetFolderIds = await getDescendantFolderIds(c.env.DB, projFolder.id);
        if (!targetFolderIds.includes(projFolder.id)) targetFolderIds.push(projFolder.id);
        const placeholders = targetFolderIds.map(() => '?').join(',');
        const sql = `
          SELECT uf.object_key, uf.filename, uf.content_type, uf.size, uf.created_at, uf.folder_id, f.name as folder_name
          FROM uploaded_files uf
          LEFT JOIN storage_folders f ON f.id = uf.folder_id
          WHERE uf.folder_id IN (${placeholders})
            AND uf.trashed_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM pending_r2_delete WHERE pending_r2_delete.object_key = uf.object_key)
          ORDER BY uf.created_at DESC
          LIMIT 1
        `;
        const targetRow = await c.env.DB.prepare(sql).bind(...targetFolderIds).first() as any;
        if (!targetRow) {
          return c.json({ success: true, file: null, message: `项目 ${project} 尚无文件` });
        }

        const textContent = await getDecryptedTextContent(c.env, targetRow.object_key, targetRow.content_type, targetRow.filename);

        if (isRaw) {
          return new Response(textContent, {
            headers: {
              'Content-Type': targetRow.content_type || 'text/plain; charset=utf-8',
              'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(targetRow.filename)}`,
              'Cache-Control': 'no-cache',
            }
          });
        }

        return c.json({
          success: true,
          file: buildLatestFileInfo(targetRow, textContent),
        });
      }

      // No project specified -> Multi-project aggregation
      const summary = await getProjectsLatestSummary(c.env, share.folder_id);

      if (isRaw) {
        if (!summary.overallLatest) {
          return new Response('文件夹为空，暂无文件', {
            status: 404,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
        return new Response(summary.overallLatest.content || '', {
          headers: {
            'Content-Type': summary.overallLatest.type || 'text/plain; charset=utf-8',
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(summary.overallLatest.filename)}`,
            'Cache-Control': 'no-cache',
          }
        });
      }

      return c.json({
        success: true,
        overallLatest: summary.overallLatest,
        file: summary.overallLatest, // for backwards compatibility with raw readers
        projects: summary.projects,
        ...(summary.overallLatest ? {} : { message: '文件夹为空，暂无文件' }),
      });
    }

    return errorResponse('无效的分享类型', 400);
  });

  // 3. POST /api/storage/shares/:token/files
  app.post('/api/storage/shares/:token/files', async (c: any) => {
    if (!c.env.FILES) return errorResponse('当前部署没有绑定 R2，无法上传文件', 503);
    const token = c.req.param('token');
    if (token === AGENT_SHARED_TOKEN) {
      await ensureAgentSharedFolder(c.env.DB);
    }
    const share = await c.env.DB.prepare(
      `SELECT id, folder_id, owner_user_id FROM storage_shares WHERE token = ? LIMIT 1`
    ).bind(token).first() as any;

    if (!share || !share.folder_id) {
      return errorResponse('无效的共享目录链接', 404);
    }

    const contentTypeHeader = c.req.header('content-type') || '';
    let rawFilename = '';
    let fileBuffer: ArrayBuffer;
    let mime = '';
    let projectName = (c.req.query('project') || c.req.query('subfolder') || '').trim();

    if (contentTypeHeader.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      const file = formData.get('file');
      if (!(file instanceof File)) return errorResponse('请选择有效文件');
      rawFilename = file.name;
      fileBuffer = await file.arrayBuffer();
      mime = file.type || getMimeTypeFromFilename(rawFilename);
      const formProject = formData.get('project') || formData.get('subfolder');
      if (formProject && !projectName) projectName = String(formProject).trim();
    } else {
      const body = await c.req.json().catch(() => ({}));
      rawFilename = body.filename || body.fileName || body.name || 'report.md';
      const rawContent = body.content ?? body.contentBase64;
      if (rawContent === undefined || rawContent === null) return errorResponse('文件内容不能为空');
      const isBase64 = body.isBase64 || Boolean(body.contentBase64);
      if (isBase64) {
        const bin = atob(String(rawContent));
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        fileBuffer = u8.buffer;
      } else {
        fileBuffer = new TextEncoder().encode(String(rawContent)).buffer;
      }
      mime = body.contentType || body.content_type || getMimeTypeFromFilename(rawFilename);
      if (body.project && !projectName) projectName = String(body.project).trim();
    }

    // Determine target folder (root shared folder or project subfolder)
    let targetFolderId = share.folder_id;
    if (projectName) {
      targetFolderId = await ensureProjectFolder(c.env.DB, share.folder_id, projectName, Number(share.owner_user_id) || 1);
    }

    // Apply auto timestamp naming: YYYYMMDD_HHmmss_${name}
    const finalFilename = applyAutoTimestamp(rawFilename);

    const ext = finalFilename.includes('.') ? finalFilename.slice(finalFilename.lastIndexOf('.')) : '';
    const ownerUserId = Number(share.owner_user_id) || 1;
    const key = `${ownerUserId}/${Date.now()}-${nanoid(10)}${ext}`;

    // Encrypt and store to R2
    let toStore: ArrayBuffer;
    try {
      toStore = await encryptAttachment(c.env, fileBuffer, key);
    } catch {
      toStore = fileBuffer;
    }

    await c.env.FILES.put(key, toStore, {
      httpMetadata: { contentType: mime, cacheControl: 'private, no-store' },
      customMetadata: { filename: finalFilename, edgechatEncryption: 'v1' },
    });

    const n = now();
    await c.env.DB.prepare(
      `INSERT INTO uploaded_files (object_key, owner_user_id, filename, content_type, size, folder_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(object_key) DO UPDATE SET filename = excluded.filename, size = excluded.size, folder_id = excluded.folder_id, updated_at = excluded.updated_at`
    ).bind(key, ownerUserId, finalFilename, mime, fileBuffer.byteLength, targetFolderId, n, n).run();

    return c.json({
      success: true,
      file: {
        key,
        name: finalFilename,
        filename: finalFilename,
        size: fileBuffer.byteLength,
        type: mime,
        folderId: targetFolderId,
        project: projectName || null,
        url: `/files/${encodeURIComponent(key)}`,
        createdAt: n,
        created_at: n,
      }
    }, 201);
  });

  // ═══════════════════════════════════════════════════════════════
  // HANDOFF – Dedicated Task Handoff Channel (极简动词型)
  // ═══════════════════════════════════════════════════════════════
  async function handleHandoffSave(c: any) {
    if (!c.env.FILES) return errorResponse('当前部署没有绑定 R2，无法上传文件', 503);

    // Ensure agent-shared folder exists
    const shared = await ensureAgentSharedFolder(c.env.DB);
    const share = await c.env.DB.prepare(
      `SELECT id, folder_id, owner_user_id FROM storage_shares WHERE token = ? LIMIT 1`
    ).bind(AGENT_SHARED_TOKEN).first() as any;

    if (!share || !share.folder_id) {
      return errorResponse('未初始化任务交接共享目录', 500);
    }

    const contentTypeHeader = c.req.header('content-type') || '';
    let rawFilename = '';
    let fileBuffer: ArrayBuffer;
    let mime = '';
    let projectName = (c.req.query('project') || c.req.query('subfolder') || '').trim();
    let autoTimestampParam = c.req.query('autoTimestamp');
    let autoTimestamp = autoTimestampParam !== 'false' && autoTimestampParam !== '0';

    if (contentTypeHeader.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      const file = formData.get('file');
      if (!(file instanceof File)) return errorResponse('请选择有效文件');
      rawFilename = file.name;
      fileBuffer = await file.arrayBuffer();
      mime = file.type || getMimeTypeFromFilename(rawFilename);
      const formProject = formData.get('project') || formData.get('subfolder');
      if (formProject && !projectName) projectName = String(formProject).trim();
      const formAutoTs = formData.get('autoTimestamp');
      if (formAutoTs === 'false' || formAutoTs === '0') {
        autoTimestamp = false;
      }
    } else {
      const body = await c.req.json().catch(() => ({}));
      rawFilename = body.filename || body.fileName || body.name || 'test_report.md';
      const rawContent = body.content ?? body.contentBase64;
      if (rawContent === undefined || rawContent === null) return errorResponse('文件内容不能为空');
      const isBase64 = body.isBase64 || Boolean(body.contentBase64);
      if (isBase64) {
        const bin = atob(String(rawContent));
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        fileBuffer = u8.buffer;
      } else {
        fileBuffer = new TextEncoder().encode(String(rawContent)).buffer;
      }
      mime = body.contentType || body.content_type || getMimeTypeFromFilename(rawFilename);
      if (body.project && !projectName) projectName = String(body.project).trim();
      if (body.autoTimestamp === false) {
        autoTimestamp = false;
      }
    }

    // Default project to 'EdgeChat' if not provided
    if (!projectName) {
      projectName = 'EdgeChat';
    }

    const targetFolderId = await ensureProjectFolder(c.env.DB, share.folder_id, projectName, Number(share.owner_user_id) || 1);
    const finalFilename = autoTimestamp ? applyAutoTimestamp(rawFilename) : rawFilename;

    const ext = finalFilename.includes('.') ? finalFilename.slice(finalFilename.lastIndexOf('.')) : '';
    const ownerUserId = Number(share.owner_user_id) || 1;
    const key = `${ownerUserId}/${Date.now()}-${nanoid(10)}${ext}`;

    let toStore: ArrayBuffer;
    try {
      toStore = await encryptAttachment(c.env, fileBuffer, key);
    } catch {
      toStore = fileBuffer;
    }

    await c.env.FILES.put(key, toStore, {
      httpMetadata: { contentType: mime, cacheControl: 'private, no-store' },
      customMetadata: { filename: finalFilename, edgechatEncryption: 'v1' },
    });

    const n = now();
    await c.env.DB.prepare(
      `INSERT INTO uploaded_files (object_key, owner_user_id, filename, content_type, size, folder_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(object_key) DO UPDATE SET filename = excluded.filename, size = excluded.size, folder_id = excluded.folder_id, updated_at = excluded.updated_at`
    ).bind(key, ownerUserId, finalFilename, mime, fileBuffer.byteLength, targetFolderId, n, n).run();

    const origin = new URL(c.req.url).origin;
    const url = `${origin}/files/${encodeURIComponent(key)}`;

    return c.json({
      success: true,
      file: {
        key,
        filename: finalFilename,
        name: finalFilename,
        size: fileBuffer.byteLength,
        type: mime,
        project: projectName,
        folderId: targetFolderId,
        url,
        createdAt: n,
        created_at: n,
      }
    }, 201);
  }

  async function handleHandoffLatest(c: any) {
    await ensureAgentSharedFolder(c.env.DB);
    const share = await c.env.DB.prepare(
      `SELECT id, folder_id FROM storage_shares WHERE token = ? LIMIT 1`
    ).bind(AGENT_SHARED_TOKEN).first() as any;

    if (!share || !share.folder_id) {
      return errorResponse('未初始化任务交接共享目录', 500);
    }

    const project = (c.req.query('project') || c.req.query('subfolder') || '').trim();
    const isRaw = c.req.query('raw') === '1' || c.req.query('raw') === 'true';
    const origin = new URL(c.req.url).origin;

    const summary = await getProjectsLatestSummary(c.env, share.folder_id, origin);

    let targetFile = summary.overallLatest;
    if (project) {
      const proj = summary.projects.find(p => p.project.toLowerCase() === project.toLowerCase());
      targetFile = proj?.latestFile || null;
    }

    if (isRaw) {
      if (!targetFile || !targetFile.content) {
        return new Response(project ? `项目 ${project} 暂无文件` : '暂无最新文件', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      return new Response(targetFile.content, {
        headers: {
          'Content-Type': targetFile.type || 'text/plain; charset=utf-8',
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(targetFile.filename)}`,
          'Cache-Control': 'no-cache',
        }
      });
    }

    return c.json({
      success: true,
      overallLatest: summary.overallLatest,
      file: targetFile,
      projects: summary.projects,
      ...(project && !targetFile ? { message: `项目 ${project} 暂无文件` } : {}),
    });
  }

  app.post('/api/handoff/save', handleHandoffSave);
  app.post('/api/handoff/new', handleHandoffSave);
  app.get('/api/handoff/latest', handleHandoffLatest);
  app.get('/api/handoff/new', handleHandoffLatest);

  // 4. GET /api/storage/share-view/:token (HTML view & JSON view)
  app.get('/api/storage/share-view/:token', async (c: any) => {
    const token = c.req.param('token');
    if (token === AGENT_SHARED_TOKEN) {
      await ensureAgentSharedFolder(c.env.DB);
    }
    const share = await c.env.DB.prepare(
      `SELECT object_key, folder_id FROM storage_shares WHERE token = ? LIMIT 1`
    ).bind(token).first() as any;

    if (!share) {
      return c.html(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px">
        <h2>链接无效或已过期</h2><p>该分享链接不存在或已被删除。</p></body></html>`, 404);
    }

    const wantsJson = c.req.query('format') === 'json' || (c.req.header('accept') || '').includes('application/json');

    // File share
    if (share.object_key) {
      const row = await c.env.DB.prepare(
        `SELECT object_key, filename, content_type, size, created_at FROM uploaded_files WHERE object_key = ? LIMIT 1`
      ).bind(share.object_key).first() as any;
      if (!row || !c.env.FILES) {
        return wantsJson ? errorResponse('文件不存在', 404) : c.html(`<html><body>文件不存在</body></html>`, 404);
      }
      if (wantsJson) {
        return c.json({
          success: true,
          file: {
            key: row.object_key,
            filename: row.filename,
            name: row.filename,
            type: row.content_type,
            size: Number(row.size || 0),
            url: `/files/${encodeURIComponent(row.object_key)}`,
            createdAt: row.created_at,
            created_at: row.created_at,
          }
        });
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

    // Folder share
    if (share.folder_id) {
      const folder = await c.env.DB.prepare(
        `SELECT name FROM storage_folders WHERE id = ? LIMIT 1`
      ).bind(share.folder_id).first() as any;

      const project = (c.req.query('project') || c.req.query('subfolder') || '').trim();
      const files = await queryShareFiles(c.env, share, project);
      const summary = await getProjectsLatestSummary(c.env, share.folder_id);

      if (wantsJson) {
        return c.json({
          success: true,
          folder: { id: share.folder_id, name: folder?.name || '共享文件夹' },
          project: project || null,
          files,
          count: files.length,
          overallLatest: summary.overallLatest,
          projects: summary.projects,
        });
      }

      let boardHtml = '';
      if (summary.projects && summary.projects.length > 0) {
        const cards = summary.projects.map((p: any) => {
          const isOverall = p.isOverallLatest;
          const hasFiles = p.hasFiles && p.latestFile;
          const cardClass = isOverall ? 'project-card card-overall' : (hasFiles ? 'project-card' : 'project-card card-empty');

          let badgeHtml = '';
          if (isOverall) {
            badgeHtml = `<span class="badge badge-overall">👑 全局最新</span>`;
          } else if (hasFiles) {
            badgeHtml = `<span class="badge badge-latest">📁 项目最新</span>`;
          } else {
            badgeHtml = `<span class="badge badge-empty">⚪ 暂无文件</span>`;
          }

          let fileDetail = '';
          if (hasFiles) {
            const f = p.latestFile;
            const size = Number(f.size || 0);
            const kb = size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${(size / 1024).toFixed(1)} KB`;
            const timeStr = f.createdAt ? new Date(f.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—';
            fileDetail = `
              <div class="card-file-box">
                <a href="${f.url}" target="_blank" class="card-file-link" title="${f.filename}">📄 ${f.filename}</a>
                <div class="card-file-info">
                  <span>📦 ${kb}</span>
                  <span>🕒 ${timeStr}</span>
                </div>
              </div>
              <div class="card-footer">
                <a href="?project=${encodeURIComponent(p.project)}" class="filter-action-link">🔍 筛选此项目文件 &rarr;</a>
              </div>
            `;
          } else {
            fileDetail = `
              <div class="card-file-box empty-box">暂无产物报告</div>
              <div class="card-footer">
                <a href="?project=${encodeURIComponent(p.project)}" class="filter-action-link text-muted">查看该项目 &rarr;</a>
              </div>
            `;
          }

          return `
            <div class="${cardClass}">
              <div class="card-header">
                <div class="project-title" title="${p.project}">
                  <span class="project-icon">📁</span>
                  <strong>${p.project}</strong>
                </div>
                ${badgeHtml}
              </div>
              ${fileDetail}
            </div>
          `;
        }).join('');

        boardHtml = `
          <div class="board-section">
            <div class="board-top">
              <div class="board-heading">📊 各项目最新产物看板</div>
              <div class="board-sub">共 ${summary.projects.length} 个协同项目 • 自动跟踪全局与各项目最新发布</div>
            </div>
            <div class="board-grid">
              ${cards}
            </div>
          </div>
        `;
      }

      let filterBreadcrumbHtml = '';
      if (project) {
        filterBreadcrumbHtml = `
          <div class="filter-breadcrumb-bar">
            <div class="filter-text">
              <span>当前筛选项目:</span>
              <strong class="filter-badge">📁 ${project}</strong>
              <span class="filter-count">(${files.length} 个文件)</span>
            </div>
            <a href="?" class="reset-btn">✕ 查看全部项目</a>
          </div>
        `;
      }

      const rows = files.map((f: any) => {
        const fileShareUrl = `/files/${encodeURIComponent(f.key)}`;
        const size = Number(f.size || 0);
        const kb = size > 1024 * 1024 ? `${(size/1024/1024).toFixed(1)} MB` : `${(size/1024).toFixed(1)} KB`;
        const projectBadge = f.project
          ? `<a href="?project=${encodeURIComponent(f.project)}" style="text-decoration:none"><span style="background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;display:inline-block">${f.project}</span></a>`
          : `<span style="color:#94a3b8;font-size:12px">根目录</span>`;
        return `<tr>
          <td style="padding:10px 12px"><a href="${fileShareUrl}" target="_blank" style="color:#2563eb;text-decoration:none;font-weight:500">${f.filename}</a></td>
          <td style="padding:10px 12px">${projectBadge}</td>
          <td style="padding:10px 12px;color:#64748b;font-size:13px">${f.type}</td>
          <td style="padding:10px 12px;color:#64748b;font-size:13px">${kb}</td>
          <td style="padding:10px 12px;color:#64748b;font-size:13px">${f.createdAt ? new Date(f.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—'}</td>
        </tr>`;
      }).join('');

      const folderDisplayName = folder?.name || '共享文件夹';

      return c.html(`<!DOCTYPE html><html><head><meta charset="utf-8">
        <title>共享文件夹: ${folderDisplayName}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:32px 20px;max-width:1040px;margin:0 auto;color:#1e293b;background:#f8fafc}
          .card{background:#ffffff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);border:1px solid #e2e8f0;padding:24px;margin-bottom:24px}
          h1{font-size:1.4rem;margin:0 0 6px 0;display:flex;align-items:center;gap:8px}
          p.subtitle{color:#64748b;margin:0 0 20px 0;font-size:0.9rem}
          .banner{background:linear-gradient(135deg,#eff6ff,#e0e7ff);border:1px solid #c7d2fe;border-radius:10px;padding:16px 20px;margin-bottom:20px}
          .banner-title{font-size:0.95rem;font-weight:700;color:#3730a3;display:flex;align-items:center;gap:6px}
          .banner-desc{color:#4338ca;font-size:0.85rem;margin-top:6px;line-height:1.6}
          .banner code{background:#ffffff;border:1px solid #c7d2fe;padding:2px 6px;border-radius:4px;font-size:0.8rem;color:#1e1b4b}

          .board-section{margin-bottom:24px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.03)}
          .board-top{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #f1f5f9}
          .board-heading{font-size:1.05rem;font-weight:700;color:#1e293b;display:flex;align-items:center;gap:8px}
          .board-sub{font-size:0.82rem;color:#64748b}
          .board-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}
          .project-card{background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:16px;display:flex;flex-direction:column;justify-content:space-between;min-height:130px;transition:transform .15s ease,box-shadow .15s ease}
          .project-card:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,0.06);border-color:#cbd5e1}
          .card-overall{background:linear-gradient(135deg,#fffdf5 0%,#ffffff 100%);border:1.5px solid #f59e0b;box-shadow:0 2px 10px rgba(245,158,11,0.15)}
          .card-overall:hover{box-shadow:0 6px 20px rgba(245,158,11,0.25);border-color:#d97706}
          .card-empty{background:#f8fafc;border:1px dashed #cbd5e1}
          .card-header{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:12px}
          .project-title{display:flex;align-items:center;gap:6px;font-size:0.95rem;color:#0f172a;word-break:break-all}
          .badge{padding:3px 8px;border-radius:9999px;font-size:11px;font-weight:700;white-space:nowrap;display:inline-flex;align-items:center}
          .badge-overall{background:linear-gradient(135deg,#fef3c7,#fde68a);color:#92400e;border:1px solid #f59e0b;box-shadow:0 0 10px rgba(245,158,11,0.35);animation:pulse 2s infinite ease-in-out}
          @keyframes pulse{0%,100%{box-shadow:0 0 6px rgba(245,158,11,0.3)}50%{box-shadow:0 0 12px rgba(245,158,11,0.6)}}
          .badge-latest{background:#e0e7ff;color:#3730a3}
          .badge-empty{background:#f1f5f9;color:#64748b}
          .card-file-box{margin-bottom:12px}
          .card-file-link{color:#2563eb;font-weight:600;font-size:0.88rem;text-decoration:none;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.4;margin-bottom:6px}
          .card-file-link:hover{text-decoration:underline;color:#1d4ed8}
          .card-file-info{display:flex;gap:12px;color:#64748b;font-size:0.78rem}
          .empty-box{color:#94a3b8;font-size:0.85rem;padding:8px 0}
          .card-footer{border-top:1px solid #f1f5f9;padding-top:10px;margin-top:auto}
          .filter-action-link{font-size:0.8rem;color:#2563eb;text-decoration:none;font-weight:600;display:inline-flex;align-items:center;gap:4px}
          .filter-action-link:hover{text-decoration:underline}
          .text-muted{color:#94a3b8;font-weight:400}
          .filter-breadcrumb-bar{display:flex;justify-content:space-between;align-items:center;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 16px;margin-bottom:16px}
          .filter-text{display:flex;align-items:center;gap:8px;font-size:0.9rem;color:#1e3a8a}
          .filter-badge{color:#1d4ed8;font-weight:700}
          .filter-count{color:#64748b;font-size:0.85rem}
          .reset-btn{background:#2563eb;color:#ffffff;font-size:0.8rem;font-weight:600;padding:4px 12px;border-radius:6px;text-decoration:none;transition:background .15s ease}
          .reset-btn:hover{background:#1d4ed8}

          table{width:100%;border-collapse:collapse}
          th{text-align:left;padding:10px 12px;border-bottom:2px solid #e2e8f0;font-size:.82rem;text-transform:uppercase;color:#64748b;font-weight:600}
          tr:hover{background:#f1f5f9}
          tr{border-bottom:1px solid #f1f5f9}
        </style>
        </head><body>
        <div class="card">
          <h1>📂 ${folderDisplayName}</h1>
          <p class="subtitle">共 ${files.length} 个文件 • 默认按上传时间倒序排列</p>
          <div class="banner">
            <div class="banner-title">🔒 免密协作共享目录（只读 / 直传端点）</div>
            <div class="banner-desc">
              ⚡ WorkBuddy & Antigravity 自动化协同流水线已激活<br>
              • 文件名自动格式化为 <code>YYYYMMDD_HHmmss</code> 倒序排列<br>
              • 支持通过 <code>POST /api/storage/shares/${token}/files</code> 匿名直传报告<br>
              • 支持通过 <code>GET /api/storage/shares/${token}/latest</code> 免密拉取最新报告
            </div>
          </div>
          ${boardHtml}
          ${filterBreadcrumbHtml}
          <table>
            <thead><tr><th>文件名</th><th>所属项目</th><th>类型</th><th>大小</th><th>上传时间 (最新居首)</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5" style="padding:28px;text-align:center;color:#94a3b8">文件夹为空</td></tr>'}</tbody>
          </table>
        </div>
        </body></html>`);
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
