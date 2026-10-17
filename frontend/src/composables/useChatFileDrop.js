import { onBeforeUnmount, onMounted, ref } from 'vue';

export function useChatFileDrop({ onDrop, disabled }) {
  const isDragging = ref(false);
  let dragCounter = 0;

  function hasFiles(event) {
    if (!event.dataTransfer) return false;
    const types = Array.from(event.dataTransfer.types || []);
    return types.includes('Files');
  }

  function handleDragEnter(event) {
    event.preventDefault();
    if (disabled?.value) return;
    if (!hasFiles(event)) return;

    dragCounter++;
    isDragging.value = true;
  }

  function handleDragOver(event) {
    event.preventDefault();
    if (disabled?.value) {
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'none';
      }
      return;
    }
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  function handleDragLeave(event) {
    event.preventDefault();
    if (disabled?.value) {
      isDragging.value = false;
      dragCounter = 0;
      return;
    }

    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) {
      isDragging.value = false;
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    dragCounter = 0;
    isDragging.value = false;

    if (disabled?.value) return;
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length && typeof onDrop === 'function') {
      onDrop(files);
    }
  }

  function handleGlobalPrevent(event) {
    // 防止用户拖拽文件在非可释放区域松开时浏览器默认跳转打开文件
    event.preventDefault();
  }

  onMounted(() => {
    window.addEventListener('dragover', handleGlobalPrevent, false);
    window.addEventListener('drop', handleGlobalPrevent, false);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('dragover', handleGlobalPrevent, false);
    window.removeEventListener('drop', handleGlobalPrevent, false);
  });

  return {
    isDragging,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop
  };
}