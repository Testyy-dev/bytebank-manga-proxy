const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

const app = express();

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
];

app.get('/', async (req, res) => {
  const { url, type = 'manga' } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing URL' });

  const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
  let browser = null;

  try {
    console.log(`Fetching URL: ${url}, type: ${type}`);
    console.log('Puppeteer cache dir:', process.env.PUPPETEER_CACHE_DIR);
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    });
    console.log('Browser launched');
    const page = await browser.newPage();

    await page.setUserAgent(randomUserAgent);
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Referer': 'https://mangapill.com',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
    });

    console.log('Navigating to URL');
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    if (!response || response.status() >= 400) {
      console.log(`Failed response: ${response?.status()}`);
      throw new Error(`Request failed with status ${response?.status()}`);
    }

    // Wait for dynamic content
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Save debug HTML (use temp dir on Railway)
    const debugDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'debug');
    await fs.mkdir(debugDir, { recursive: true });
    if (type === 'chapters') {
      const html = await page.content();
      await fs.writeFile(path.join(debugDir, 'debug_chapters.html'), html);
      console.log('Saved HTML to debug_chapters.html');
    } else if (type === 'images') {
      const html = await page.content();
      await fs.writeFile(path.join(debugDir, 'debug_images.html'), html);
      console.log('Saved HTML to debug_images.html');
    } else if (type === 'manga') {
      const html = await page.content();
      await fs.writeFile(path.join(debugDir, 'debug_manga.html'), html);
      console.log('Saved HTML to debug_manga.html');
    }

    let results = [];
    if (type === 'manga') {
      console.log('Waiting for manga selector');
      await page.waitForSelector('a[href*="/manga/"]', { timeout: 30000 });
      results = await page.evaluate(() => {
        const elements = document.querySelectorAll('a[href*="/manga/"]');
        console.log(`Found ${elements.length} manga elements`);
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
      // Scroll to load chapters
      await page.evaluate(async () => {
        for (let i = 0; i < 5; i++) {
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      });
      // Click "Load More" if exists
      let loadMore;
      while ((loadMore = await page.$('button.load-more, a.load-more, [class*="load-more"], .btn-more, .pagination a'))) {
        console.log('Clicking load more');
        await loadMore.click();
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      await page.waitForSelector('a[href*="/chapters/"]', { timeout: 60000 });
      results = await page.evaluate(() => {
        const elements = document.querySelectorAll('a[href*="/chapters/"]');
        console.log(`Found ${elements.length} chapter elements`);
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
        console.log(`Found ${elements.length} image elements`);
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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));