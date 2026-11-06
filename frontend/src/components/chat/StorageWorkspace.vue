<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
  ArrowDownUp, Check, ChevronRight, Copy, Download, Eye, File, FileCode,
  FilePlus2, FileSpreadsheet, FileText, Film, Folder, FolderArchive,
  FolderOpen, FolderPlus, Home, Image as ImageIcon, Link2, Music, PencilLine,
  Plus, RefreshCw, RotateCcw, Search, Share2, SortAsc, SortDesc, Trash2,
  UploadCloud, X
} from '@lucide/vue';
import api from '../../api.js';
import ScreenCaptureButton from '../common/ScreenCaptureButton.vue';

// ─── state ────────────────────────────────────────────────────────────────
const files = ref([]);
const folders = ref([]);
const loading = ref(false);
const uploading = ref(false);
const uploadProgressText = ref('');
const error = ref('');
const successMessage = ref('');
const searchQuery = ref('');
const activeCategory = ref('all');
const fileInputRef = ref(null);
const isDragOver = ref(false);

// View: 'files' | 'trash'
const activeView = ref('files');

// Current folder navigation
const currentFolderId = ref(null); // null = root
const breadcrumb = ref([]); // [{id, name}]

// Sort
const sortField = ref('created_at');
const sortOrder = ref('desc');

// Selection
const selectedKeys = ref(new Set()); // file keys
const selectedFolderIds = ref(new Set()); // folder ids

// Rename inline
const renamingKey = ref(null); // file key or null
const renamingFolderId = ref(null);
const renameValue = ref('');

// Editor panel
const editorFile = ref(null);
const editorContent = ref('');
const editorSaving = ref(false);
const editorDirty = ref(false);
let editorSaveTimer = null;

// Preview modal
const previewModal = ref({ open: false, file: null });

// Share modal
const shareModal = ref({ open: false, item: null, url: '', loading: false });

// Move modal
const moveModal = ref({ open: false, keys: [], folderIds: [] });
const moveTargetId = ref(null);
const allFolders = ref([]);

// Copied links set
const copiedKeys = ref(new Set());

// categories
const categories = [
  { id: 'all', label: '全部' },
  { id: 'document', label: '文档' },
  { id: 'image', label: '图片' },
  { id: 'media', label: '音视频' },
  { id: 'archive', label: '压缩包' },
  { id: 'other', label: '其它' },
];

// ─── helpers ──────────────────────────────────────────────────────────────
function getCategory(file) {
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/.test(name)) return 'image';
  if (type.startsWith('video/') || type.startsWith('audio/') || /\.(mp4|webm|mov|mp3|wav|ogg|m4a)$/.test(name)) return 'media';
  if (type === 'application/pdf' || /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|rtf|epub)$/.test(name)) return 'document';
  if (/\.(zip|tar|gz|7z|rar|bz2|xz)$/.test(name) || type.includes('zip') || type.includes('compressed')) return 'archive';
  return 'other';
}

function getFileIcon(file) {
  const cat = getCategory(file);
  const name = (file.name || '').toLowerCase();
  if (cat === 'image') return ImageIcon;
  if (cat === 'media') return /\.(mp4|webm|mov)$/.test(name) ? Film : Music;
  if (/\.(xlsx?|csv)$/.test(name)) return FileSpreadsheet;
  if (/\.(json|js|ts|py|html|css|vue|sql|sh)$/.test(name)) return FileCode;
  if (cat === 'document') return FileText;
  if (cat === 'archive') return FolderArchive;
  return File;
}

function isEditable(file) {
  const name = (file.name || '').toLowerCase();
  return /\.(txt|md|json|js|ts|py|html|css|vue|sql|sh|yaml|yml|toml|ini|conf|log|csv)$/.test(name);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

// ─── computed ─────────────────────────────────────────────────────────────
const sortedFolders = computed(() => {
  if (activeView.value === 'trash') {
    return folders.value.filter(f => f.trashedAt);
  }
  return [...folders.value].filter(f => !f.trashedAt).sort((a, b) => {
    if (sortOrder.value === 'asc') return a.name.localeCompare(b.name);
    return b.name.localeCompare(a.name);
  });
});

const filteredFiles = computed(() => {
  let list = files.value;
  if (activeView.value === 'trash') {
    list = list.filter(f => f.trashedAt);
  } else {
    list = list.filter(f => !f.trashedAt);
  }
  if (activeCategory.value !== 'all') {
    list = list.filter(f => getCategory(f) === activeCategory.value);
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase();
    list = list.filter(f => (f.name || '').toLowerCase().includes(q));
  }
  return list;
});

const totalSize = computed(() => files.value.filter(f => !f.trashedAt).reduce((acc, cur) => acc + (cur.size || 0), 0));

const hasSelection = computed(() => selectedKeys.value.size > 0 || selectedFolderIds.value.size > 0);

const allSelected = computed(() => {
  const files = filteredFiles.value;
  const flds = sortedFolders.value;
  if (files.length + flds.length === 0) return false;
  return files.every(f => selectedKeys.value.has(f.key)) && flds.every(f => selectedFolderIds.value.has(f.id));
});

// ─── data loading ─────────────────────────────────────────────────────────
async function loadAll() {
  loading.value = true;
  error.value = '';
  selectedKeys.value.clear();
  selectedFolderIds.value.clear();
  try {
    const trash = activeView.value === 'trash' ? '1' : '0';
    const folderId = activeView.value === 'trash' ? undefined : (currentFolderId.value ?? 'root');
    const sort = sortField.value;
    const order = sortOrder.value;

    const [filesRes, foldersRes] = await Promise.all([
      apiGet(`/api/storage/files?trash=${trash}${folderId !== undefined ? `&folder_id=${folderId === 'root' ? '' : folderId}` : ''}&sort=${sort}&order=${order}`),
      activeView.value !== 'trash'
        ? apiGet(`/api/storage/folders?${folderId !== undefined ? `parent_id=${folderId === 'root' ? '' : folderId}` : ''}`)
        : apiGet(`/api/storage/folders?trash=1`),
    ]);
    files.value = filesRes.files || [];
    folders.value = foldersRes.folders || [];
  } catch (err) {
    error.value = err.message || '获取列表失败';
  } finally {
    loading.value = false;
  }
}

async function apiGet(path) {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

async function apiPatch(path, body) {
  const res = await fetch(path, {
    method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(path, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

// ─── navigation ───────────────────────────────────────────────────────────
async function openFolder(folder) {
  breadcrumb.value.push({ id: folder.id, name: folder.name });
  currentFolderId.value = folder.id;
  await loadAll();
}

async function navigateTo(idx) {
  if (idx < 0) {
    // root
    breadcrumb.value = [];
    currentFolderId.value = null;
  } else {
    breadcrumb.value = breadcrumb.value.slice(0, idx + 1);
    currentFolderId.value = breadcrumb.value[idx].id;
  }
  await loadAll();
}

function switchView(v) {
  activeView.value = v;
  breadcrumb.value = [];
  currentFolderId.value = null;
  loadAll();
}

// ─── upload ───────────────────────────────────────────────────────────────
function triggerUpload() { fileInputRef.value?.click(); }

async function handleFileSelect(event) {
  const selected = event.target.files;
  if (!selected || selected.length === 0) return;
  await uploadFiles(Array.from(selected));
  event.target.value = '';
}

async function uploadFiles(fileList) {
  if (!fileList.length) return;
  uploading.value = true;
  error.value = '';
  successMessage.value = '';
  let successCount = 0;
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    uploadProgressText.value = `上传 (${i + 1}/${fileList.length}): ${file.name}...`;
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (currentFolderId.value) fd.append('folder_id', String(currentFolderId.value));
      const res = await fetch('/api/storage/files', { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      successCount++;
    } catch (err) {
      error.value = `上传 ${file.name} 失败: ${err.message}`;
    }
  }
  uploading.value = false;
  uploadProgressText.value = '';
  if (successCount > 0) {
    toast(`成功上传 ${successCount} 个文件`, 'success');
    await loadAll();
  }
}

function handleDragOver(e) { e.preventDefault(); isDragOver.value = true; }
function handleDragLeave(e) { e.preventDefault(); isDragOver.value = false; }
async function handleDrop(e) {
  e.preventDefault();
  isDragOver.value = false;
  const dropped = e.dataTransfer?.files;
  if (dropped && dropped.length > 0) await uploadFiles(Array.from(dropped));
}

// ─── folder CRUD ──────────────────────────────────────────────────────────
async function createFolder() {
  const name = prompt('请输入文件夹名称');
  if (!name || !name.trim()) return;
  try {
    await apiPost('/api/storage/folders', { name: name.trim(), parent_id: currentFolderId.value ?? null });
    await loadAll();
    toast('文件夹已创建', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function startRenameFolder(folder) {
  renamingFolderId.value = folder.id;
  renameValue.value = folder.name;
  nextTick(() => document.querySelector('.rename-input')?.focus());
}

async function commitRenameFolder(folder) {
  if (folder.name === 'agent-共享免密目录') {
    toast('该共享免密目录为系统受保护根目录，不可重命名', 'error');
    renamingFolderId.value = null;
    return;
  }
  if (!renameValue.value.trim() || renameValue.value === folder.name) {
    renamingFolderId.value = null;
    return;
  }
  try {
    await apiPatch(`/api/storage/folders/${folder.id}`, { name: renameValue.value.trim() });
    folder.name = renameValue.value.trim();
    toast('已重命名', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
  renamingFolderId.value = null;
}

async function trashFolder(folder) {
  if (folder.name === 'agent-共享免密目录') {
    toast('该共享免密目录为系统受保护根目录，不可删除', 'error');
    return;
  }
  if (!confirm(`将文件夹 "${folder.name}" 及其文件移入回收站?`)) return;
  try {
    await apiDelete(`/api/storage/folders/${folder.id}`);
    await loadAll();
    toast('已移入回收站', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function restoreFolder(folder) {
  try {
    await fetch(`/api/storage/folders/${folder.id}/restore`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    await loadAll();
    toast('已还原', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─── file rename ──────────────────────────────────────────────────────────
function startRenameFile(file) {
  renamingKey.value = file.key;
  renameValue.value = file.name;
  nextTick(() => document.querySelector('.rename-input')?.focus());
}

async function commitRenameFile(file) {
  if (!renameValue.value.trim() || renameValue.value === file.name) {
    renamingKey.value = null;
    return;
  }
  try {
    await apiPatch(`/api/storage/files/${encodeURIComponent(file.key)}`, { filename: renameValue.value.trim() });
    file.name = renameValue.value.trim();
    toast('已重命名', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
  renamingKey.value = null;
}

// ─── file delete / trash ─────────────────────────────────────────────────
async function trashFile(file) {
  if (!confirm(`将 "${file.name}" 移入回收站?`)) return;
  try {
    await apiDelete(`/api/storage/files/${encodeURIComponent(file.key)}`);
    await loadAll();
    toast('已移入回收站', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function permanentDeleteFile(file) {
  if (!confirm(`永久删除 "${file.name}"？此操作无法撤销！`)) return;
  try {
    await apiDelete(`/api/storage/files/${encodeURIComponent(file.key)}?permanent=1`);
    await loadAll();
    toast('已永久删除', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function restoreFile(file) {
  try {
    await apiPost('/api/storage/files/batch', { action: 'restore', keys: [file.key] });
    await loadAll();
    toast('已还原', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─── batch operations ─────────────────────────────────────────────────────
function toggleSelectAll() {
  if (allSelected.value) {
    selectedKeys.value.clear();
    selectedFolderIds.value.clear();
  } else {
    filteredFiles.value.forEach(f => selectedKeys.value.add(f.key));
    sortedFolders.value.forEach(f => selectedFolderIds.value.add(f.id));
  }
  // trigger reactivity
  selectedKeys.value = new Set(selectedKeys.value);
  selectedFolderIds.value = new Set(selectedFolderIds.value);
}

function toggleSelectFile(file) {
  const s = new Set(selectedKeys.value);
  if (s.has(file.key)) s.delete(file.key); else s.add(file.key);
  selectedKeys.value = s;
}

function toggleSelectFolder(folder) {
  const s = new Set(selectedFolderIds.value);
  if (s.has(folder.id)) s.delete(folder.id); else s.add(folder.id);
  selectedFolderIds.value = s;
}

async function batchTrash() {
  const keys = [...selectedKeys.value];
  const folderIds = [...selectedFolderIds.value].filter(id => {
    const f = folders.value.find(item => item.id === id);
    return f?.name !== 'agent-共享免密目录';
  });
  if (!keys.length && !folderIds.length) return;
  if (!confirm(`将选中的 ${keys.length + folderIds.length} 个项目移入回收站?`)) return;
  try {
    await apiPost('/api/storage/files/batch', { action: 'delete', keys, folder_ids: folderIds });
    selectedKeys.value = new Set();
    selectedFolderIds.value = new Set();
    await loadAll();
    toast(`已移入回收站`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function batchRestore() {
  const keys = [...selectedKeys.value];
  const folderIds = [...selectedFolderIds.value];
  if (!keys.length && !folderIds.length) return;
  try {
    await apiPost('/api/storage/files/batch', { action: 'restore', keys, folder_ids: folderIds });
    selectedKeys.value = new Set();
    selectedFolderIds.value = new Set();
    await loadAll();
    toast('已还原', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function batchPermanentDelete() {
  const keys = [...selectedKeys.value];
  const folderIds = [...selectedFolderIds.value];
  if (!keys.length && !folderIds.length) return;
  if (!confirm(`永久删除选中的 ${keys.length + folderIds.length} 个项目？此操作无法撤销！`)) return;
  try {
    await apiPost('/api/storage/files/batch', { action: 'permanent-delete', keys, folder_ids: folderIds });
    selectedKeys.value = new Set();
    selectedFolderIds.value = new Set();
    await loadAll();
    toast('已永久删除', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function purgeTrash() {
  if (!confirm('清空回收站？所有回收站内容将永久删除，不可恢复！')) return;
  try {
    await apiDelete('/api/storage/trash');
    await loadAll();
    toast('回收站已清空', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─── move modal ───────────────────────────────────────────────────────────
async function openMoveModal() {
  moveModal.value = { open: true, keys: [...selectedKeys.value], folderIds: [...selectedFolderIds.value] };
  moveTargetId.value = currentFolderId.value ?? null;
  // Load all folders flat for picking
  try {
    const res = await apiGet('/api/storage/folders?parent_id=');
    allFolders.value = res.folders || [];
  } catch { allFolders.value = []; }
}

async function commitMove() {
  try {
    if (moveModal.value.keys.length) {
      await apiPost('/api/storage/files/batch', {
        action: 'move',
        keys: moveModal.value.keys,
        folder_id: moveTargetId.value,
      });
    }
    moveModal.value.open = false;
    selectedKeys.value = new Set();
    selectedFolderIds.value = new Set();
    await loadAll();
    toast('已移动', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─── share ────────────────────────────────────────────────────────────────
async function shareFile(file) {
  shareModal.value = { open: true, item: file, url: '', loading: true };
  try {
    const res = await apiPost(`/api/storage/files/${encodeURIComponent(file.key)}/share`, {});
    shareModal.value.url = res.url;
  } catch (err) {
    shareModal.value.url = '';
    toast(err.message, 'error');
  }
  shareModal.value.loading = false;
}

async function shareFolder(folder) {
  shareModal.value = { open: true, item: folder, url: '', loading: true };
  try {
    const res = await apiPost(`/api/storage/folders/${folder.id}/share`, {});
    shareModal.value.url = res.url;
  } catch (err) {
    shareModal.value.url = '';
    toast(err.message, 'error');
  }
  shareModal.value.loading = false;
}

async function copyShareUrl() {
  const url = shareModal.value.url;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    toast('链接已复制', 'success');
  } catch {
    prompt('复制以下链接:', url);
  }
}

// ─── copy direct link ─────────────────────────────────────────────────────
async function copyFileLink(file) {
  const directUrl = `${window.location.origin}${file.url}`;
  try {
    await navigator.clipboard.writeText(directUrl);
    const s = new Set(copiedKeys.value); s.add(file.key); copiedKeys.value = s;
    setTimeout(() => { const s2 = new Set(copiedKeys.value); s2.delete(file.key); copiedKeys.value = s2; }, 2000);
  } catch {
    const ta = document.createElement('textarea'); ta.value = directUrl;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  }
}

// ─── preview ──────────────────────────────────────────────────────────────
function openPreview(file) { previewModal.value = { open: true, file }; }
function closePreview() { previewModal.value = { open: false, file: null }; }

// ─── editor ───────────────────────────────────────────────────────────────
async function openEditor(file) {
  editorFile.value = file;
  editorContent.value = '';
  editorDirty.value = false;
  try {
    const res = await apiGet(`/api/storage/files/${encodeURIComponent(file.key)}/content`);
    editorContent.value = res.content || '';
  } catch (err) {
    toast('读取文件失败: ' + err.message, 'error');
    editorFile.value = null;
  }
}

function closeEditor() {
  if (editorDirty.value && !confirm('有未保存的更改，确定关闭?')) return;
  clearTimeout(editorSaveTimer);
  editorFile.value = null;
  editorDirty.value = false;
}

function onEditorInput() {
  editorDirty.value = true;
  clearTimeout(editorSaveTimer);
  editorSaveTimer = setTimeout(autoSave, 800);
}

async function autoSave() {
  if (!editorFile.value || !editorDirty.value) return;
  editorSaving.value = true;
  try {
    const res = await fetch(`/api/storage/files/${encodeURIComponent(editorFile.value.key)}/content`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editorContent.value }),
    });
    if (!res.ok) throw new Error('保存失败');
    editorDirty.value = false;
  } catch (err) {
    toast('自动保存失败: ' + err.message, 'error');
  }
  editorSaving.value = false;
}

// ─── sort ─────────────────────────────────────────────────────────────────
function setSort(field) {
  if (sortField.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortField.value = field;
    sortOrder.value = 'desc';
  }
  loadAll();
}

// ─── toast ────────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, type = 'success') {
  clearTimeout(toastTimer);
  if (type === 'error') error.value = msg;
  else { successMessage.value = msg; error.value = ''; }
  toastTimer = setTimeout(() => { successMessage.value = ''; error.value = ''; }, 4000);
}

// ─── lifecycle ────────────────────────────────────────────────────────────
onMounted(loadAll);
</script>

<template>
  <div
    class="storage-workspace"
    :class="{ 'storage-workspace--dragover': isDragOver }"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- Drag overlay -->
    <div v-if="isDragOver" class="drag-drop-overlay">
      <div class="drag-drop-box">
        <UploadCloud :size="48" class="drag-icon" />
        <p class="drag-title">释放文件立即上传</p>
        <span class="drag-sub">支持文档、图片、音视频、压缩包等所有格式</span>
      </div>
    </div>

    <!-- Hidden file input -->
    <input ref="fileInputRef" type="file" multiple class="hidden-input" @change="handleFileSelect" />

    <!-- ─── Header ──────────────────────────────────────── -->
    <header class="storage-header">
      <div class="header-left">
        <div class="header-icon-badge">
          <FolderArchive :size="20" />
        </div>
        <div>
          <h1 class="header-title">文件存储</h1>
          <span class="header-stats">{{ files.filter(f=>!f.trashedAt).length }} 个文件 · {{ formatBytes(totalSize) }}</span>
        </div>
      </div>
      <div class="header-right">
        <!-- View tabs -->
        <div class="view-tabs">
          <button class="view-tab" :class="{active: activeView==='files'}" @click="switchView('files')">
            <Folder :size="14" /> 文件
          </button>
          <button class="view-tab" :class="{active: activeView==='trash'}" @click="switchView('trash')">
            <Trash2 :size="14" /> 回收站
          </button>
        </div>

        <!-- Search -->
        <div class="search-wrap">
          <Search :size="15" class="search-icon" />
          <input v-model="searchQuery" type="text" placeholder="搜索文件名..." class="search-input" />
          <button v-if="searchQuery" type="button" class="search-clear-btn" @click="searchQuery=''">
            <X :size="13" />
          </button>
        </div>

        <button type="button" class="btn-icon" :class="{'btn-icon--spin': loading}" title="刷新" @click="loadAll">
          <RefreshCw :size="15" />
        </button>

        <ScreenCaptureButton variant="storage" />

        <template v-if="activeView==='files'">
          <button type="button" class="btn-secondary" @click="createFolder">
            <FolderPlus :size="15" /><span>新建文件夹</span>
          </button>
          <button type="button" class="btn-primary" :disabled="uploading" @click="triggerUpload">
            <Plus :size="15" /><span>上传文件</span>
          </button>
        </template>
        <template v-else>
          <button type="button" class="btn-danger" @click="purgeTrash">
            <Trash2 :size="15" /><span>清空回收站</span>
          </button>
        </template>
      </div>
    </header>

    <!-- ─── Status Banners ──────────────────────────────── -->
    <div v-if="uploading" class="upload-banner">
      <div class="spinner"></div>
      <span>{{ uploadProgressText }}</span>
    </div>
    <div v-if="successMessage" class="toast toast--success"><Check :size="15" /><span>{{ successMessage }}</span></div>
    <div v-if="error" class="toast toast--error"><span>{{ error }}</span></div>

    <!-- ─── Category Tabs ───────────────────────────────── -->
    <div v-if="activeView==='files'" class="categories-bar">
      <button v-for="cat in categories" :key="cat.id" type="button"
        class="cat-pill" :class="{'cat-pill--active': activeCategory===cat.id}"
        @click="activeCategory=cat.id">{{ cat.label }}</button>
    </div>

    <!-- ─── Breadcrumb ──────────────────────────────────── -->
    <nav v-if="activeView==='files'" class="breadcrumb-nav">
      <button class="bc-item" @click="navigateTo(-1)"><Home :size="13" /><span>全部文件</span></button>
      <template v-for="(crumb, idx) in breadcrumb" :key="crumb.id">
        <ChevronRight :size="13" class="bc-sep" />
        <button class="bc-item" :class="{'bc-item--active': idx===breadcrumb.length-1}" @click="navigateTo(idx)">
          {{ crumb.name }}
        </button>
      </template>
    </nav>

    <!-- ─── Batch Action Bar ────────────────────────────── -->
    <div v-if="hasSelection" class="batch-bar">
      <span class="batch-count">已选 {{ selectedKeys.size + selectedFolderIds.size }} 项</span>
      <button class="batch-btn" @click="openMoveModal" v-if="activeView==='files'">
        <ArrowDownUp :size="14" /> 移动到
      </button>
      <button class="batch-btn batch-btn--danger" @click="activeView==='trash' ? batchPermanentDelete() : batchTrash()">
        <Trash2 :size="14" /> {{ activeView==='trash' ? '永久删除' : '移入回收站' }}
      </button>
      <button v-if="activeView==='trash'" class="batch-btn batch-btn--restore" @click="batchRestore">
        <RotateCcw :size="14" /> 还原
      </button>
      <button class="batch-btn batch-btn--cancel" @click="selectedKeys=new Set();selectedFolderIds=new Set()">
        <X :size="14" /> 取消
      </button>
    </div>

    <!-- ─── Main Content ────────────────────────────────── -->
    <div class="storage-content">
      <!-- Loading -->
      <div v-if="loading" class="loading-state">
        <div class="spinner spinner--lg"></div>
        <span>加载中...</span>
      </div>

      <!-- Empty -->
      <div v-else-if="sortedFolders.length===0 && filteredFiles.length===0 && !loading" class="empty-state">
        <div class="empty-icon"><UploadCloud :size="40" /></div>
        <p class="empty-title">{{ activeView==='trash' ? '回收站为空' : (searchQuery ? '未找到匹配文件' : '暂无文件') }}</p>
        <p class="empty-desc" v-if="activeView!=='trash' && !searchQuery">拖拽文件到此处，或点击"上传文件"按钮</p>
        <button v-if="activeView!=='trash' && !searchQuery" type="button" class="btn-primary" @click="triggerUpload">
          <Plus :size="14" /><span>选择文件上传</span>
        </button>
      </div>

      <!-- File/Folder Table -->
      <div v-else class="file-table-wrap">
        <table class="file-table">
          <thead>
            <tr>
              <th class="th-check">
                <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" />
              </th>
              <th class="th-name sortable" @click="setSort('filename')">
                名称
                <component :is="sortField==='filename' ? (sortOrder==='asc' ? SortAsc : SortDesc) : ArrowDownUp" :size="13" />
              </th>
              <th class="th-type">类型</th>
              <th class="th-size sortable" @click="setSort('size')">
                大小
                <component :is="sortField==='size' ? (sortOrder==='asc' ? SortAsc : SortDesc) : ArrowDownUp" :size="13" />
              </th>
              <th class="th-date sortable" @click="setSort('created_at')">
                时间
                <component :is="sortField==='created_at' ? (sortOrder==='asc' ? SortAsc : SortDesc) : ArrowDownUp" :size="13" />
              </th>
              <th class="th-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <!-- Folders (always first) -->
            <tr v-for="folder in sortedFolders" :key="`folder-${folder.id}`" class="file-row">
              <td class="td-check">
                <input v-if="folder.name !== 'agent-共享免密目录'" type="checkbox" :checked="selectedFolderIds.has(folder.id)" @change="toggleSelectFolder(folder)" />
                <span v-else style="display:inline-block;width:16px;text-align:center;font-size:13px" title="受保护根目录">🔒</span>
              </td>
              <td class="td-name" @dblclick="activeView!=='trash' && openFolder(folder)">
                <div class="name-cell">
                  <div class="file-icon-box file-icon-box--folder">
                    <FolderOpen v-if="selectedFolderIds.has(folder.id)" :size="20" />
                    <Folder v-else :size="20" />
                  </div>
                  <div class="name-info">
                    <template v-if="renamingFolderId===folder.id">
                      <input class="rename-input" v-model="renameValue"
                        @blur="commitRenameFolder(folder)"
                        @keyup.enter="commitRenameFolder(folder)"
                        @keyup.escape="renamingFolderId=null"
                        @click.stop />
                    </template>
                    <template v-else>
                      <span class="file-title folder-title" @dblclick.stop="startRenameFolder(folder)"
                            @click="activeView!=='trash' && openFolder(folder)">{{ folder.name }}</span>
                    </template>
                  </div>
                </div>
              </td>
              <td><span class="type-badge type-badge--folder">文件夹</span></td>
              <td><span class="size-text">—</span></td>
              <td><span class="date-text">{{ formatDate(folder.createdAt) }}</span></td>
              <td class="td-actions">
                <div class="row-actions">
                  <template v-if="activeView==='trash'">
                    <button class="btn-action btn-action--restore" title="还原" @click="restoreFolder(folder)">
                      <RotateCcw :size="14" />
                    </button>
                    <button class="btn-action btn-action--danger" title="永久删除" @click="batchPermanentDelete">
                      <Trash2 :size="14" />
                    </button>
                  </template>
                  <template v-else>
                    <button v-if="folder.name !== 'agent-共享免密目录'" class="btn-action" title="重命名" @click="startRenameFolder(folder)">
                      <PencilLine :size="14" />
                    </button>
                    <button class="btn-action" title="分享文件夹" @click="shareFolder(folder)">
                      <Share2 :size="14" />
                    </button>
                    <button v-if="folder.name !== 'agent-共享免密目录'" class="btn-action btn-action--danger" title="移入回收站" @click="trashFolder(folder)">
                      <Trash2 :size="14" />
                    </button>
                    <span v-else class="type-badge" style="background:#eef2ff;color:#4338ca;font-size:11px;padding:2px 6px;border-radius:4px" title="受保护共享根目录（不可删除）">🔒 受保护</span>
                  </template>
                </div>
              </td>
            </tr>

            <!-- Files -->
            <tr v-for="file in filteredFiles" :key="file.key" class="file-row">
              <td class="td-check">
                <input type="checkbox" :checked="selectedKeys.has(file.key)" @change="toggleSelectFile(file)" />
              </td>
              <td class="td-name">
                <div class="name-cell">
                  <div class="file-icon-box">
                    <component :is="getFileIcon(file)" :size="18" class="file-type-icon" />
                  </div>
                  <div class="name-info">
                    <template v-if="renamingKey===file.key">
                      <input class="rename-input" v-model="renameValue"
                        @blur="commitRenameFile(file)"
                        @keyup.enter="commitRenameFile(file)"
                        @keyup.escape="renamingKey=null"
                        @click.stop />
                    </template>
                    <template v-else>
                      <span class="file-title" :title="file.name">{{ file.name }}</span>
                      <span class="file-key-preview">{{ file.key }}</span>
                    </template>
                  </div>
                </div>
              </td>
              <td><span class="type-badge">{{ getCategory(file) }}</span></td>
              <td><span class="size-text">{{ formatBytes(file.size) }}</span></td>
              <td><span class="date-text">{{ formatDate(file.createdAt) }}</span></td>
              <td class="td-actions">
                <div class="row-actions">
                  <template v-if="activeView==='trash'">
                    <button class="btn-action btn-action--restore" title="还原" @click="restoreFile(file)">
                      <RotateCcw :size="14" />
                    </button>
                    <button class="btn-action btn-action--danger" title="永久删除" @click="permanentDeleteFile(file)">
                      <Trash2 :size="14" />
                    </button>
                  </template>
                  <template v-else>
                    <button class="btn-action" :title="copiedKeys.has(file.key)?'已复制':'复制直链'" @click="copyFileLink(file)">
                      <component :is="copiedKeys.has(file.key)?Check:Copy" :size="14" />
                    </button>
                    <a :href="file.url" :download="file.name" class="btn-action" title="下载">
                      <Download :size="14" />
                    </a>
                    <button v-if="getCategory(file)==='image'||file.name.endsWith('.pdf')" class="btn-action" title="预览" @click="openPreview(file)">
                      <Eye :size="14" />
                    </button>
                    <button v-if="isEditable(file)" class="btn-action" title="编辑" @click="openEditor(file)">
                      <FileText :size="14" />
                    </button>
                    <button class="btn-action" title="重命名" @click="startRenameFile(file)">
                      <PencilLine :size="14" />
                    </button>
                    <button class="btn-action" title="免密分享" @click="shareFile(file)">
                      <Share2 :size="14" />
                    </button>
                    <button class="btn-action btn-action--danger" title="移入回收站" @click="trashFile(file)">
                      <Trash2 :size="14" />
                    </button>
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ─── Preview Modal ───────────────────────────────── -->
    <div v-if="previewModal.open" class="modal-backdrop" @click.self="closePreview">
      <div class="modal modal--preview">
        <div class="modal-header">
          <span class="modal-title">{{ previewModal.file?.name }}</span>
          <button class="modal-close" @click="closePreview"><X :size="18" /></button>
        </div>
        <div class="preview-body">
          <img v-if="getCategory(previewModal.file)==='image'" :src="previewModal.file?.url" :alt="previewModal.file?.name" class="preview-img" />
          <iframe v-else-if="previewModal.file?.name.endsWith('.pdf')" :src="previewModal.file?.url" class="preview-iframe"></iframe>
        </div>
      </div>
    </div>

    <!-- ─── Share Modal ─────────────────────────────────── -->
    <div v-if="shareModal.open" class="modal-backdrop" @click.self="shareModal.open=false">
      <div class="modal modal--share">
        <div class="modal-header">
          <span class="modal-title"><Link2 :size="16" /> 免密分享</span>
          <button class="modal-close" @click="shareModal.open=false"><X :size="18" /></button>
        </div>
        <div class="modal-body">
          <p class="share-desc">任何人通过此链接可直接访问，无需登录：</p>
          <div v-if="shareModal.loading" class="share-loading"><div class="spinner"></div> 生成链接中...</div>
          <div v-else class="share-url-wrap">
            <input class="share-url-input" readonly :value="shareModal.url" />
            <button class="btn-primary" @click="copyShareUrl"><Copy :size="14" /> 复制链接</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ─── Move Modal ──────────────────────────────────── -->
    <div v-if="moveModal.open" class="modal-backdrop" @click.self="moveModal.open=false">
      <div class="modal modal--move">
        <div class="modal-header">
          <span class="modal-title"><ArrowDownUp :size="16" /> 移动到文件夹</span>
          <button class="modal-close" @click="moveModal.open=false"><X :size="18" /></button>
        </div>
        <div class="modal-body">
          <select class="folder-select" v-model="moveTargetId">
            <option :value="null">/ 根目录</option>
            <option v-for="f in allFolders" :key="f.id" :value="f.id">📁 {{ f.name }}</option>
          </select>
          <div class="modal-footer">
            <button class="btn-secondary" @click="moveModal.open=false">取消</button>
            <button class="btn-primary" @click="commitMove">确认移动</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ─── Text Editor Panel ───────────────────────────── -->
    <div v-if="editorFile" class="editor-overlay">
      <div class="editor-panel">
        <div class="editor-header">
          <span class="editor-filename">
            <FileText :size="15" />
            {{ editorFile.name }}
            <span v-if="editorSaving" class="editor-saving">保存中...</span>
            <span v-else-if="editorDirty" class="editor-dirty">● 未保存</span>
            <span v-else class="editor-saved">✓ 已保存</span>
          </span>
          <button class="modal-close" @click="closeEditor"><X :size="18" /></button>
        </div>
        <textarea class="editor-textarea" v-model="editorContent" @input="onEditorInput"
          placeholder="文件内容..."></textarea>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ─── layout ─────────────────────────────────────────────────────────────── */
.storage-workspace {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: var(--surface-primary, #fff);
  overflow-y: auto;
}
.storage-workspace--dragover { outline: 2px dashed #6366f1; }

.hidden-input { display: none; }

/* drag overlay */
.drag-drop-overlay {
  position: absolute; inset: 0; z-index: 100;
  background: rgba(248,250,252,.92); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.drag-drop-box {
  display: flex; flex-direction: column; align-items: center;
  padding: 48px; border: 2px dashed #6366f1; border-radius: 20px;
  background: #fff; gap: 8px;
}
.drag-icon { color: #6366f1; }
.drag-title { font-size: 1.1rem; font-weight: 700; color: #1e293b; margin: 0; }
.drag-sub { font-size: .84rem; color: #64748b; }

/* ─── header ─────────────────────────────────────────────────────────────── */
.storage-header {
  display: flex; justify-content: space-between; align-items: center;
  flex-wrap: wrap; gap: 12px; padding: 16px 20px;
  border-bottom: 1px solid var(--border-subtle, #e2e8f0);
  background: var(--surface-primary, #fff);
}
.header-left { display: flex; align-items: center; gap: 12px; }
.header-icon-badge {
  width: 40px; height: 40px; border-radius: 10px;
  background: linear-gradient(135deg,#0ea5e9 0%,#2563eb 100%);
  display: flex; align-items: center; justify-content: center; color: #fff;
}
.header-title { font-size: 1.1rem; font-weight: 700; color: var(--text-primary,#0f172a); margin: 0; }
.header-stats { font-size: .78rem; color: var(--text-secondary,#64748b); }
.header-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* view tabs */
.view-tabs { display: flex; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
.view-tab {
  display: flex; align-items: center; gap: 5px; padding: 6px 12px;
  font-size: .8rem; font-weight: 500; border: none; background: #f8fafc; color: #64748b; cursor: pointer;
}
.view-tab.active { background: #2563eb; color: #fff; }

/* search */
.search-wrap { position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: 9px; color: #94a3b8; pointer-events: none; }
.search-input {
  padding: 7px 28px 7px 30px; font-size: .82rem;
  border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; color: #1e293b; width: 170px;
  transition: width .2s;
}
.search-input:focus { width: 220px; border-color: #6366f1; outline: none; }
.search-clear-btn { position: absolute; right: 7px; background: none; border: none; color: #94a3b8; cursor: pointer; padding: 2px; }

/* buttons */
.btn-icon {
  display: flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 8px;
  border: 1px solid #e2e8f0; background: #f8fafc; color: #475569; cursor: pointer;
}
.btn-icon:hover { background: #e2e8f0; }
.btn-icon--spin svg { animation: spin 1s linear infinite; }
@keyframes spin { 100% { transform: rotate(360deg); } }

.btn-primary, .btn-secondary, .btn-danger {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 14px; font-size: .82rem; font-weight: 600;
  border-radius: 8px; border: none; cursor: pointer; transition: background .15s;
}
.btn-primary { background: #2563eb; color: #fff; }
.btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.btn-primary:disabled { opacity: .6; cursor: not-allowed; }
.btn-secondary { background: #f1f5f9; color: #374151; border: 1px solid #e2e8f0; }
.btn-secondary:hover { background: #e2e8f0; }
.btn-danger { background: #ef4444; color: #fff; }
.btn-danger:hover { background: #dc2626; }

/* ─── banners ─────────────────────────────────────────────────────────────── */
.upload-banner {
  display: flex; align-items: center; gap: 10px;
  margin: 10px 20px 0; padding: 9px 14px;
  background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; color: #1e40af; font-size: .82rem;
}
.toast {
  display: flex; align-items: center; gap: 8px;
  margin: 8px 20px 0; padding: 9px 14px; border-radius: 8px; font-size: .82rem;
}
.toast--success { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; }
.toast--error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
.spinner {
  width: 15px; height: 15px; border: 2px solid #93c5fd; border-top-color: #2563eb;
  border-radius: 50%; animation: spin .8s linear infinite; flex-shrink: 0;
}
.spinner--lg { width: 24px; height: 24px; }

/* ─── category bar ─────────────────────────────────────────────────────────── */
.categories-bar { display: flex; gap: 6px; padding: 12px 20px 0; overflow-x: auto; }
.cat-pill {
  padding: 5px 13px; font-size: .78rem; font-weight: 500;
  border-radius: 20px; border: 1px solid #e2e8f0; background: #f8fafc; color: #64748b; cursor: pointer;
}
.cat-pill:hover { background: #f1f5f9; color: #1e293b; }
.cat-pill--active { background: #2563eb; color: #fff; border-color: #2563eb; }

/* ─── breadcrumb ───────────────────────────────────────────────────────────── */
.breadcrumb-nav {
  display: flex; align-items: center; gap: 2px;
  padding: 8px 20px 0; font-size: .8rem;
}
.bc-item {
  display: flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: 6px; border: none; background: none;
  color: #2563eb; cursor: pointer; font-size: .8rem;
}
.bc-item:hover { background: #eff6ff; }
.bc-item--active { color: #1e293b; cursor: default; font-weight: 600; }
.bc-sep { color: #94a3b8; }

/* ─── batch bar ────────────────────────────────────────────────────────────── */
.batch-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 20px; background: #faf5ff; border-bottom: 1px solid #e9d5ff; font-size: .82rem;
}
.batch-count { font-weight: 600; color: #7c3aed; margin-right: 4px; }
.batch-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 11px; border-radius: 6px; border: 1px solid #ddd6fe; background: #fff;
  color: #374151; font-size: .78rem; cursor: pointer;
}
.batch-btn:hover { background: #f5f3ff; }
.batch-btn--danger { border-color: #fca5a5; color: #dc2626; }
.batch-btn--danger:hover { background: #fee2e2; }
.batch-btn--restore { border-color: #6ee7b7; color: #059669; }
.batch-btn--restore:hover { background: #ecfdf5; }
.batch-btn--cancel { color: #94a3b8; border-color: #e2e8f0; }

/* ─── main content ──────────────────────────────────────────────────────────── */
.storage-content { flex: 1; padding: 12px 20px 24px; }

.loading-state { display: flex; align-items: center; gap: 12px; padding: 48px 0; justify-content: center; color: #64748b; }

.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 56px 20px; text-align: center; gap: 10px;
}
.empty-icon { width: 72px; height: 72px; border-radius: 18px; background: #f1f5f9; display: flex; align-items: center; justify-content: center; color: #94a3b8; }
.empty-title { font-size: 1rem; font-weight: 600; color: #1e293b; margin: 0; }
.empty-desc { font-size: .82rem; color: #64748b; max-width: 360px; margin: 0; }

/* ─── table ─────────────────────────────────────────────────────────────────── */
.file-table-wrap { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
.file-table { width: 100%; border-collapse: collapse; }
.file-table th {
  background: #f8fafc; padding: 10px 12px;
  font-size: .73rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .4px;
  border-bottom: 1px solid #e2e8f0; white-space: nowrap;
}
.sortable { cursor: pointer; user-select: none; }
.sortable:hover { background: #f1f5f9; }
th svg { vertical-align: middle; opacity: .6; margin-left: 3px; }
.th-check { width: 36px; }
.th-name { min-width: 220px; }
.th-type, .th-size, .th-date { width: 110px; }
.th-actions { width: 180px; text-align: right; }

.file-row { border-bottom: 1px solid #f1f5f9; }
.file-row:hover { background: #fafbff; }
.file-row td { padding: 10px 12px; vertical-align: middle; }
.td-check { width: 36px; }
.td-actions { text-align: right; }

.name-cell { display: flex; align-items: center; gap: 10px; }
.file-icon-box {
  width: 34px; height: 34px; border-radius: 8px; background: #f1f5f9;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.file-icon-box--folder { background: #fef9c3; }
.file-icon-box--folder svg { color: #ca8a04; }
.file-type-icon { color: #2563eb; }
.name-info { display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
.file-title {
  font-size: .84rem; font-weight: 600; color: #1e293b;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px;
}
.folder-title { cursor: pointer; color: #2563eb; }
.folder-title:hover { text-decoration: underline; }
.file-key-preview {
  font-size: .68rem; color: #94a3b8; font-family: monospace;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px;
}
.type-badge { display: inline-block; padding: 2px 7px; font-size: .72rem; border-radius: 4px; background: #f1f5f9; color: #475569; }
.type-badge--folder { background: #fef9c3; color: #92400e; }
.size-text, .date-text { font-size: .78rem; color: #64748b; white-space: nowrap; }

.rename-input {
  font-size: .84rem; border: 1px solid #6366f1; border-radius: 4px;
  padding: 2px 7px; width: 100%; max-width: 240px; outline: none;
}

.row-actions { display: flex; align-items: center; gap: 4px; justify-content: flex-end; }
.btn-action {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: 6px;
  border: 1px solid #e2e8f0; background: #fff; color: #475569; cursor: pointer; text-decoration: none;
  transition: all .15s;
}
.btn-action:hover { background: #f1f5f9; color: #0f172a; }
.btn-action--danger:hover { background: #fee2e2; color: #dc2626; border-color: #fca5a5; }
.btn-action--restore:hover { background: #ecfdf5; color: #059669; border-color: #6ee7b7; }

/* ─── modals ─────────────────────────────────────────────────────────────────── */
.modal-backdrop {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(15,23,42,.65); display: flex; align-items: center; justify-content: center; padding: 24px;
}
.modal {
  background: #fff; border-radius: 14px; overflow: hidden; display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,.2); width: 100%;
}
.modal--preview { max-width: 840px; max-height: 88vh; }
.modal--share { max-width: 480px; }
.modal--move { max-width: 380px; }
.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 18px; border-bottom: 1px solid #e2e8f0; gap: 12px;
}
.modal-title { font-size: .9rem; font-weight: 600; color: #1e293b; display: flex; align-items: center; gap: 7px; }
.modal-close { background: none; border: none; color: #94a3b8; cursor: pointer; padding: 2px; }
.modal-body { padding: 18px; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }

.preview-body {
  flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center;
  padding: 16px; background: #0f172a; min-height: 200px;
}
.preview-img { max-width: 100%; max-height: 72vh; object-fit: contain; }
.preview-iframe { width: 100%; height: 72vh; border: none; }

.share-desc { font-size: .84rem; color: #475569; margin: 0 0 14px; }
.share-loading { display: flex; align-items: center; gap: 10px; color: #64748b; font-size: .84rem; }
.share-url-wrap { display: flex; gap: 8px; align-items: center; }
.share-url-input {
  flex: 1; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: .78rem; background: #f8fafc; color: #1e293b; min-width: 0;
}

.folder-select {
  width: 100%; padding: 9px 12px; border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: .84rem; background: #f8fafc; color: #1e293b;
}

/* ─── text editor ───────────────────────────────────────────────────────────── */
.editor-overlay {
  position: fixed; inset: 0; z-index: 900;
  background: rgba(15,23,42,.7); display: flex; align-items: stretch; justify-content: flex-end;
}
.editor-panel {
  width: min(760px, 90vw); height: 100%; background: #fff;
  display: flex; flex-direction: column;
  box-shadow: -4px 0 24px rgba(0,0,0,.18);
}
.editor-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px; border-bottom: 1px solid #e2e8f0; gap: 12px;
}
.editor-filename { display: flex; align-items: center; gap: 8px; font-size: .84rem; font-weight: 600; color: #1e293b; }
.editor-saving { font-size: .72rem; color: #2563eb; font-weight: 400; }
.editor-dirty { font-size: .72rem; color: #f59e0b; font-weight: 400; }
.editor-saved { font-size: .72rem; color: #059669; font-weight: 400; }
.editor-textarea {
  flex: 1; resize: none; border: none; outline: none;
  padding: 16px; font-family: 'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace;
  font-size: .84rem; line-height: 1.6; color: #1e293b; background: #fafafa;
}
</style>
