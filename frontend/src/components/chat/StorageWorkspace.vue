<script setup>
import { computed, onMounted, ref } from 'vue';
import {
  Check,
  Copy,
  Download,
  Eye,
  File,
  FileCode,
  FileSpreadsheet,
  FileText,
  Film,
  FolderArchive,
  Image as ImageIcon,
  Music,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
  X
} from '@lucide/vue';
import api from '../../api.js';
import store from '../../store.js';

const files = ref([]);
const loading = ref(false);
const uploading = ref(false);
const uploadProgressText = ref('');
const error = ref('');
const successMessage = ref('');
const searchQuery = ref('');
const activeCategory = ref('all');
const fileInputRef = ref(null);
const isDragOver = ref(false);

const previewModal = ref({
  open: false,
  file: null
});

const categories = [
  { id: 'all', label: '全部' },
  { id: 'document', label: '文档' },
  { id: 'image', label: '图片' },
  { id: 'media', label: '音视频' },
  { id: 'archive', label: '压缩包' },
  { id: 'other', label: '其它' }
];

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
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

const filteredFiles = computed(() => {
  return files.value.filter(file => {
    if (activeCategory.value !== 'all' && getCategory(file) !== activeCategory.value) {
      return false;
    }
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.trim().toLowerCase();
      return (file.name || '').toLowerCase().includes(q);
    }
    return true;
  });
});

const totalSize = computed(() => {
  return files.value.reduce((acc, cur) => acc + (cur.size || 0), 0);
});

async function loadFiles() {
  loading.value = true;
  error.value = '';
  try {
    const res = await api.getStorageFiles();
    files.value = res.files || [];
  } catch (err) {
    error.value = err.message || '获取文件列表失败';
  } finally {
    loading.value = false;
  }
}

function triggerUpload() {
  fileInputRef.value?.click();
}

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
    uploadProgressText.value = `正在上传 (${i + 1}/${fileList.length}): ${file.name}...`;
    try {
      await api.uploadStorageFile(file);
      successCount++;
    } catch (err) {
      error.value = `上传 ${file.name} 失败: ${err.message}`;
    }
  }

  uploading.value = false;
  uploadProgressText.value = '';
  if (successCount > 0) {
    successMessage.value = `成功上传 ${successCount} 个文件`;
    setTimeout(() => {
      successMessage.value = '';
    }, 3000);
    await loadFiles();
  }
}

function handleDragOver(e) {
  e.preventDefault();
  isDragOver.value = true;
}

function handleDragLeave(e) {
  e.preventDefault();
  isDragOver.value = false;
}

async function handleDrop(e) {
  e.preventDefault();
  isDragOver.value = false;
  const dropped = e.dataTransfer?.files;
  if (dropped && dropped.length > 0) {
    await uploadFiles(Array.from(dropped));
  }
}

const copiedKeys = ref(new Set());

async function copyFileLink(file) {
  const directUrl = `${window.location.origin}${file.url}`;
  try {
    await navigator.clipboard.writeText(directUrl);
    copiedKeys.value.add(file.key);
    setTimeout(() => {
      copiedKeys.value.delete(file.key);
    }, 2000);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = directUrl;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    copiedKeys.value.add(file.key);
    setTimeout(() => {
      copiedKeys.value.delete(file.key);
    }, 2000);
  }
}

async function deleteFile(file) {
  if (!confirm(`确认永久删除文件 "${file.name}" 吗？此操作无法撤销。`)) return;
  try {
    await api.deleteStorageFile(file.key);
    files.value = files.value.filter(f => f.key !== file.key);
  } catch (err) {
    alert(`删除失败: ${err.message}`);
  }
}

function openPreview(file) {
  previewModal.value = {
    open: true,
    file
  };
}

function closePreview() {
  previewModal.value = {
    open: false,
    file: null
  };
}

onMounted(() => {
  loadFiles();
});
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
        <p class="drag-title">释放文件立即上传到云存储</p>
        <span class="drag-sub">支持任意文档、图片、表格、音视频、压缩包等一切附件</span>
      </div>
    </div>

    <!-- Hidden native file input -->
    <input
      ref="fileInputRef"
      type="file"
      multiple
      class="hidden-input"
      @change="handleFileSelect"
    />

    <!-- Header / Navbar -->
    <header class="storage-header">
      <div class="header-left">
        <div class="header-title-wrap">
          <div class="header-icon-badge">
            <FolderArchive :size="22" />
          </div>
          <div>
            <h1 class="header-title">文件存储</h1>
            <span class="header-stats">
              {{ files.length }} 个文件 · 已用 {{ formatBytes(totalSize) }}
            </span>
          </div>
        </div>
      </div>

      <div class="header-right">
        <!-- Search bar -->
        <div class="search-wrap">
          <Search :size="16" class="search-icon" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索文件名..."
            class="search-input"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="search-clear-btn"
            @click="searchQuery = ''"
          >
            <X :size="14" />
          </button>
        </div>

        <button
          type="button"
          class="btn-icon"
          :class="{ 'btn-icon--spin': loading }"
          title="刷新列表"
          @click="loadFiles"
        >
          <RefreshCw :size="16" />
        </button>

        <button
          type="button"
          class="btn-primary"
          :disabled="uploading"
          @click="triggerUpload"
        >
          <Plus :size="16" />
          <span>上传文件</span>
        </button>
      </div>
    </header>

    <!-- Upload Status Banner -->
    <div v-if="uploading" class="upload-progress-bar">
      <div class="spinner"></div>
      <span>{{ uploadProgressText }}</span>
    </div>

    <div v-if="successMessage" class="toast-banner toast-banner--success">
      <Check :size="16" />
      <span>{{ successMessage }}</span>
    </div>

    <div v-if="error" class="toast-banner toast-banner--error">
      <span>{{ error }}</span>
    </div>

    <!-- Category Filter Pills -->
    <div class="categories-bar">
      <button
        v-for="cat in categories"
        :key="cat.id"
        type="button"
        class="cat-pill"
        :class="{ 'cat-pill--active': activeCategory === cat.id }"
        @click="activeCategory = cat.id"
      >
        {{ cat.label }}
      </button>
    </div>

    <!-- Main Content Area -->
    <div class="storage-content">
      <!-- Empty state -->
      <div v-if="!loading && filteredFiles.length === 0" class="empty-state">
        <div class="empty-icon-wrap">
          <UploadCloud :size="48" />
        </div>
        <p class="empty-title">
          {{ searchQuery ? '未找到匹配的文件' : '暂无云存储文件' }}
        </p>
        <p class="empty-desc">
          拖拽任意文档、图片、表格、压缩包或代码至窗口，或点击上方“上传文件”按钮添加
        </p>
        <button
          v-if="!searchQuery"
          type="button"
          class="btn-primary empty-action-btn"
          @click="triggerUpload"
        >
          <Plus :size="16" />
          <span>选择文件上传</span>
        </button>
      </div>

      <!-- File Table / Grid -->
      <div v-else class="file-table-container">
        <table class="file-table">
          <thead>
            <tr>
              <th class="th-name">名称</th>
              <th class="th-type">类型</th>
              <th class="th-size">大小</th>
              <th class="th-date">上传时间</th>
              <th class="th-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="file in filteredFiles" :key="file.key" class="file-row">
              <td class="td-name">
                <div class="name-cell">
                  <div class="file-icon-box">
                    <component :is="getFileIcon(file)" :size="20" class="file-type-icon" />
                  </div>
                  <div class="name-info">
                    <span class="file-title" :title="file.name">{{ file.name }}</span>
                    <span class="file-key-preview">{{ file.key }}</span>
                  </div>
                </div>
              </td>
              <td class="td-type">
                <span class="type-badge">{{ getCategory(file) }}</span>
              </td>
              <td class="td-size">
                <span class="size-text">{{ formatBytes(file.size) }}</span>
              </td>
              <td class="td-date">
                <span class="date-text">{{ formatDate(file.createdAt) }}</span>
              </td>
              <td class="td-actions">
                <div class="row-actions">
                  <button
                    type="button"
                    class="btn-row-action"
                    :title="copiedKeys.has(file.key) ? '已复制直链' : '复制直达链接'"
                    @click="copyFileLink(file)"
                  >
                    <component :is="copiedKeys.has(file.key) ? Check : Copy" :size="15" />
                  </button>
                  <a
                    :href="file.url"
                    :download="file.name"
                    class="btn-row-action"
                    title="下载文件"
                  >
                    <Download :size="15" />
                  </a>
                  <button
                    v-if="getCategory(file) === 'image' || file.name.endsWith('.pdf')"
                    type="button"
                    class="btn-row-action"
                    title="预览文件"
                    @click="openPreview(file)"
                  >
                    <Eye :size="15" />
                  </button>
                  <button
                    type="button"
                    class="btn-row-action btn-row-action--danger"
                    title="永久删除"
                    @click="deleteFile(file)"
                  >
                    <Trash2 :size="15" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Preview Modal -->
    <div v-if="previewModal.open" class="preview-backdrop" @click.self="closePreview">
      <div class="preview-modal">
        <div class="preview-header">
          <span class="preview-title">{{ previewModal.file?.name }}</span>
          <button type="button" class="preview-close-btn" @click="closePreview">
            <X :size="18" />
          </button>
        </div>
        <div class="preview-body">
          <img
            v-if="getCategory(previewModal.file) === 'image'"
            :src="previewModal.file?.url"
            :alt="previewModal.file?.name"
            class="preview-img"
          />
          <iframe
            v-else-if="previewModal.file?.name.endsWith('.pdf')"
            :src="previewModal.file?.url"
            class="preview-iframe"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.storage-workspace {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: var(--surface-primary, #ffffff);
  overflow-y: auto;
}

.storage-workspace--dragover {
  border: 2px dashed #6366f1;
}

.hidden-input {
  display: none;
}

.drag-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  background: rgba(248, 250, 252, 0.94);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.drag-drop-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px;
  border: 2px dashed #6366f1;
  border-radius: 20px;
  background: #ffffff;
  box-shadow: 0 10px 30px rgba(99, 102, 241, 0.15);
}

.drag-icon {
  color: #6366f1;
  margin-bottom: 12px;
}

.drag-title {
  font-size: 1.2rem;
  font-weight: 700;
  color: #1e293b;
  margin: 0 0 6px;
}

.drag-sub {
  font-size: 0.88rem;
  color: #64748b;
}

/* Header */
.storage-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-subtle, #e2e8f0);
}

.header-title-wrap {
  display: flex;
  align-items: center;
  gap: 14px;
}

.header-icon-badge {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
}

.header-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary, #0f172a);
  margin: 0;
}

.header-stats {
  font-size: 0.82rem;
  color: var(--text-secondary, #64748b);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* Search bar */
.search-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 10px;
  color: #94a3b8;
  pointer-events: none;
}

.search-input {
  padding: 7px 30px 7px 32px;
  font-size: 0.85rem;
  border: 1px solid var(--border-subtle, #cbd5e1);
  border-radius: 8px;
  background: var(--surface-secondary, #f8fafc);
  color: var(--text-primary, #1e293b);
  width: 180px;
  transition: width 0.2s ease, border-color 0.2s ease;
}

.search-input:focus {
  width: 240px;
  border-color: #6366f1;
  outline: none;
}

.search-clear-btn {
  position: absolute;
  right: 8px;
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 2px;
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle, #cbd5e1);
  background: var(--surface-secondary, #f8fafc);
  color: var(--text-primary, #475569);
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-icon:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.btn-icon--spin svg {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  100% {
    transform: rotate(360deg);
  }
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 0.86rem;
  font-weight: 600;
  border-radius: 8px;
  background: #2563eb;
  color: #ffffff;
  border: none;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
  transition: background 0.15s ease;
}

.btn-primary:hover:not(:disabled) {
  background: #1d4ed8;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Category pills */
.categories-bar {
  display: flex;
  gap: 6px;
  padding: 12px 24px 0;
  overflow-x: auto;
}

.cat-pill {
  padding: 5px 14px;
  font-size: 0.82rem;
  font-weight: 500;
  border-radius: 20px;
  border: 1px solid var(--border-subtle, #e2e8f0);
  background: var(--surface-secondary, #f8fafc);
  color: var(--text-secondary, #64748b);
  cursor: pointer;
  transition: all 0.15s ease;
}

.cat-pill:hover {
  background: #f1f5f9;
  color: #1e293b;
}

.cat-pill--active {
  background: #2563eb;
  color: #ffffff;
  border-color: #2563eb;
}

/* Banners */
.upload-progress-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 24px 0;
  padding: 10px 16px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  color: #1e40af;
  font-size: 0.85rem;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #93c5fd;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.toast-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 24px 0;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 0.85rem;
}

.toast-banner--success {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
}

.toast-banner--error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

/* Main Content */
.storage-content {
  flex: 1;
  padding: 16px 24px 24px;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.empty-icon-wrap {
  width: 80px;
  height: 80px;
  border-radius: 20px;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  margin-bottom: 16px;
}

.empty-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 6px;
}

.empty-desc {
  font-size: 0.85rem;
  color: #64748b;
  max-width: 400px;
  margin: 0 0 20px;
}

.empty-action-btn {
  margin-top: 4px;
}

/* Table */
.file-table-container {
  border: 1px solid var(--border-subtle, #e2e8f0);
  border-radius: 12px;
  overflow: hidden;
  background: #ffffff;
}

.file-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

.file-table th {
  background: #f8fafc;
  padding: 12px 16px;
  font-size: 0.78rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid #e2e8f0;
}

.file-row {
  border-bottom: 1px solid #f1f5f9;
  transition: background 0.15s ease;
}

.file-row:hover {
  background: #f8fafc;
}

.file-row td {
  padding: 12px 16px;
  vertical-align: middle;
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}

.file-icon-box {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.file-type-icon {
  color: #2563eb;
}

.name-info {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.file-title {
  font-size: 0.88rem;
  font-weight: 600;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
}

.file-key-preview {
  font-size: 0.72rem;
  color: #94a3b8;
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
}

.type-badge {
  display: inline-block;
  padding: 2px 8px;
  font-size: 0.75rem;
  border-radius: 4px;
  background: #f1f5f9;
  color: #475569;
}

.size-text,
.date-text {
  font-size: 0.82rem;
  color: #64748b;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-row-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #475569;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.15s ease;
}

.btn-row-action:hover {
  background: #f1f5f9;
  color: #0f172a;
}

.btn-row-action--danger:hover {
  background: #fee2e2;
  color: #dc2626;
  border-color: #fca5a5;
}

/* Preview Modal */
.preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 23, 42, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.preview-modal {
  width: 100%;
  max-width: 800px;
  max-height: 85vh;
  background: #ffffff;
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid #e2e8f0;
}

.preview-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #1e293b;
}

.preview-close-btn {
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
}

.preview-body {
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: #0f172a;
}

.preview-img {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
}

.preview-iframe {
  width: 100%;
  height: 70vh;
  border: none;
}
</style>
