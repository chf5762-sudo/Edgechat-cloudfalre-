<script setup>
import { computed, ref, toRef } from 'vue';
import { ChevronDown, ChevronUp, GripVertical, RotateCcw, X } from '@lucide/vue';
import { useOverlayLifecycle } from '../../composables/useOverlayLifecycle.js';
import { useI18n } from '../../i18n.js';

const props = defineProps({
  show: { type: Boolean, default: false },
  menuItems: { type: Array, default: () => [] }
});

const emit = defineEmits(['close', 'toggle', 'reorder', 'reset']);

const { t } = useI18n();
const dialogRef = ref(null);
const closeButtonRef = ref(null);

useOverlayLifecycle({
  open: toRef(props, 'show'),
  onClose: () => emit('close'),
  focusTarget: closeButtonRef,
  container: dialogRef,
  restoreFocus: true
});

const draggedIndex = ref(null);
const dragOverIndex = ref(null);

function moveItem(index, direction) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= props.menuItems.length) return;
  const list = props.menuItems.map(item => ({ id: item.id, visible: item.visible }));
  const [moved] = list.splice(index, 1);
  list.splice(targetIndex, 0, moved);
  emit('reorder', list);
}

function onDragStart(event, index) {
  draggedIndex.value = index;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(index));
}

function onDragOver(event, index) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  if (draggedIndex.value !== null && draggedIndex.value !== index) {
    dragOverIndex.value = index;
  }
}

function onDrop(event, index) {
  event.preventDefault();
  if (draggedIndex.value !== null && draggedIndex.value !== index) {
    const list = props.menuItems.map(item => ({ id: item.id, visible: item.visible }));
    const [moved] = list.splice(draggedIndex.value, 1);
    list.splice(index, 0, moved);
    emit('reorder', list);
  }
  draggedIndex.value = null;
  dragOverIndex.value = null;
}

function onDragEnd() {
  draggedIndex.value = null;
  dragOverIndex.value = null;
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sidebar-customizer-fade">
      <div v-if="show" class="sidebar-customizer-backdrop" @click.self="emit('close')">
        <section
          ref="dialogRef"
          class="sidebar-customizer-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sidebar-customizer-title"
          tabindex="-1"
        >
          <header class="sidebar-customizer-header">
            <div>
              <h2 id="sidebar-customizer-title">{{ t('nav.menuCustomizerTitle') }}</h2>
              <p class="sidebar-customizer-subtitle">{{ t('nav.menuCustomizerHint') }}</p>
            </div>
            <button
              ref="closeButtonRef"
              type="button"
              class="sidebar-customizer-close"
              :aria-label="t('common.close')"
              @click="emit('close')"
            >
              <X :size="20" aria-hidden="true" />
            </button>
          </header>

          <div class="sidebar-customizer-body">
            <ul class="sidebar-customizer-list">
              <li
                v-for="(item, index) in menuItems"
                :key="item.id"
                class="sidebar-customizer-item"
                :class="{
                  'sidebar-customizer-item--dragging': draggedIndex === index,
                  'sidebar-customizer-item--drag-over': dragOverIndex === index
                }"
                draggable="true"
                @dragstart="onDragStart($event, index)"
                @dragover="onDragOver($event, index)"
                @drop="onDrop($event, index)"
                @dragend="onDragEnd"
              >
                <div class="sidebar-customizer-item__left">
                  <span class="sidebar-customizer-handle" :title="t('nav.customizeMenu')">
                    <GripVertical :size="16" aria-hidden="true" />
                  </span>
                  <div class="sidebar-customizer-item__icon">
                    <component :is="item.icon" v-if="item.icon" :size="18" aria-hidden="true" />
                    <svg
                      v-else-if="item.id === 'admin'"
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                    >
                      <rect x="3" y="3" width="7" height="7" />
                      <rect x="14" y="3" width="7" height="7" />
                      <rect x="3" y="14" width="7" height="7" />
                      <rect x="14" y="14" width="7" height="7" />
                    </svg>
                  </div>
                  <span class="sidebar-customizer-item__label">{{ item.label }}</span>
                </div>

                <div class="sidebar-customizer-item__actions">
                  <div class="sidebar-customizer-reorder-btns">
                    <button
                      type="button"
                      class="sidebar-customizer-arrow-btn"
                      :disabled="index === 0"
                      :title="t('nav.moveUp')"
                      :aria-label="t('nav.moveUp')"
                      @click="moveItem(index, -1)"
                    >
                      <ChevronUp :size="16" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="sidebar-customizer-arrow-btn"
                      :disabled="index === menuItems.length - 1"
                      :title="t('nav.moveDown')"
                      :aria-label="t('nav.moveDown')"
                      @click="moveItem(index, 1)"
                    >
                      <ChevronDown :size="16" aria-hidden="true" />
                    </button>
                  </div>

                  <label class="sidebar-customizer-switch">
                    <input
                      type="checkbox"
                      :checked="item.visible"
                      @change="emit('toggle', item.id)"
                    />
                    <span class="sidebar-customizer-switch__slider"></span>
                  </label>
                </div>
              </li>
            </ul>
          </div>

          <footer class="sidebar-customizer-footer">
            <button
              type="button"
              class="sidebar-customizer-reset-btn"
              @click="emit('reset')"
            >
              <RotateCcw :size="15" aria-hidden="true" />
              <span>{{ t('nav.resetMenu') }}</span>
            </button>
            <button
              type="button"
              class="sidebar-customizer-done-btn"
              @click="emit('close')"
            >
              {{ t('common.close') }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sidebar-customizer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.sidebar-customizer-dialog {
  width: 100%;
  max-width: 440px;
  max-height: calc(100dvh - 48px);
  display: flex;
  flex-direction: column;
  border-radius: 20px;
  background: #ffffff;
  box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.06);
  overflow: hidden;
  outline: none;
}

.sidebar-customizer-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.sidebar-customizer-header h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: #1e293b;
}

.sidebar-customizer-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.45;
}

.sidebar-customizer-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  transition: all 0.15s ease;
}

.sidebar-customizer-close:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #1e293b;
}

.sidebar-customizer-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.sidebar-customizer-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sidebar-customizer-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid rgba(0, 0, 0, 0.05);
  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
  user-select: none;
}

.sidebar-customizer-item:hover {
  background: #f1f5f9;
  border-color: rgba(0, 0, 0, 0.08);
}

.sidebar-customizer-item--dragging {
  opacity: 0.45;
  transform: scale(0.98);
}

.sidebar-customizer-item--drag-over {
  border-color: #3b82f6;
  background: #eff6ff;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
}

.sidebar-customizer-item__left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.sidebar-customizer-handle {
  display: inline-flex;
  align-items: center;
  color: #94a3b8;
  cursor: grab;
  touch-action: none;
}

.sidebar-customizer-handle:hover {
  color: #475569;
}

.sidebar-customizer-item__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #ffffff;
  color: #3b82f6;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  flex-shrink: 0;
}

.sidebar-customizer-item__label {
  font-size: 14px;
  font-weight: 500;
  color: #334155;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-customizer-item__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.sidebar-customizer-reorder-btns {
  display: flex;
  align-items: center;
  gap: 2px;
}

.sidebar-customizer-arrow-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  transition: all 0.15s ease;
}

.sidebar-customizer-arrow-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.06);
  color: #1e293b;
}

.sidebar-customizer-arrow-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* Switch */
.sidebar-customizer-switch {
  position: relative;
  display: inline-block;
  width: 42px;
  height: 24px;
  flex-shrink: 0;
  cursor: pointer;
}

.sidebar-customizer-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.sidebar-customizer-switch__slider {
  position: absolute;
  inset: 0;
  background: #cbd5e1;
  border-radius: 999px;
  transition: all 0.25s cubic-bezier(0.2, 0, 0, 1);
}

.sidebar-customizer-switch__slider::before {
  content: "";
  position: absolute;
  left: 3px;
  top: 3px;
  height: 18px;
  width: 18px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.25s cubic-bezier(0.2, 0, 0, 1);
}

.sidebar-customizer-switch input:checked + .sidebar-customizer-switch__slider {
  background: #3b82f6;
}

.sidebar-customizer-switch input:checked + .sidebar-customizer-switch__slider::before {
  transform: translateX(18px);
}

.sidebar-customizer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  background: #f8fafc;
}

.sidebar-customizer-reset-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  background: #ffffff;
  color: #64748b;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.sidebar-customizer-reset-btn:hover {
  background: #f1f5f9;
  color: #334155;
  border-color: rgba(0, 0, 0, 0.12);
}

.sidebar-customizer-done-btn {
  padding: 8px 18px;
  border: none;
  border-radius: 8px;
  background: #3b82f6;
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  box-shadow: 0 1px 2px rgba(59, 130, 246, 0.2);
}

.sidebar-customizer-done-btn:hover {
  background: #2563eb;
}

/* Animations */
.sidebar-customizer-fade-enter-active,
.sidebar-customizer-fade-leave-active {
  transition: opacity 0.2s ease;
}

.sidebar-customizer-fade-enter-active .sidebar-customizer-dialog,
.sidebar-customizer-fade-leave-active .sidebar-customizer-dialog {
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}

.sidebar-customizer-fade-enter-from,
.sidebar-customizer-fade-leave-to {
  opacity: 0;
}

.sidebar-customizer-fade-enter-from .sidebar-customizer-dialog {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}

.sidebar-customizer-fade-leave-to .sidebar-customizer-dialog {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}
</style>
