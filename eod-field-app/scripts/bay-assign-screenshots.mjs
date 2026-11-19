import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  startStaticServer,
  installPilotState,
} from './smoke-blank.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'output', 'bay-assign-screens');
fs.mkdirSync(OUT, { recursive: true });

const tinyJpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
  'base64'
);

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function run() {
  const local = await startStaticServer();
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
  });
  const paths = [];
  try {
    for (const width of [360, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 740 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      await installPilotState(page);
      await page.goto(`${local.origin}/index.html#/survey?dbkey=9680806&rowId=bay-assign-smoke&name=Bay%20Assign&cat=60&slot=after`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForTimeout(1200);
      await page.evaluate(() => {
        const el = document.getElementById('setBayCountControl');
        if (!el) return;
        el.hidden = false;
        el.innerHTML = `
          <div class="set-bay-count-head">
            <strong>Bays in store: 4</strong>
            <button type="button" class="btn btn-secondary" data-bay-add>Add a bay</button>
          </div>
          <div class="set-bay-count-list">
            <div class="set-bay-count-row"><span>Bay 1</span><button type="button" class="btn btn-secondary">Not in this store</button></div>
            <div class="set-bay-count-row"><span>Bay 2</span><button type="button" class="btn btn-secondary">Not in this store</button></div>
            <div class="set-bay-count-row is-missing"><span>Bay 3 · not in store</span><button type="button" class="btn btn-secondary">Restore</button></div>
            <div class="set-bay-count-row"><span>Bay 4</span><button type="button" class="btn btn-secondary">Not in this store</button></div>
          </div>`;
      });
      paths.push(await shot(page, `bay-count-${width}.png`));

      await page.evaluate((b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const file = new File([bytes], 'bay1.jpg', { type: 'image/jpeg' });
        const file2 = new File([bytes], 'bay2.jpg', { type: 'image/jpeg' });
        window.EodBayAssignScreen.open({
          files: [file, file2],
          requiredBays: [1, 2, 4],
          occupiedBays: [],
          title: 'Bay Assign · After',
        });
      }, tinyJpeg.toString('base64'));
      await page.waitForTimeout(400);
      paths.push(await shot(page, `assign-screen-${width}.png`));
      await context.close();
    }
  } finally {
    await browser.close();
    local.server.close();
  }
  console.log(JSON.stringify({ ok: true, paths }, null, 2));
}

await run();
