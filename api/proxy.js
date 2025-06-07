import puppeteer from 'puppeteer';
import fs from 'fs/promises';

export default async function handler(req, res) {
  const { url, type = 'manga' } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing URL' });
  }

  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  ];
  const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

  let browser = null;
  try {
    console.log(`Fetching URL: ${url}, type: ${type}`);
    console.log('Puppeteer cache dir:', process.env.PUPPETEER_CACHE_DIR);
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      headless: 'new',
      defaultViewport: { width: 1280, height: 720 },
      dumpio: true
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
      'Accept-Encoding': 'gzip, deflate'
    });

    console.log('Navigating to URL');
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    if (!response || response.status() >= 400) {
      console.log(`Failed response: ${response?.status()}`);
      await browser.close();
      return res.status(response ? response.status() : 500).json({
        error: 'Puppeteer request failed',
        status: response?.status()
      });
    }

    // Wait for dynamic content
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Save HTML for debugging
    if (type === 'chapters') {
      const html = await page.content();
      await fs.writeFile('C:/Users/HP/Desktop/bytebank/bytebank-manga-proxy/debug_chapters.html', html);
      console.log('Saved HTML to debug_chapters.html');
    } else if (type === 'images') {
      const html = await page.content();
      await fs.writeFile('C:/Users/HP/Desktop/bytebank/bytebank-manga-proxy/debug_images.html', html);
      console.log('Saved HTML to debug_images.html');
    }

    let results = [];
    if (type === 'manga') {
      console.log('Waiting for manga selector');
      await page.waitForSelector('a[href*="/manga/"], .manga-item a, .card a, .list-item a, .item-title a, .manga-name a', { timeout: 30000 });
      results = await page.evaluate(() => {
        const elements = document.querySelectorAll('a[href*="/manga/"], .manga-item a, .card a, .list-item a, .item-title a, .manga-name a');
        console.log(`Found ${elements.length} manga elements`);
        return Array.from(elements)
          .map(el => ({
            title: el.querySelector('h1, h2, h3, h4, h5, h6, .title, .manga-title, .name, .item-title, .manga-name, .media-title, span, div.text, .card-title, .media-body *')?.textContent.trim() || el.textContent.trim() || 'Unknown Manga',
            url: el.href
          }))
          .filter(item => item.url && item.url.includes('/manga/'));
      });
    } else if (type === 'chapters') {
      console.log('Waiting for chapters selector');
      // Scroll to load more chapters
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
      await page.waitForSelector('a[href*="/chapters/"], div[class*="chapter"] a, .list-group a, .chapter-block a, .list-chapter a, .episode a, .mt-2 a, .chapter-list-item a, .chapters-list a, .chapter-link a', { timeout: 60000 });
      results = await page.evaluate(() => {
        const elements = document.querySelectorAll('a[href*="/chapters/"], div[class*="chapter"] a, .list-group a, .chapter-block a, .list-chapter a, .episode a, .mt-2 a, .chapter-list-item a, .chapters-list a, .chapter-link a');
        console.log(`Found ${elements.length} chapter elements`);
        return Array.from(elements)
          .map(el => ({
            title: el.querySelector('span, .chapter-title, .title, div, p, a, .chapter-number')?.textContent.trim() || el.textContent.trim() || 'Chapter',
            url: el.href
          }))
          .filter(item => item.url && item.url.includes('/chapters/'));
      });
    } else if (type === 'images') {
      console.log('Waiting for images');
      await page.waitForSelector('img[src*="/file/mangap/"], img[data-src*="/file/mangap/"], .chapter-page img, .manga-img img, .viewer-image img, img.content-img', { timeout: 60000 });
      results = await page.evaluate(() => {
        const elements = document.querySelectorAll('img[src*="/file/mangap/"], img[data-src*="/file/mangap/"], .chapter-page img, .manga-img img, .viewer-image img, img.content-img');
        console.log(`Found ${elements.length} image elements`);
        return Array.from(elements).map(img => img.src || img.getAttribute('data-src') || '');
      });
    }

    console.log(`Returning ${results.length} results`);
    await browser.close();
    res.status(200).json(results);
  } catch (error) {
    console.error('Puppeteer error:', error.message);
    if (browser) await browser.close();
    res.status(500).json({ error: 'Failed to fetch data', details: error.message });
  }
}

export const config = {
  api: { bodyParser: true }
};