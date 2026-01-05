const puppeteer = require('puppeteer');

(async () => {
  console.log('🧪 Testing Google search...');
  
  const browser = await puppeteer.launch({
    headless: false, // Show browser
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.goto('https://www.google.com/search?q=Chewy+recruiter+site:linkedin.com/in&num=20');
  
  console.log('✅ Browser opened! Check if you see results.');
  console.log('Press Ctrl+C when done viewing...');
  
  // Keep browser open
  await new Promise(resolve => setTimeout(resolve, 60000));
  
  await browser.close();
})();