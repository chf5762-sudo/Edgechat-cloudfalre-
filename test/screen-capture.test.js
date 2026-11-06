import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
let vite;
let useScreenCapture;

before(async () => {
  vite = await createServer({
    root: projectRoot,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  ({ useScreenCapture } = await vite.ssrLoadModule('/frontend/src/composables/useScreenCapture.ts'));
});

after(async () => {
  await vite?.close();
});

test('useScreenCapture: 环境缺失 getDisplayMedia 时优雅降级并展示友好提示', async () => {
  const { startCapture, toastNotice, isCapturing } = useScreenCapture();

  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: { mediaDevices: {} },
      configurable: true,
      writable: true,
    });
    const success = await startCapture();
    assert.strictEqual(success, false);
    assert.strictEqual(isCapturing.value, false);
    assert.ok(toastNotice.value);
    assert.strictEqual(toastNotice.value.type, 'warning');
    assert.match(toastNotice.value.message, /不支持/);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor);
    }
  }
});

test('useScreenCapture: 用户取消截屏或拒绝权限时静默返回，不抛出异常', async () => {
  const { startCapture, toastNotice, isCapturing, clearToast } = useScreenCapture();
  clearToast();

  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getDisplayMedia: async () => {
            const err = new Error('Permission denied by system');
            err.name = 'NotAllowedError';
            throw err;
          },
        },
      },
      configurable: true,
      writable: true,
    });
    const success = await startCapture();
    assert.strictEqual(success, false);
    assert.strictEqual(isCapturing.value, false);
    // User cancellation should not produce an error toast
    assert.strictEqual(toastNotice.value, null);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor);
    }
  }
});

test('useScreenCapture: 状态管理与预览关闭 lifecycle', () => {
  const {
    showPreview,
    previewUrl,
    capturedBlob,
    copiedToClipboard,
    closePreview,
    showToast,
    toastNotice,
    clearToast,
  } = useScreenCapture();

  showToast('测试消息', 'info');
  assert.strictEqual(toastNotice.value?.message, '测试消息');
  clearToast();
  assert.strictEqual(toastNotice.value, null);

  showPreview.value = true;
  copiedToClipboard.value = true;
  closePreview();
  assert.strictEqual(showPreview.value, false);
  assert.strictEqual(previewUrl.value, null);
  assert.strictEqual(capturedBlob.value, null);
});

test('ChatPage.vue: 保证聊天顶栏、空状态及内嵌视图均自适应集成截图入口', () => {
  const chatPageContent = fs.readFileSync(
    path.join(projectRoot, 'frontend/src/pages/ChatPage.vue'),
    'utf-8'
  );

  // Component imports
  assert.match(chatPageContent, /import ScreenCaptureButton from/);
  assert.match(chatPageContent, /import ScreenCapturePreviewDock from/);

  // Chat header actions
  assert.match(chatPageContent, /<ScreenCaptureButton variant="header" \/>/);

  // Chat empty state
  assert.match(chatPageContent, /class="chat-empty__top-actions"[\s\S]*?<ScreenCaptureButton variant="header" \/>/);

  // Canvas embedded view
  assert.match(chatPageContent, /v-show="isCanvasView"[\s\S]*?<ScreenCaptureButton variant="floating" \/>/);

  // Notes embedded view
  assert.match(chatPageContent, /v-show="isNotesView"[\s\S]*?<ScreenCaptureButton variant="floating" \/>/);

  // Global dock
  assert.match(chatPageContent, /<ScreenCapturePreviewDock \/>/);
});

test('StorageWorkspace.vue: 文件存储顶栏集成截图工具', () => {
  const storageContent = fs.readFileSync(
    path.join(projectRoot, 'frontend/src/components/chat/StorageWorkspace.vue'),
    'utf-8'
  );

  assert.match(storageContent, /import ScreenCaptureButton from/);
  assert.match(storageContent, /<ScreenCaptureButton variant="storage" \/>/);
});

test('Locales: zh-CN / zh-TW / en-US 包含完整的截图多语言条目', async () => {
  const zhCn = (await vite.ssrLoadModule('/frontend/src/locales/zh-CN.js')).default;
  const zhTw = (await vite.ssrLoadModule('/frontend/src/locales/zh-TW.js')).default;
  const enUs = (await vite.ssrLoadModule('/frontend/src/locales/en-US.js')).default;

  const requiredKeys = [
    'capture.button',
    'capture.title',
    'capture.ready',
    'capture.copied',
    'capture.copyFailed',
    'capture.download',
    'capture.copy',
    'capture.copySuccess',
    'capture.shortcutsTitle',
  ];

  for (const key of requiredKeys) {
    assert.ok(zhCn[key], `Missing ${key} in zh-CN`);
    assert.ok(zhTw[key], `Missing ${key} in zh-TW`);
    assert.ok(enUs[key], `Missing ${key} in en-US`);
  }
});
