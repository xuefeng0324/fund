const fs = require('fs');
const path = require('path');
const https = require('https');

const FUND_GROUPS_PATH = path.join(__dirname, '../public/config/fund_groups.json');
const FUND_INFO_PATH = path.join(__dirname, '../public/config/fund_info.json');
const API_BASE = 'https://danjuanfunds.com/djapi/fund/detail';

function readJson(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function extractAllCodes(fundGroups) {
  const codes = new Set();
  for (const group of Object.values(fundGroups)) {
    for (const code of group) {
      codes.add(code);
    }
  }
  return codes;
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 10000 }, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function fetchFundInfo(fundCode) {
  const url = `${API_BASE}/${fundCode}`;
  const response = await httpGet(url);
  if (response.result_code !== 0 || !response.data || !response.data.fund_date_conf) {
    throw new Error(`Failed to fetch fund info for ${fundCode}`);
  }
  return {
    fund_code: fundCode,
    buy_confirm_date: response.data.fund_date_conf.buy_confirm_date,
    sale_confirm_date: response.data.fund_date_conf.sale_confirm_date
  };
}

async function main() {
  console.log('Starting fund info sync...');
  const fundGroups = readJson(FUND_GROUPS_PATH);
  const allCodes = extractAllCodes(fundGroups);
  console.log(`Found ${allCodes.size} fund codes in fund_groups.json`);

  let fundInfo = [];
  if (fs.existsSync(FUND_INFO_PATH)) {
    fundInfo = readJson(FUND_INFO_PATH);
  }
  const existingCodes = new Set(fundInfo.map(item => item.fund_code));
  console.log(`Found ${existingCodes.size} existing fund codes in fund_info.json`);

  const needFetch = [...allCodes].filter(code => !existingCodes.has(code));
  console.log(`Need to fetch ${needFetch.length} fund codes`);

  if (needFetch.length === 0) {
    console.log('No new funds to sync. Exiting.');
    return;
  }

  let newFundInfo = [];
  for (const code of needFetch) {
    try {
      console.log(`Fetching fund info for ${code}...`);
      const info = await fetchFundInfo(code);
      newFundInfo.push(info);
      console.log(`  Success: buy_confirm_date=${info.buy_confirm_date}, sale_confirm_date=${info.sale_confirm_date}`);
    } catch (error) {
      console.log(`  Failed: ${error.message}. Skipping.`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const updatedFundInfo = [...fundInfo, ...newFundInfo];
  writeJson(FUND_INFO_PATH, updatedFundInfo);
  console.log(`Updated fund_info.json with ${newFundInfo.length} new entries`);

  if (newFundInfo.length === 0) {
    console.log('No successful fetches. Not committing changes.');
    return;
  }
  console.log('Fund info sync completed successfully.');
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
