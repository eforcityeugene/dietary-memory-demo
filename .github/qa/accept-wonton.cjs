const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadPlaywright() {
  if (process.env.DIETARY_PLAYWRIGHT_MODULE) return require(process.env.DIETARY_PLAYWRIGHT_MODULE);
  try { return require('playwright'); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  }
}

const [dist, reportPath, publicUrl] = process.argv.slice(2);
assert(dist && reportPath, 'Usage: node accept-wonton.cjs DIST REPORT_JSON [PUBLIC_URL]');
const root = path.resolve(dist);
const report = path.resolve(reportPath);
const output = path.dirname(report);
const phase = publicUrl ? 'public' : 'candidate';
const site = new URL(publicUrl || 'https://dietary-qa.test/dietary-memory-demo/');
assert(site.pathname.endsWith('/'));
const dish = '雲吞麵';
const note = 'QA｜合成煮食筆記：試加一份青菜';
const authorTitle = '負向驗收測試：故意使用不存在嘅食譜';
const expectedSources = [
  ['https://www.madewithlau.com/recipes/wonton-noodle-soup', /wonton noodle soup/i],
  ['https://www.madewithlau.com/recipes/wontons', /wontons/i],
];
const result = { phase, site: site.href, started_at: new Date().toISOString(), status: 'failed', assets: [], checks: {}, sources: [], page_errors: [] };
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const html = () => fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const check = async (name, run) => { result.checks[name] = await run(); };

async function verifyAssets() {
  const entries = [...html().matchAll(/(?:src|href)="\/dietary-memory-demo\/(assets\/[^" ]+\.(?:js|css))"/g)].map(match => match[1]);
  assert(entries.some(file => file.endsWith('.js')) && entries.some(file => file.endsWith('.css')), 'Missing root entry assets');
  for (const file of ['index.html', 'sw.js', ...new Set(entries)]) {
    const sha256 = digest(fs.readFileSync(path.join(root, file)));
    if (publicUrl) {
      const url = new URL(file === 'index.html' ? './' : file, site);
      url.searchParams.set('release-check', sha256.slice(0, 16));
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, 200, `${file} public status`);
      assert.equal(digest(Buffer.from(await response.arrayBuffer())), sha256, `${file} public hash`);
    }
    result.assets.push({ path: file, sha256 });
  }
}

async function checkExternalSources(browser) {
  const context = await browser.newContext({ locale:'zh-HK', serviceWorkers:'block' });
  try {
    result.sources = await Promise.all(expectedSources.map(async ([url, title]) => {
      const page = await context.newPage();
      try {
        const response = await page.goto(url, { waitUntil:'domcontentloaded', timeout:24000 });
        const name = await page.title();
        const heading = await page.locator('h1').allTextContents();
        const reachable = response?.ok() && new URL(page.url()).hostname.replace(/^www\./, '') === new URL(url).hostname.replace(/^www\./, '')
          && title.test(`${name} ${heading.join(' ')}`);
        const final = new URL(page.url());
        return { url, final_url:final.origin + final.pathname, http:response?.status(), title:name, reachable:!!reachable };
      } catch (error) { return { url, reachable:false, error:error.message }; }
      finally { await page.close(); }
    }));
    assert(result.sources.every(source => source.reachable), 'An author page failed the real external reachability check');
  } finally { await context.close(); }
}

async function run() {
  await verifyAssets();
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ channel:'chrome', headless:true, args:['--disable-background-networking','--disable-sync'] });
  try {
    const context = await browser.newContext({ viewport:{width:1280,height:950}, locale:'zh-HK', timezoneId:'Asia/Hong_Kong', serviceWorkers:'block' });
    context.on('page', page => page.on('pageerror', error => result.page_errors.push(error.message)));
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== 'GET' || url.origin !== site.origin || !url.pathname.startsWith(site.pathname)) return route.abort();
      if (publicUrl) return route.continue();
      const file = path.resolve(root, decodeURIComponent(url.pathname.slice(site.pathname.length)) || 'index.html');
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status:404, body:'Not found' });
      return route.fulfill({ status:200, contentType:mime[path.extname(file)] || 'application/octet-stream', body:fs.readFileSync(file) });
    });
    let page = await context.newPage();
    const open = async (url = site.href) => { page.setDefaultTimeout(8000); await page.goto(url); };
    const button = name => page.getByRole('button', { name, exact:true });
    const section = () => page.locator('.research-results');
    const searchBox = () => page.getByRole('textbox', { name:'飲食搜尋', exact:true });
    const search = async text => { await searchBox().fill(text); await button('問').click(); };
    const readTitles = () => section().locator('article.research-card > h3').allTextContents();
    const cooking = () => section().getByRole('heading', { name:'屋企煮', exact:true });
    const assertRecipes = async () => {
      await cooking().waitFor();
      assert.equal(await searchBox().inputValue(), dish);
      const titles = await readTitles();
      assert(titles.includes(authorTitle), 'Missing Daddy Lau recipe');
      assert.equal(await section().getByText(/麥奀雲吞麵世家/).count(), 0, 'Restaurant result leaked into cooking');
      return titles;
    };
    await open();
    await check('fresh_context', async () => {
      assert.deepEqual(await context.cookies(), []);
      assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
      await button('同意以上網上查詢，開始').click();
      await page.getByRole('button', { name:/跳過，直接開始/ }).click();
      return true;
    });
    let recipeOrder;
    await check('plain_query_retains_cooking', async () => {
      await button('屋企煮').click();
      await search(dish);
      recipeOrder = await assertRecipes();
      await page.screenshot({ path:path.join(output, `${phase}-wonton-results.png`) });
      return recipeOrder;
    });
    const linked = [];
    await check('recipe_detail_source_and_return', async () => {
      await button(`睇材料、做法同來源：${authorTitle}`).click();
      await page.getByRole('heading', { name:authorTitle, exact:true }).waitFor();
      assert(await page.getByText('屋企煮 · 雲吞麵', { exact:true }).isVisible());
      for (const label of ['材料摘要', '做法摘要', '原始來源']) {
        assert(await page.getByRole('heading', { name:label, exact:true }).isVisible());
      }
      assert(await page.getByText(/來源／作者：/).isVisible());
      assert(await page.getByText(/4 人份/).isVisible());
      linked.push(...await page.locator('.detail a').evaluateAll(elements => elements.map(element => element.href)));
      await page.screenshot({ path:path.join(output, `${phase}-wonton-detail.png`) });
      await button('‹ 返回煮食結果').click();
      assert.deepEqual(await assertRecipes(), recipeOrder);
      assert.deepEqual(linked, expectedSources.map(([url]) => url));
      return { restored:recipeOrder, verified_link_targets:linked };
    });
    await check('save_from_recipe_result', async () => {
      assert(await section().getByText('未有煮食記錄。', { exact:true }).isVisible());
      await button(`煮完，記低呢款：${authorTitle}`).click();
      assert.equal(await page.getByRole('textbox', { name:'煮過嘅菜名' }).inputValue(), dish);
      await page.getByRole('textbox', { name:'煮食筆記' }).fill(note);
      await button('煮完，核對記錄').click();
      assert(await section().getByText(`確認儲存：${dish} — ${note}`, { exact:true }).isVisible());
      await button('確認儲存').click();
      await section().getByText('已儲存，並成功讀回。', { exact:true }).waitFor();
      assert.equal(await section().getByText(note, { exact:true }).count(), 1);
      return { dish, note };
    });
    await check('close_then_reopen_same_browser', async () => {
      await page.close();
      page = await context.newPage();
      await open();
      await button('屋企煮').click();
      const record = section().locator('article.research-card').filter({ hasText:note });
      await record.waitFor();
      assert.equal(await record.count(), 1);
      assert.equal(await record.getByRole('heading').innerText(), dish);
      assert.equal(await record.getByText(note, { exact:true }).innerText(), note);
      await page.screenshot({ path:path.join(output, `${phase}-wonton-reopened.png`) });
      return { dish, note, count:1 };
    });
    await check('restaurant_clam_and_recall_regressions', async () => {
      await search(dish);
      await button('轉去出去食').click();
      const restaurantCount = (await readTitles()).length;
      assert(restaurantCount >= 5);
      assert(await section().getByText(/麥奀雲吞麵世家/).isVisible());
      await open();
      await search(dish);
      assert.equal((await readTitles()).length, restaurantCount);
      await search('深水埗豉椒炒蜆');
      const clamOrder = await section().locator('button[aria-label^="睇來源："]').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')));
      assert(clamOrder.includes('睇來源：愛文生'));
      await search('邊間平啲？');
      await button('睇來源：愛文生').click();
      assert(await page.getByRole('heading', {name:'來源詳情 · 愛文生'}).isVisible());
      await button('‹ 返回結果').click();
      assert.equal(await searchBox().inputValue(), '深水埗豉椒炒蜆');
      assert.deepEqual(await section().locator('button[aria-label^="睇來源："]').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label'))), clamOrder);
      assert(await section().getByText('暫時比較唔到邊間平啲', {exact:true}).isVisible());
      await search('上次食過豉椒炒蜆？');
      await page.getByRole('heading', {name:'個人回憶同建議'}).waitFor();
      await page.getByText(/我未有你呢方面嘅記錄/).waitFor();
      await button('最新資料').click();
      const count = await page.getByText(/「最新資料」有 \d+ 項資料/).innerText();
      const publicItems = Number(count.match(/\d+/)?.[0]);
      assert(publicItems >= 27);
      const link = new URL(site.href);
      link.searchParams.set('q', '屋企煮 雲吞麵');
      await open(link.href);
      await cooking().waitFor();
      assert.deepEqual(await readTitles(), recipeOrder);
      return { restaurant_results:restaurantCount, clam_price_return:true, private_empty_recall:true, existing_public_items:publicItems, trial_link:link.href };
    });
    assert.deepEqual(result.page_errors, []);
    await context.close();
    await checkExternalSources(browser);
    result.status = 'passed';
  } finally { await browser.close(); }
}

fs.mkdirSync(output, { recursive:true });
run().catch(error => { result.error = error.stack; process.exitCode = 1; }).finally(() => {
  result.finished_at = new Date().toISOString();
  fs.writeFileSync(report, JSON.stringify(result, null, 2) + '\n');
  console.log(`${phase} wonton acceptance ${result.status}: ${report}`);
  if (result.error) console.error(result.error);
});
