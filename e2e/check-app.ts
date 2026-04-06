import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Capture console errors
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("http://localhost:1420/", { waitUntil: "networkidle", timeout: 10000 });
  await page.waitForTimeout(2000);

  // Screenshot
  await page.screenshot({ path: "e2e/screenshot.png", fullPage: true });

  // Check what's visible
  const bodyText = await page.textContent("body");
  console.log("=== BODY TEXT ===");
  console.log(bodyText?.slice(0, 500) || "(empty)");
  console.log("\n=== CONSOLE ERRORS ===");
  errors.forEach((e) => console.log(e));

  // Check if root has children
  const rootHTML = await page.innerHTML("#root");
  console.log("\n=== #root innerHTML (first 500 chars) ===");
  console.log(rootHTML?.slice(0, 500) || "(empty)");

  await browser.close();
})();
