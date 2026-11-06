import puppeteer from '@cloudflare/puppeteer'

/**
 * Generate a PNG screenshot of a shared drawing using Cloudflare Browser Rendering.
 * Navigates to the share page and screenshots the Excalidraw canvas.
 */
export async function generatePng(
  browser: Fetcher,
  shareUrl: string,
): Promise<Uint8Array> {
  // @ts-expect-error — Browser Rendering binding works as puppeteer launch target
  const instance = await puppeteer.launch(browser)

  try {
    const page = await instance.newPage()
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 })

    // Navigate to the share page which renders Excalidraw in view mode
    await page.goto(shareUrl, { waitUntil: 'networkidle0', timeout: 30000 })

    // Wait for Excalidraw canvas to render
    await page.waitForSelector('canvas', { timeout: 15000 })

    // Give Excalidraw a moment to finish rendering elements
    await page.waitForTimeout(1000)

    // Screenshot the canvas element for a clean image (no UI chrome)
    const canvas = await page.$('canvas')
    if (!canvas) {
      throw new Error('Canvas element not found after render')
    }

    const screenshot = await canvas.screenshot({ type: 'png' })
    return new Uint8Array(screenshot as ArrayBuffer)
  } finally {
    await instance.close()
  }
}
