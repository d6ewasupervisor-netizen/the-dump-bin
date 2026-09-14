import { chromium } from 'playwright';
import {
  ROUTES,
  VIEWPORTS,
  measureLayout,
  openPage,
  probeAlert,
  startStaticServer,
} from './smoke-blank.mjs';

const failures = [];

function fail(label, detail) {
  failures.push({ label, detail });
  console.error(`FAIL ${label}`, detail);
}

async function run() {
  const provided = process.env.PILOT_URL;
  const local = provided ? null : await startStaticServer();
  const origin = provided || local.origin;
  const browser = await chromium.launch({ headless: true });

  try {
    for (const viewport of VIEWPORTS) {
      for (const route of ROUTES) {
        const { context, page } = await openPage(browser, origin, viewport, route.hash);
        const layout = await measureLayout(page);
        const label = `${viewport.name} ${route.hash}`;
        if (layout.overflow > 1) fail(label, { overflow: layout.overflow });
        if (!layout.hasMount) fail(label, { mount: 'empty' });
        if (layout.theme !== 'gray-matter') fail(label, { theme: layout.theme });
        if (!/^#12151a$/i.test(layout.bg)) fail(label, { bg: layout.bg });
        if (layout.small.length) fail(`${label} touch`, layout.small);
        if (layout.clipped.length) fail(`${label} clipped`, layout.clipped);
        if (route.hash === '#/visit' && viewport.name === 'iphone-se') {
          const dialog = await probeAlert(page);
          if (!dialog?.visible || !dialog.inView) fail(`${label} dialog`, dialog);
        }
        await context.close();
      }
    }

    const persist = await openPage(browser, origin, VIEWPORTS[2], '#/visit');
    const first = await persist.page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await persist.page.reload({ waitUntil: 'domcontentloaded' });
    await persist.page.waitForTimeout(600);
    const after = await persist.page.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      stored: localStorage.getItem('eodFieldTheme'),
    }));
    if (first !== 'gray-matter' || after.theme !== 'gray-matter' || after.stored !== 'gray-matter') {
      fail('gray-matter persist', { first, after });
    }
    await persist.context.close();
  } finally {
    await browser.close();
    if (local) local.server.close();
  }

  if (failures.length) {
    console.error(JSON.stringify({ ok: false, failures }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    viewports: VIEWPORTS.map((v) => v.name),
    routes: ROUTES.map((r) => r.hash),
  }, null, 2));
}

await run();
