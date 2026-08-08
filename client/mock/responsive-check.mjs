/**
 * Responsive smoke test.
 *
 * DEV ONLY. Drives the local Chrome against the running dev stack and asserts
 * the two things that actually break a phone layout: the page must not scroll
 * sideways, and nothing interactive may be smaller than the touch minimum.
 *
 *   node client/mock/responsive-check.mjs
 *
 * Checked by measuring the real layout rather than by reading class names,
 * because the failure mode is always a child that overflows its parent —
 * which no amount of grepping will find.
 */

import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ORIGIN = process.env.ORIGIN ?? "http://localhost:5173";
const KEY = process.env.PREVIEW_KEY ?? "ivrk_localpreviewkey000000000000000000000";

const VIEWPORTS = [
  { name: "iPhone SE", width: 320, height: 568 },
  { name: "iPhone 12", width: 390, height: 844 },
  { name: "iPad mini", width: 768, height: 1024 },
  { name: "Laptop", width: 1280, height: 800 },
];

const ROUTES = [
  "/campaigns",
  "/campaigns/33333333-3333-4333-8333-333333333331",
  "/campaigns/33333333-3333-4333-8333-333333333331/live",
  "/campaigns/new",
  "/contact-lists",
  "/contact-lists/55555555-5555-4555-8555-555555555555",
  "/flows",
  "/flows/66666666-6666-4666-8666-666666666661",
  "/calls",
  "/calls/77777777-7777-4777-8777-777777777771",
  "/compliance/dnc",
  "/compliance/consent",
  "/compliance/windows",
  "/caller-ids",
  "/settings",
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage();

// Sign in once; the session cookie carries across every route.
await page.setViewport({ width: 1280, height: 800 });
await page.goto(`${ORIGIN}/login`, { waitUntil: "networkidle2" });
const signedIn = await page.evaluate(async (key) => {
  const r = await fetch("/bff/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ apiKey: key }),
  });
  return r.status;
}, KEY);

if (signedIn !== 200) {
  console.error(`Could not sign in (HTTP ${signedIn}). Is the fixture running?`);
  await browser.close();
  process.exit(1);
}

let failures = 0;

for (const vp of VIEWPORTS) {
  await page.setViewport({
    width: vp.width,
    height: vp.height,
    isMobile: vp.width < 768,
    hasTouch: vp.width < 768,
  });

  console.log(`\n${vp.name}  ${vp.width}×${vp.height}`);

  for (const route of ROUTES) {
    await page.goto(`${ORIGIN}${route}`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 350));

    const result = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - doc.clientWidth;

      // Widest offender, so a failure names something findable.
      let worst = null;
      if (overflow > 0) {
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.right > doc.clientWidth + 1 && r.width > 0) {
            const over = Math.round(r.right - doc.clientWidth);
            if (!worst || over > worst.over) {
              worst = {
                over,
                tag: el.tagName.toLowerCase(),
                cls: (el.className?.toString?.() ?? "").slice(0, 70),
              };
            }
          }
        }
      }

      // Touch targets. Dense table controls are exempt above the phone
      // breakpoint, where a pointer is doing the aiming.
      const small = [];
      if (window.innerWidth < 768) {
        for (const el of document.querySelectorAll(
          "button, a[href], input, select, textarea",
        )) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.height < 36) {
            small.push(
              `${el.tagName.toLowerCase()}(${Math.round(r.height)}px) "${(
                el.textContent ?? ""
              ).trim().slice(0, 24)}"`,
            );
          }
        }
      }

      return { overflow, worst, small: small.slice(0, 3), smallCount: small.length };
    });

    const bad = result.overflow > 0 || result.smallCount > 0;
    if (bad) failures += 1;

    const mark = bad ? "FAIL" : "ok  ";
    let detail = "";
    if (result.overflow > 0) {
      detail += `  overflow +${result.overflow}px`;
      if (result.worst) {
        detail += ` [${result.worst.tag}.${result.worst.cls}]`;
      }
    }
    if (result.smallCount > 0) {
      detail += `  ${result.smallCount} target(s) < 36px: ${result.small.join(", ")}`;
    }
    console.log(`  ${mark} ${route}${detail}`);
  }
}

await browser.close();
console.log(
  failures === 0
    ? "\nAll routes clean at every viewport."
    : `\n${failures} route/viewport combination(s) need attention.`,
);
process.exit(failures === 0 ? 0 : 1);
