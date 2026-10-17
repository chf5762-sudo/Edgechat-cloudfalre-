<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Download, Maximize2, Minimize2, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from '@lucide/vue';
import { useOverlayLifecycle } from '../../composables/useOverlayLifecycle.js';
import { t } from '../../i18n.js';

const props = defineProps({
  open: {
    type: Boolean,
    default: false
  },
  src: {
    type: String,
    required: true
  },
  name: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['close']);

const modalRef = ref(null);
const viewportRef = ref(null);
const imageRef = ref(null);

const scale = ref(1);
const translateX = ref(0);
const translateY = ref(0);
const rotation = ref(0);
const isDragging = ref(false);
const isNativeFullscreen = ref(false);

let startX = 0;
let startY = 0;

const displayName = computed(() => props.name || t('attachments.fallback'));
const zoomPercentage = computed(() => `${Math.round(scale.value * 100)}%`);

const transformStyle = computed(() => ({
  transform: `translate3d(${translateX.value}px, ${translateY.value}px, 0) scale(${scale.value}) rotate(${rotation.value}deg)`,
  transition: isDragging.value ? 'none' : 'transform 0.18s cubic-bezier(0.2, 0, 0, 1)'
}));

useOverlayLifecycle({
  open: computed(() => props.open),
  onClose: handleClose,
  focusTarget: modalRef
});

function handleClose() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  resetTransform();
  emit('close');
}

function resetTransform() {
  scale.value = 1;
  translateX.value = 0;
  translateY.value = 0;
  rotation.value = 0;
}

function zoomIn() {
  scale.value = Math.min(Math.round(scale.value * 1.3 * 100) / 100, 8);
}

function zoomOut() {
  const nextScale = Math.max(Math.round(scale.value * 0.77 * 100) / 100, 0.25);
  scale.value = nextScale;
  if (nextScale <= 1) {
    translateX.value = 0;
    translateY.value = 0;
  }
}

function rotate() {
  rotation.value = (rotation.value + 90) % 360;
}

function handleDoubleClick() {
  if (scale.value === 1) {
    scale.value = 2.2;
  } else {
    resetTransform();
  }
}

function handleWheel(event) {
  event.preventDefault();
  const delta = event.deltaY < 0 ? 1.15 : 0.87;
  const nextScale = Math.min(Math.max(Math.round(scale.value * delta * 100) / 100, 0.25), 8);
  scale.value = nextScale;
  if (nextScale <= 1) {
    translateX.value = 0;
    translateY.value = 0;
  }
}

function handlePointerDown(event) {
  if (event.button !== 0) return;
  isDragging.value = true;
  startX = event.clientX - translateX.value;
  startY = event.clientY - translateY.value;
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {}
}

function handlePointerMove(event) {
  if (!isDragging.value) return;
  translateX.value = Math.round(event.clientX - startX);
  translateY.value = Math.round(event.clientY - startY);
}

function handlePointerUp(event) {
  if (!isDragging.value) return;
  isDragging.value = false;
  try {
    event.currentTarget.releasePointerCapture(event.pointerId);
  } catch {}
  if (scale.value <= 1) {
    translateX.value = 0;
    translateY.value = 0;
  }
}

async function toggleFullscreen() {
  if (!modalRef.value) return;
  if (!document.fullscreenElement) {
    await modalRef.value.requestFullscreen().catch(() => {});
    isNativeFullscreen.value = true;
  } else {
    await document.exitFullscreen().catch(() => {});
    isNativeFullscreen.value = false;
  }
}

function handleFullscreenChange() {
  isNativeFullscreen.value = Boolean(document.fullscreenElement);
}

function downloadImage() {
  const link = document.createElement('a');
  link.href = props.src;
  link.download = displayName.value || 'image.jpg';
  link.target = '_blank';
  link.rel = 'noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function handleKeydown(event) {
  if (!props.open) return;
  if (event.key === '=' || event.key === '+') {
    event.preventDefault();
    zoomIn();
  } else if (event.key === '-' || event.key === '_') {
    event.preventDefault();
    zoomOut();
  } else if (event.key === '0') {
    event.preventDefault();
    resetTransform();
  } else if (event.key === 'r' || event.key === 'R') {
    event.preventDefault();
    rotate();
  } else if (event.key === 'f' || event.key === 'F') {
    event.preventDefault();
    toggleFullscreen();
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    resetTransform();
    window.addEventListener('keydown', handleKeydown);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
  } else {
    window.removeEventListener('keydown', handleKeydown);
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="modalRef"
      class="fullscreen-image-viewer"
      role="dialog"
      aria-modal="true"
      :aria-label="displayName"
      tabindex="-1"
    >
      <!-- 顶部浮动控制栏 -->
      <div class="fullscreen-image-viewer__header">
        <div class="fullscreen-image-viewer__info">
          <span class="fullscreen-image-viewer__title" :title="displayName">{{ displayName }}</span>
          <span class="fullscreen-image-viewer__scale-tag">{{ zoomPercentage }}</span>
        </div>

        <div class="fullscreen-image-viewer__actions">
          <button
            type="button"
            class="fullscreen-image-viewer__btn"
            title="放大 (+)"
            aria-label="放大"
            @click="zoomIn"
          >
            <ZoomIn :size="18" />
          </button>

          <button
            type="button"
            class="fullscreen-image-viewer__btn"
            title="缩小 (-)"
            aria-label="缩小"
            @click="zoomOut"
          >
            <ZoomOut :size="18" />
          </button>

          <button
            type="button"
            class="fullscreen-image-viewer__btn"
            title="重置居中自适应 (0)"
            aria-label="重置"
            @click="resetTransform"
          >
            <RotateCcw :size="18" />
          </button>

          <button
            type="button"
            class="fullscreen-image-viewer__btn"
            title="顺时针旋转90° (R)"
            aria-label="旋转"
            @click="rotate"
          >
            <RotateCw :size="18" />
          </button>

          <button
            type="button"
            class="fullscreen-image-viewer__btn"
            :title="isNativeFullscreen ? '退出全屏 (F)' : '进入全屏 (F)'"
            :aria-label="isNativeFullscreen ? '退出全屏' : '全屏'"
            @click="toggleFullscreen"
          >
            <Minimize2 v-if="isNativeFullscreen" :size="18" />
            <Maximize2 v-else :size="18" />
          </button>

          <button
            type="button"
            class="fullscreen-image-viewer__btn"
            title="下载原图"
            aria-label="下载原图"
            @click="downloadImage"
          >
            <Download :size="18" />
          </button>

          <button
            type="button"
            class="fullscreen-image-viewer__btn fullscreen-image-viewer__btn--close"
            title="关闭 (Esc)"
            aria-label="关闭"
            @click="handleClose"
          >
            <X :size="20" />
          </button>
        </div>
      </div>

      <!-- 图片全屏视口容器（居中、非拉伸展示） -->
      <div
        ref="viewportRef"
        class="fullscreen-image-viewer__viewport"
        :class="{ 'is-dragging': isDragging, 'is-zoomed': scale > 1 }"
        @wheel.passive="false"
        @wheel="handleWheel"
        @pointerdown="handlePointerDown"
        @pointermove="handlePointerMove"
        @pointerup="handlePointerUp"
        @pointercancel="handlePointerUp"
        @dblclick="handleDoubleClick"
        @click.self="handleClose"
      >
        <img
          ref="imageRef"
          class="fullscreen-image-viewer__img"
          :src="src"
          :alt="displayName"
          :style="transformStyle"
          draggable="false"
        />
      </div>

      <!-- 底部操作提示 -->
      <div class="fullscreen-image-viewer__hint">
        <span>滚轮缩放 · 双击放大/还原 · 拖拽平移 · ESC 关闭</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.fullscreen-image-viewer {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  background: rgba(8, 10, 12, 0.94);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  outline: none;
  user-select: none;
  animation: viewer-fade-in 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes viewer-fade-in {
  from {
    opacity: 0;
    backdrop-filter: blur(0px);
  }
  to {
    opacity: 1;
    backdrop-filter: blur(28px) saturate(180%);
  }
}

.fullscreen-image-viewer__header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: max(16px, env(safe-area-inset-top)) 24px 16px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.72) 0%, rgba(0, 0, 0, 0) 100%);
  pointer-events: none;
}

.fullscreen-image-viewer__info {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  pointer-events: auto;
}

.fullscreen-image-viewer__title {
  color: #fff;
  font-size: 15px;
  font-weight: 500;
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.01em;
}

.fullscreen-image-viewer__scale-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.fullscreen-image-viewer__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: auto;
  background: rgba(25, 30, 36, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 9999px;
  padding: 4px 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.fullscreen-image-viewer__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.88);
  cursor: pointer;
  transition: all 0.15s ease;
}

.fullscreen-image-viewer__btn:hover {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  transform: translateY(-1px);
}

.fullscreen-image-viewer__btn:active {
  transform: translateY(0) scale(0.95);
}

.fullscreen-image-viewer__btn--close {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.fullscreen-image-viewer__btn--close:hover {
  background: rgba(239, 68, 68, 0.85);
  color: #fff;
}

.fullscreen-image-viewer__viewport {
  flex: 1;
  width: 100%;
  height: 100%;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: zoom-in;
  touch-action: none;
}

.fullscreen-image-viewer__viewport.is-zoomed {
  cursor: grab;
}

.fullscreen-image-viewer__viewport.is-dragging {
  cursor: grabbing !important;
}

.fullscreen-image-viewer__img {
  max-width: 95vw;
  max-height: calc(100vh - 100px);
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.75);
  user-select: none;
  -webkit-user-drag: none;
  transform-origin: center center;
}

.fullscreen-image-viewer__hint {
  position: absolute;
  bottom: max(16px, env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
  padding: 6px 16px;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.65);
  font-size: 12px;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .fullscreen-image-viewer__header {
    padding: 12px 14px;
    flex-wrap: wrap;
  }
  .fullscreen-image-viewer__title {
    max-width: 180px;
    font-size: 13px;
  }
  .fullscreen-image-viewer__actions {
    gap: 4px;
    padding: 2px 4px;
  }
  .fullscreen-image-viewer__btn {
    width: 32px;
    height: 32px;
  }
  .fullscreen-image-viewer__hint {
    display: none;
  }
}
</style>