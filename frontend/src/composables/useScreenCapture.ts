import { ref } from 'vue';

export interface ToastNotice {
  id: number;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

// Module-level singleton state so multiple trigger buttons and the preview dock share identical state
const isCapturing = ref(false);
const showPreview = ref(false);
const previewUrl = ref<string | null>(null);
const capturedBlob = ref<Blob | null>(null);
const copiedToClipboard = ref(false);
const toastNotice = ref<ToastNotice | null>(null);

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string, type: ToastNotice['type'] = 'info', duration = 4000) {
  if (toastTimer) clearTimeout(toastTimer);
  toastNotice.value = {
    id: Date.now(),
    message,
    type,
  };
  toastTimer = setTimeout(() => {
    toastNotice.value = null;
    toastTimer = null;
  }, duration);
}

function clearToast() {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastNotice.value = null;
}

/**
 * Triggers browser display capture (getDisplayMedia), captures a high-resolution frame,
 * converts it to a PNG Blob, writes it to the system clipboard, and opens the preview modal.
 */
async function startCapture(): Promise<boolean> {
  if (isCapturing.value) return false;

  // Environment check: getDisplayMedia must be supported
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getDisplayMedia !== 'function'
  ) {
    showToast(
      '当前环境不支持浏览器屏幕捕获接口，请使用系统截图快捷键（如 Win+Shift+S）',
      'warning',
      6000
    );
    return false;
  }

  isCapturing.value = true;
  let stream: MediaStream | null = null;

  try {
    const displayOptions = {
      video: {
        displaySurface: 'browser',
      },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      systemAudio: 'exclude',
      surfaceSwitching: 'include',
    };

    try {
      stream = await navigator.mediaDevices.getDisplayMedia(displayOptions as unknown as MediaStreamConstraints);
    } catch (optErr: unknown) {
      const errorObj = optErr as { name?: string };
      // If browser doesn't support advanced displayMedia constraints, fallback to basic options
      if (errorObj?.name === 'TypeError' || errorObj?.name === 'OverconstrainedError') {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      } else {
        throw optErr;
      }
    }

    if (!stream) {
      isCapturing.value = false;
      return false;
    }

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      isCapturing.value = false;
      return false;
    }

    // Render frame to canvas via offscreen video
    const video = document.createElement('video');
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => {
        video.play().then(() => resolve()).catch(reject);
      };
      if (video.readyState >= 1) {
        video.play().then(() => resolve()).catch(reject);
      }
      setTimeout(() => resolve(), 1200); // Safety timeout
    });

    // Brief delay to ensure frame is painted
    await new Promise((r) => setTimeout(r, 120));

    const width = video.videoWidth || window.innerWidth;
    const height = video.videoHeight || window.innerHeight;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable');
    }

    ctx.drawImage(video, 0, 0, width, height);

    // Stop all media tracks immediately so browser sharing indicator disappears
    videoTrack.stop();
    for (const track of stream.getTracks()) {
      track.stop();
    }
    video.srcObject = null;

    // Convert canvas to PNG blob
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png');
    });

    if (!blob) {
      throw new Error('Failed to encode screenshot blob');
    }

    // Try automatic copy to system clipboard
    let copied = false;
    if (navigator.clipboard && typeof window.ClipboardItem !== 'undefined') {
      try {
        const item = new ClipboardItem({ 'image/png': blob });
        await navigator.clipboard.write([item]);
        copied = true;
      } catch (clipboardErr) {
        console.warn('[useScreenCapture] Automatic clipboard write prevented:', clipboardErr);
        copied = false;
      }
    }

    // Clean up previous preview URL to avoid memory leak
    if (previewUrl.value) {
      URL.revokeObjectURL(previewUrl.value);
    }

    capturedBlob.value = blob;
    previewUrl.value = URL.createObjectURL(blob);
    copiedToClipboard.value = copied;
    showPreview.value = true;

    return true;
  } catch (err: unknown) {
    const errorObj = err as { name?: string; message?: string };
    // If user cancelled selection, do not throw or display scary error
    if (errorObj?.name === 'NotAllowedError' || errorObj?.name === 'AbortError') {
      return false;
    }

    console.error('[useScreenCapture] Capture error:', err);
    showToast(`截屏失败: ${errorObj?.message || '未知错误'}`, 'error');
    return false;
  } finally {
    isCapturing.value = false;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
  }
}

/**
 * Triggers instant download of the captured screenshot PNG file.
 */
function downloadScreenshot() {
  if (!capturedBlob.value) return;

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const filename = `edgechat-screenshot-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate()
  )}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;

  const downloadUrl = URL.createObjectURL(capturedBlob.value);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}

/**
 * Re-copies the captured image to system clipboard upon explicit user action.
 */
async function copyScreenshotAgain(): Promise<boolean> {
  if (!capturedBlob.value) return false;

  if (navigator.clipboard && typeof window.ClipboardItem !== 'undefined') {
    try {
      const item = new ClipboardItem({ 'image/png': capturedBlob.value });
      await navigator.clipboard.write([item]);
      copiedToClipboard.value = true;
      showToast('已成功复制到剪贴板！可直接在输入框 Ctrl+V 粘贴', 'success');
      return true;
    } catch (err: unknown) {
      console.warn('[useScreenCapture] Manual copy failed:', err);
      showToast('复制到剪贴板失败，请使用一键下载功能', 'error');
      return false;
    }
  }
  showToast('当前浏览器不支持剪贴板写入图片', 'warning');
  return false;
}

/**
 * Closes the preview dock and frees memory.
 */
function closePreview() {
  showPreview.value = false;
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = null;
  }
  capturedBlob.value = null;
}

export function useScreenCapture() {
  return {
    isCapturing,
    showPreview,
    previewUrl,
    capturedBlob,
    copiedToClipboard,
    toastNotice,
    startCapture,
    downloadScreenshot,
    copyScreenshotAgain,
    closePreview,
    showToast,
    clearToast,
  };
}
