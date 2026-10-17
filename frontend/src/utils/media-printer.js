export function printImage(url, title = '打印图片') {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      const win = window.open(url, '_blank');
      win?.focus();
      win?.print();
      resolve();
      return;
    }

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${title}</title>
          <style>
            @page {
              size: auto;
              margin: 10mm;
            }
            @media print {
              html, body {
                margin: 0 !important;
                padding: 0 !important;
                background: #fff !important;
                color: #000 !important;
                width: 100% !important;
                height: 100% !important;
              }
              .print-container {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 100% !important;
                height: 100vh !important;
              }
              img {
                max-width: 100% !important;
                max-height: 100% !important;
                width: auto !important;
                height: auto !important;
                object-fit: contain !important;
                display: block !important;
                margin: auto !important;
                page-break-inside: avoid !important;
              }
            }
            body {
              margin: 0;
              padding: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
            }
            img {
              max-width: 100%;
              max-height: 100%;
              object-fit: contain;
            }
          </style>
        </head>
        <body>
          <div class="print-container">
            <img id="printImg" src="${url}" alt="${title}" />
          </div>
        </body>
      </html>
    `);
    doc.close();

    const img = doc.getElementById('printImg');
    let cleaned = false;
    const cleanup = () => {
      if (!cleaned) {
        cleaned = true;
        setTimeout(() => {
          try {
            document.body.removeChild(iframe);
          } catch {}
        }, 1200);
      }
    };

    const doPrint = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch (e) {
          console.error('Print error:', e);
        } finally {
          cleanup();
          resolve();
        }
      }, 300);
    };

    if (img) {
      if (img.complete) {
        doPrint();
      } else {
        img.onload = doPrint;
        img.onerror = () => {
          cleanup();
          reject(new Error('图片加载失败，无法打印'));
        };
      }
    } else {
      doPrint();
    }
  });
}

export function printPdf(url) {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    iframe.src = url;
    document.body.appendChild(iframe);

    iframe.onload = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          window.open(url, '_blank')?.print();
        } finally {
          setTimeout(() => {
            try {
              document.body.removeChild(iframe);
            } catch {}
          }, 8000);
          resolve();
        }
      }, 500);
    };

    setTimeout(() => {
      resolve();
    }, 8000);
  });
}

export function printMedia({ url, filename, isPdf = false }) {
  if (isPdf || String(url || '').toLowerCase().includes('.pdf')) {
    return printPdf(url);
  }
  return printImage(url, filename);
}