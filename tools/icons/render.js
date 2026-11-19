const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const jobs = JSON.parse(process.argv[2]);
  const b = await chromium.launch(); const p = await b.newPage();
  for (const [svg, size, out, bg] of jobs) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:${bg || 'transparent'}"><img src="data:image/svg+xml;base64,${fs.readFileSync(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"></body></html>`);
    await p.waitForTimeout(50);
    await p.screenshot({ path: out, omitBackground: !bg });
  }
  await b.close();
})();
