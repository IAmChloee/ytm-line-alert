import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const TID = 'F7D4C56F112E44';

export function quantity(data) {
  if (
    data?.Status?.code !== '00' ||
    !Array.isArray(data?.Result?.StockList)
  ) {
    throw new Error('庫存 API 格式或狀態異常');
  }

  const items = data.Result.StockList.filter(
    p =>
      p.SaleID === '31Z051013' ||
      /生乳捲盲盒/.test(p.ProductName ?? '')
  );

  return items.reduce((sum, p) => {
    if (
      p.quantity === null ||
      p.quantity === '' ||
      !['string', 'number'].includes(typeof p.quantity)
    ) {
      throw new Error('數量格式異常');
    }

    const q = Number(p.quantity);

    if (!Number.isInteger(q) || q < 0) {
      throw new Error('數量格式異常');
    }

    return sum + q;
  }, 0);
}

export function shouldNotify(previous, current, force = false) {
  const restocked = previous === 0 && current > 0;
  const lastOne = previous !== 1 && current === 1;

  return force || previous === null || restocked || lastOne;
}

async function jsonRequest(url, options) {
  let response;

  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('網路連線失敗或逾時，未更新庫存狀態');
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}，未更新庫存狀態`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error('回傳不是 JSON');
  }
}

export async function main() {
  const dry = process.argv.includes('--dry-run');
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;

  if (!dry && (!token || !userId)) {
    throw new Error('請設定 LINE_CHANNEL_ACCESS_TOKEN 與 LINE_USER_ID');
  }

  const data = await jsonRequest(
    'https://www.yannick.com.tw/_zh-cht/ajaxTYTMStock.ashx',
    {
      method: 'POST',
      body: new URLSearchParams({ TID }),
    }
  );

  const q = quantity(data);

  let old = null;

  try {
    old = JSON.parse(await fs.readFile('state.json', 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      throw new Error('state.json 損壞，請檢查');
    }
  }

  if (
    old &&
    (old.tid !== TID ||
      !Number.isInteger(old.quantity) ||
      old.quantity < 0)
  ) {
    throw new Error('state.json 內容異常');
  }

  const notify = shouldNotify(
    old?.quantity ?? null,
    q,
    process.env.FORCE_NOTIFY === 'true'
  );

  const time = new Date().toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false,
  });

  console.log(
    `${time} 科技大樓站：盲盒 ${q} 盒；通知=${notify}；dry-run=${dry}`
  );

  if (dry) return;

  if (notify) {
    const text = [
      old ? '🍰 庫存通知' : '✅ 追蹤已啟動',
      '科技大樓站｜生乳捲盲盒',
      q > 0 ? `目前剩餘：${q} 盒` : '目前缺貨',
      `查詢時間：${time}（台灣時間）`,
      'https://www.yannick.com.tw/ytm/service2',
      '庫存可能隨時變動，通知不代表保留商品。',
    ].join('\n');

    const result = await jsonRequest(
      'https://api.line.me/v2/bot/message/push',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: userId,
          messages: [{ type: 'text', text }],
        }),
      }
    );

    if (!Array.isArray(result.sentMessages)) {
      throw new Error('LINE 回傳格式異常');
    }
  }

  // 通知發送失敗時，不覆蓋上次狀態。
  if (!old || old.quantity !== q) {
    const next = JSON.stringify({ tid: TID, quantity: q }, null, 2);
    await fs.writeFile('state.json.tmp', next + '\n');
    await fs.rename('state.json.tmp', 'state.json');
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(e => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
