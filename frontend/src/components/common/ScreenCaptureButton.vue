<script setup>
import { Camera } from '@lucide/vue';
import { useScreenCapture } from '../../composables/useScreenCapture.ts';
import { useI18n } from '../../i18n.js';

const props = defineProps({
  variant: {
    type: String,
    default: 'header', // 'header' | 'floating' | 'storage'
    validator: (v) => ['header', 'floating', 'storage'].includes(v),
  },
});

const { t } = useI18n();
const { isCapturing, startCapture } = useScreenCapture();

function handleClick() {
  void startCapture();
}
</script>

<template>
  <!-- Variant 1: Chat Header or Chat Empty Top Actions -->
  <button
    v-if="variant === 'header'"
    type="button"
    class="chat-header__button screen-capture-header-btn"
    :class="{ 'chat-header__button--active': isCapturing }"
    :title="t('capture.title') || '截屏 (自动复制到剪贴板)'"
    :aria-label="t('capture.title') || '截屏'"
    :aria-busy="isCapturing"
    :disabled="isCapturing"
    @click="handleClick"
  >
    <Camera :size="19" aria-hidden="true" />
    <span>{{ t('capture.button') || '截屏' }}</span>
  </button>

  <!-- Variant 2: Embedded Container Floating Top-Right (Canvas / Notes) -->
  <button
    v-else-if="variant === 'floating'"
    type="button"
    class="embedded-floating-capture-btn"
    :class="{ 'embedded-floating-capture-btn--capturing': isCapturing }"
    :title="t('capture.title') || '截屏 (自动复制到剪贴板)'"
    :aria-label="t('capture.title') || '截屏'"
    :aria-busy="isCapturing"
    :disabled="isCapturing"
    @click="handleClick"
  >
    <Camera :size="17" aria-hidden="true" />
    <span class="floating-btn-text">{{ t('capture.button') || '截屏' }}</span>
  </button>

  <!-- Variant 3: Storage Workspace Top Toolbar -->
  <button
    v-else-if="variant === 'storage'"
    type="button"
    class="btn-secondary screen-capture-storage-btn"
    :class="{ 'screen-capture-storage-btn--capturing': isCapturing }"
    :title="t('capture.title') || '截屏 (自动复制到剪贴板)'"
    :aria-label="t('capture.title') || '截屏'"
    :aria-busy="isCapturing"
    :disabled="isCapturing"
    @click="handleClick"
  >
    <Camera :size="15" aria-hidden="true" />
    <span>{{ t('capture.button') || '截屏' }}</span>
  </button>
</template>

<style scoped>
/* ─── Floating Top-Right Button for Embedded Views (Canvas / Notes) ──────── */
.embedded-floating-capture-btn {
  position: absolute;
  top: 12px;
  right: 16px;
  z-index: 30;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 14px;
  border-radius: 20px;
  border: 1px solid var(--chat-line, rgba(0, 0, 0, 0.1));
  background: var(--chat-paper, rgba(255, 255, 255, 0.94));
  color: var(--chat-ink, #1e293b);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.12);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 180ms ease;
  user-select: none;
}

.embedded-floating-capture-btn:hover {
  background: var(--chat-hover, #f1f5f9);
  border-color: var(--chat-accent, #10b981);
  color: var(--chat-accent, #10b981);
  transform: translateY(-1px);
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.15);
}

.embedded-floating-capture-btn:active {
  transform: translateY(0);
}

.embedded-floating-capture-btn--capturing {
  opacity: 0.7;
  cursor: wait;
}

/* ─── Storage Workspace Toolbar Button ──────────────────────────────────── */
.screen-capture-storage-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all 150ms ease;
}

.screen-capture-storage-btn:hover {
  color: var(--chat-accent, #10b981);
}

.screen-capture-storage-btn--capturing {
  opacity: 0.6;
  cursor: wait;
}

@media (max-width: 600px) {
  .embedded-floating-capture-btn {
    top: 10px;
    right: 10px;
    height: 36px;
    padding: 0 10px;
  }
  .floating-btn-text {
    display: none;
  }
}
</style>
