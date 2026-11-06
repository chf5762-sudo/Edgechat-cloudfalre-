<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  AlertCircle,
  Camera,
  Check,
  ChevronDown,
  Copy,
  Download,
  Info,
  X
} from '@lucide/vue';
import { useScreenCapture } from '../../composables/useScreenCapture.ts';
import { useI18n } from '../../i18n.js';

const { t } = useI18n();
const {
  showPreview,
  previewUrl,
  copiedToClipboard,
  toastNotice,
  downloadScreenshot,
  copyScreenshotAgain,
  closePreview,
  clearToast,
} = useScreenCapture();

const showShortcuts = ref(true);
const isHovering = ref(false);
const autoDismissRemaining = ref(20);
let dismissInterval = null;

function resetTimer() {
  autoDismissRemaining.value = 20;
  if (dismissInterval) {
    clearInterval(dismissInterval);
    dismissInterval = null;
  }
}

watch(showPreview, (visible) => {
  if (visible) {
    resetTimer();
    dismissInterval = setInterval(() => {
      if (!isHovering.value) {
        autoDismissRemaining.value -= 1;
        if (autoDismissRemaining.value <= 0) {
          closePreview();
        }
      }
    }, 1000);
  } else {
    resetTimer();
  }
});

onBeforeUnmount(() => {
  if (dismissInterval) {
    clearInterval(dismissInterval);
    dismissInterval = null;
  }
});

function handleDownload() {
  downloadScreenshot();
}

async function handleCopy() {
  await copyScreenshotAgain();
}
</script>

<template>
  <Teleport to="body">
    <!-- Toast Notice -->
    <Transition name="capture-toast-fade">
      <div
        v-if="toastNotice"
        class="capture-toast-container"
        :class="`capture-toast--${toastNotice.type}`"
        role="alert"
      >
        <div class="capture-toast-content">
          <Check v-if="toastNotice.type === 'success'" :size="18" class="capture-toast-icon" />
          <AlertCircle v-else-if="toastNotice.type === 'warning' || toastNotice.type === 'error'" :size="18" class="capture-toast-icon" />
          <Info v-else :size="18" class="capture-toast-icon" />
          <span class="capture-toast-text">{{ toastNotice.message }}</span>
        </div>
        <button
          type="button"
          class="capture-toast-close"
          :aria-label="t('common.close') || '关闭'"
          @click="clearToast"
        >
          <X :size="16" />
        </button>
      </div>
    </Transition>

    <!-- Preview Dock (Right Bottom Floating Card) -->
    <Transition name="capture-dock-slide">
      <div
        v-if="showPreview && previewUrl"
        class="capture-preview-dock"
        @mouseenter="isHovering = true"
        @mouseleave="isHovering = false"
      >
        <!-- Header -->
        <div class="capture-dock-header">
          <div class="capture-dock-title-group">
            <span class="capture-dock-badge">
              <Camera :size="16" />
            </span>
            <div class="capture-dock-text">
              <h3 class="capture-dock-title">{{ t('capture.ready') || '截图已生成' }}</h3>
              <span class="capture-dock-subtitle">
                {{ isHovering ? '倒计时已暂停' : `${autoDismissRemaining}s 后自动关闭` }}
              </span>
            </div>
          </div>
          <button
            type="button"
            class="capture-dock-close-btn"
            :aria-label="t('common.close') || '关闭'"
            @click="closePreview"
          >
            <X :size="18" />
          </button>
        </div>

        <!-- Clipboard status banner -->
        <div
          class="capture-status-banner"
          :class="{
            'capture-status-banner--success': copiedToClipboard,
            'capture-status-banner--info': !copiedToClipboard
          }"
        >
          <template v-if="copiedToClipboard">
            <Check :size="16" class="status-banner-icon" />
            <span>{{ t('capture.copied') || '已自动复制到剪贴板，可直接在输入框 Ctrl+V 粘贴' }}</span>
          </template>
          <template v-else>
            <Info :size="16" class="status-banner-icon" />
            <span>{{ t('capture.copyFailed') || '截图已就绪，可一键下载或重新复制' }}</span>
          </template>
        </div>

        <!-- Thumbnail Image -->
        <div class="capture-dock-body">
          <div class="capture-image-frame">
            <img :src="previewUrl" alt="截图预览" class="capture-preview-image" />
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="capture-dock-actions">
          <button
            type="button"
            class="capture-dock-btn capture-dock-btn--primary"
            @click="handleDownload"
          >
            <Download :size="16" />
            <span>{{ t('capture.download') || '一键下载图片' }}</span>
          </button>
          <button
            type="button"
            class="capture-dock-btn capture-dock-btn--secondary"
            @click="handleCopy"
          >
            <Copy :size="16" />
            <span>{{ t('capture.copy') || '复制到剪贴板' }}</span>
          </button>
        </div>

        <!-- Native Shortcut Guide (Collapsible) -->
        <div class="capture-shortcut-guide">
          <button
            type="button"
            class="capture-shortcut-toggle"
            :aria-expanded="showShortcuts"
            @click="showShortcuts = !showShortcuts"
          >
            <span class="shortcut-toggle-text">{{ t('capture.shortcutsTitle') || '系统与浏览器原生截图推荐' }}</span>
            <ChevronDown
              :size="15"
              class="shortcut-toggle-arrow"
              :class="{ 'shortcut-toggle-arrow--open': showShortcuts }"
            />
          </button>
          <div v-show="showShortcuts" class="capture-shortcut-list">
            <div class="shortcut-item">
              <span class="shortcut-label">Windows 自带截图</span>
              <span class="shortcut-keys"><kbd>Win</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd></span>
            </div>
            <div class="shortcut-item">
              <span class="shortcut-label">Edge 浏览器捕获</span>
              <span class="shortcut-keys"><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd></span>
            </div>
            <div class="shortcut-item">
              <span class="shortcut-label">macOS 区域截图</span>
              <span class="shortcut-keys"><kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>4</kbd></span>
            </div>
            <div class="shortcut-item">
              <span class="shortcut-label">Chrome 开发者截图</span>
              <span class="shortcut-keys"><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd></span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ─── Toast Notice ──────────────────────────────────────────────────────── */
.capture-toast-container {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 300px;
  max-width: 480px;
  padding: 12px 16px;
  border-radius: 12px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  font-size: 13.5px;
  line-height: 1.4;
}

.capture-toast--info {
  background: var(--chat-paper, #ffffff);
  border: 1px solid var(--chat-line, #e2e8f0);
  color: var(--chat-ink, #0f172a);
}

.capture-toast--success {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
}

.capture-toast--warning {
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
}

.capture-toast--error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

.capture-toast-content {
  display: flex;
  align-items: center;
  gap: 10px;
}

.capture-toast-icon {
  flex-shrink: 0;
}

.capture-toast-text {
  font-weight: 500;
}

.capture-toast-close {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: inherit;
  opacity: 0.7;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  transition: opacity 150ms;
}

.capture-toast-close:hover {
  opacity: 1;
}

/* ─── Preview Dock ──────────────────────────────────────────────────────── */
.capture-preview-dock {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 99999;
  width: 400px;
  max-width: calc(100vw - 32px);
  background: var(--chat-paper, #ffffff);
  border: 1px solid var(--chat-line, rgba(0, 0, 0, 0.12));
  border-radius: 16px;
  box-shadow: 0 16px 40px -8px rgba(0, 0, 0, 0.22), 0 0 0 1px rgba(0, 0, 0, 0.05);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.capture-dock-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 12px;
  border-bottom: 1px solid var(--chat-line, #f1f5f9);
}

.capture-dock-title-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.capture-dock-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--chat-accent, #10b981);
  color: #ffffff;
}

.capture-dock-text {
  display: flex;
  flex-direction: column;
}

.capture-dock-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--chat-ink, #0f172a);
}

.capture-dock-subtitle {
  font-size: 11.5px;
  color: var(--chat-muted, #64748b);
}

.capture-dock-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--chat-muted, #64748b);
  cursor: pointer;
  transition: background 150ms, color 150ms;
}

.capture-dock-close-btn:hover {
  background: var(--chat-hover, #f1f5f9);
  color: var(--chat-ink, #0f172a);
}

/* ─── Status Banner ─────────────────────────────────────────────────────── */
.capture-status-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.4;
}

.capture-status-banner--success {
  background: #f0fdf4;
  color: #15803d;
  border-bottom: 1px solid #dcfce7;
}

.capture-status-banner--info {
  background: #f8fafc;
  color: #475569;
  border-bottom: 1px solid #e2e8f0;
}

.status-banner-icon {
  flex-shrink: 0;
}

/* ─── Preview Body ──────────────────────────────────────────────────────── */
.capture-dock-body {
  padding: 14px 18px 10px;
}

.capture-image-frame {
  position: relative;
  width: 100%;
  max-height: 190px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--chat-line, #e2e8f0);
  background: #090d16;
  display: flex;
  align-items: center;
  justify-content: center;
}

.capture-preview-image {
  max-width: 100%;
  max-height: 190px;
  object-fit: contain;
  display: block;
}

/* ─── Action Buttons ────────────────────────────────────────────────────── */
.capture-dock-actions {
  display: flex;
  gap: 10px;
  padding: 6px 18px 12px;
}

.capture-dock-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 9px 12px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms ease;
}

.capture-dock-btn--primary {
  background: var(--chat-accent, #10b981);
  color: #ffffff;
  border: 1px solid transparent;
}

.capture-dock-btn--primary:hover {
  background: var(--chat-accent-hover, #059669);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

.capture-dock-btn--secondary {
  background: var(--chat-paper, #ffffff);
  border: 1px solid var(--chat-line, #cbd5e1);
  color: var(--chat-ink, #1e293b);
}

.capture-dock-btn--secondary:hover {
  background: var(--chat-hover, #f1f5f9);
  border-color: var(--chat-muted, #94a3b8);
}

/* ─── Shortcut Guide ────────────────────────────────────────────────────── */
.capture-shortcut-guide {
  padding: 8px 18px 14px;
  background: var(--chat-canvas, #f8fafc);
  border-top: 1px solid var(--chat-line, #e2e8f0);
}

.capture-shortcut-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: none;
  background: transparent;
  padding: 4px 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--chat-muted, #64748b);
  cursor: pointer;
}

.capture-shortcut-toggle:hover {
  color: var(--chat-ink, #0f172a);
}

.shortcut-toggle-arrow {
  transition: transform 180ms ease;
}

.shortcut-toggle-arrow--open {
  transform: rotate(180deg);
}

.capture-shortcut-list {
  display: grid;
  gap: 6px;
  margin-top: 8px;
}

.shortcut-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--chat-muted, #64748b);
}

.shortcut-label {
  font-weight: 500;
}

.shortcut-keys kbd {
  display: inline-block;
  padding: 2px 6px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  color: var(--chat-ink, #1e293b);
  background: var(--chat-paper, #ffffff);
  border: 1px solid var(--chat-line, #cbd5e1);
  border-radius: 4px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

/* ─── Animations ────────────────────────────────────────────────────────── */
.capture-dock-slide-enter-active,
.capture-dock-slide-leave-active {
  transition: all 260ms cubic-bezier(0.16, 1, 0.3, 1);
}

.capture-dock-slide-enter-from,
.capture-dock-slide-leave-to {
  opacity: 0;
  transform: translateY(20px) scale(0.96);
}

.capture-toast-fade-enter-active,
.capture-toast-fade-leave-active {
  transition: all 220ms ease;
}

.capture-toast-fade-enter-from,
.capture-toast-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

@media (max-width: 600px) {
  .capture-preview-dock {
    right: 12px;
    bottom: 12px;
    width: calc(100vw - 24px);
  }
}
</style>
