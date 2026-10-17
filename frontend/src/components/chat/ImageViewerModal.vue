<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Download, Maximize2, Minimize2, MoreHorizontal, Printer, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from '@lucide/vue';
import { printMedia } from '../../utils/media-printer.js';
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

const moreMenuOpen = ref(false);
const moreMenuRef = ref(null);

function toggleMoreMenu() {
  moreMenuOpen.value = !moreMenuOpen.value;
}

function closeMoreMenu() {
  moreMenuOpen.value = false;
}

function handleMenuAction(action) {
  closeMoreMenu();
  action();
}

function handleClickOutside(event) {
  if (moreMenuOpen.value && moreMenuRef.value && !moreMenuRef.value.contains(event.target)) {
    closeMoreMenu();
  }
}


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

function handlePrint() {
  printMedia({ url: props.src, filename: displayName.value, isPdf: false });
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
  }   else if ((event.ctrlKey || event.metaKey) && event.key === 'p') {
    event.preventDefault();
    handlePrint();
  } else if (event.key === 'p' || event.key === 'P') {
    event.preventDefault();
    handlePrint();
  } else if (event.key === 'f' || event.key === 'F') {
    event.preventDefault();
    toggleFullscreen();
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    resetTransform();
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('pointerdown', handleClickOutside);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
  } else {
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('pointerdown', handleClickOutside);
    closeMoreMenu();
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('pointerdown', handleClickOutside);
    closeMoreMenu();
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

          <!-- 更多二级功能菜单 -->
          <div ref="moreMenuRef" class="fullscreen-image-viewer__menu-wrapper">
            <button
              type="button"
              class="fullscreen-image-viewer__btn"
              :class="{ 'fullscreen-image-viewer__btn--active': moreMenuOpen }"
              title="更多操作"
              aria-label="更多操作"
              :aria-expanded="moreMenuOpen"
              @click="toggleMoreMenu"
            >
              <MoreHorizontal :size="18" />
            </button>

            <div v-if="moreMenuOpen" class="fullscreen-image-viewer__dropdown" role="menu">
              <button
                type="button"
                class="fullscreen-image-viewer__menu-item"
                role="menuitem"
                @click="handleMenuAction(zoomIn)"
              >
                <ZoomIn :size="16" />
                <span class="fullscreen-image-viewer__menu-label">放大</span>
                <span class="fullscreen-image-viewer__menu-shortcut">+</span>
              </button>

              <button
                type="button"
                class="fullscreen-image-viewer__menu-item"
                role="menuitem"
                @click="handleMenuAction(zoomOut)"
              >
                <ZoomOut :size="16" />
                <span class="fullscreen-image-viewer__menu-label">缩小</span>
                <span class="fullscreen-image-viewer__menu-shortcut">-</span>
              </button>

              <button
                type="button"
                class="fullscreen-image-viewer__menu-item"
                role="menuitem"
                @click="handleMenuAction(resetTransform)"
              >
                <RotateCcw :size="16" />
                <span class="fullscreen-image-viewer__menu-label">自适应居中</span>
                <span class="fullscreen-image-viewer__menu-shortcut">0</span>
              </button>

              <div class="fullscreen-image-viewer__menu-divider" role="separator"></div>

              <button
                type="button"
                class="fullscreen-image-viewer__menu-item"
                role="menuitem"
                @click="handleMenuAction(handlePrint)"
              >
                <Printer :size="16" />
                <span class="fullscreen-image-viewer__menu-label">打印图片</span>
                <span class="fullscreen-image-viewer__menu-shortcut">P</span>
              </button>

              <button
                type="button"
                class="fullscreen-image-viewer__menu-item"
                role="menuitem"
                @click="handleMenuAction(downloadImage)"
              >
                <Download :size="16" />
                <span class="fullscreen-image-viewer__menu-label">下载原图</span>
              </button>
            </div>
          </div>

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
  gap: 12px;
  padding: max(14px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) 14px max(20px, env(safe-area-inset-left));
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.8) 0%, rgba(0, 0, 0, 0) 100%);
  pointer-events: none;
  flex-wrap: nowrap;
}

.fullscreen-image-viewer__info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
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
  flex-shrink: 0;
}

.fullscreen-image-viewer__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  pointer-events: auto;
  background: rgba(25, 30, 36, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 9999px;
  padding: 4px 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  flex-shrink: 0;
  margin-left: auto;
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
    padding: max(10px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) 10px max(10px, env(safe-area-inset-left));
    gap: 8px;
    flex-wrap: nowrap;
  }
  .fullscreen-image-viewer__info {
    gap: 6px;
    flex: 1 1 0%;
    min-width: 0;
    overflow: hidden;
  }
  .fullscreen-image-viewer__title {
    max-width: none;
    font-size: 13px;
    min-width: 0;
    flex-shrink: 1;
  }
  .fullscreen-image-viewer__scale-tag {
    font-size: 10px;
    padding: 1px 5px;
    flex-shrink: 0;
  }
  .fullscreen-image-viewer__actions {
    gap: 2px;
    padding: 2px 4px;
    flex-shrink: 0;
    margin-left: auto;
  }
  .fullscreen-image-viewer__btn {
    width: 30px;
    height: 30px;
  }
  .fullscreen-image-viewer__hint {
    display: none;
  }
}

.fullscreen-image-viewer__menu-wrapper {
  position: relative;
  display: inline-flex;
}

.fullscreen-image-viewer__btn--active {
  background: rgba(255, 255, 255, 0.28) !important;
  color: #fff !important;
}

.fullscreen-image-viewer__dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 176px;
  padding: 6px;
  background: rgba(26, 32, 44, 0.94);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 12px;
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 100;
  animation: viewer-menu-in 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes viewer-menu-in {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.fullscreen-image-viewer__menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #e2e8f0;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: all 0.14s ease;
}

.fullscreen-image-viewer__menu-item:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #ffffff;
}

.fullscreen-image-viewer__menu-label {
  flex: 1;
  white-space: nowrap;
}

.fullscreen-image-viewer__menu-shortcut {
  font-size: 11px;
  color: #94a3b8;
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-family: ui-monospace, monospace;
}

.fullscreen-image-viewer__menu-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 4px 6px;
}

</style>