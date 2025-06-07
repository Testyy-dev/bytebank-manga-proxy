const express = require('express');
    const puppeteer = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    const fs = require('fs').promises;
    const path = require('path');

    puppeteer.use(StealthPlugin());

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    ];

    app.get('/', async (req, res) => {
      const { url, type = 'manga' } = req.query;
      if (!url) {
        console.error('Missing URL');
        return res.status(400).json({ error: 'Missing URL' });
      }

      const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
      let browser = null;

      try {
        console.log(`Fetching URL: ${url}, type: ${type}`);
        console.log('Puppeteer cache dir:', process.env.PUPPETEER_CACHE_DIR || '/tmp/puppeteer');

        browser = await puppeteer.launch({
          executablePath: '/usr/bin/google-chrome',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
            '--disable-features=site-per-process',
          ],
          headless: 'new',
          userDataDir: '/tmp/puppeteer_user_data',
          timeout: 60000,
        });

        console.log('Browser launched');
        const page = await browser.newPage();

        await page.setUserAgent(randomUserAgent);
        await page.setExtraHTTPHeaders({
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': '[invalid url, do not cite]',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin',
        });

        console.log('Navigating to URL');
        const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
        if (!response || response.status() >= 400) {
          console.log(`Failed response: ${response?.status()}`);
          throw new Error(`Request failed with status ${response?.status()}`);
        }

        await new Promise(resolve => setTimeout(resolve, 5000));

        const debugDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/tmp/debug';
        await fs.mkdir(debugDir, { recursive: true });

        const html = await page.content();
        await fs.writeFile(path.join(debugDir, `debug_${type}.html`), html);
        console.log(`Saved HTML to ${debugDir}/debug_${type}.html`);

        let results = [];
        if (type === 'manga') {
          console.log('Waiting for manga selector');
          await page.waitForSelector('a[href*="/manga/"]', { timeout: 30000 });
          results = await page.evaluate(() => {
            const elements = document.querySelectorAll('a[href*="/manga/"]');
            const seenUrls = new Set();
            return Array.from(elements)
              .map(el => {
                const titleEl = el.querySelector('.card-title, .manga-title, .item-title, .title, h3, h2');
                const title = titleEl?.textContent.trim() || el.textContent.trim() || 'Unknown Manga';
                return { title, url: el.href };
              })
              .filter(item => {
                if (!item.url || seenUrls.has(item.url) || item.title === 'Unknown Manga' || !item.url.includes('/manga/')) {
                  return false;
                }
                seenUrls.add(item.url);
                return true;
              });
          });
        } else if (type === 'chapters') {
          console.log('Waiting for chapters selector');
          await page.evaluate(async () => {
            for (let i = 0; i < 10; i++) {
              window.scrollTo(0, document.body.scrollHeight);
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          });
          let loadMore;
          while ((loadMore = await page.$('button.load-more, a.load-more, [class*="load-more"], .btn-more, .pagination a'))) {
            console.log('Clicking load more');
            await loadMore.click();
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
          await page.waitForSelector('a[href*="/chapters/"]', { timeout: 60000 });
          results = await page.evaluate(() => {
            const elements = document.querySelectorAll('a[href*="/chapters/"]');
            const seenUrls = new Set();
            return Array.from(elements)
              .map(el => {
                const titleEl = el.querySelector('.chapter-title, .chapter-number, span, a');
                const title = titleEl?.textContent.trim() || el.textContent.trim() || 'Unknown Chapter';
                return { title, url: el.href };
              })
              .filter(item => {
                if (!item.url || seenUrls.has(item.url) || item.title === 'Unknown Chapter' || !item.url.includes('/chapters/')) {
                  return false;
                }
                seenUrls.add(item.url);
                return true;
              });
          });
        } else if (type === 'images') {
          console.log('Waiting for images');
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          });
          await page.waitForSelector('img[src*="/file/mangap/"], img[data-src*="/file/mangap/"]', { timeout: 60000 });
          results = await page.evaluate(() => {
            const elements = document.querySelectorAll('img[src*="/file/mangap/"], img[data-src*="/file/mangap/"]');
            return Array.from(elements)
              .map(img => img.src || img.getAttribute('data-src'))
              .filter(src => src && src.includes('/file/mangap/'));
          });
        }

        console.log(`Returning ${results.length} results`);
        await browser.close();

        if (results.length === 0) {
          return res.status(404).json({ error: `No ${type} found` });
        }
        res.status(200).json(results);
      } catch (error) {
        console.error('Puppeteer error:', error.message);
        if (browser) await browser.close();
        res.status(500).json({ error: 'Failed to fetch data', details: error.message });
      }
    });

    app.get('/health', (req, res) => {
      res.status(200).json({ status: 'OK' });
    });

    console.log('PORT env var:', process.env.PORT);
    const port = process.env.PORT || 3000;
    app.listen(port, '0.0.0.0', () => console.log(`Server running on port ${port}`));