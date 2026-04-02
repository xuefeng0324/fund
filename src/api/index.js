/**
 * 指数数据 API 模块
 *
 * 主要功能：获取四大指数实时行情
 * - 上证指数 (000001)
 * - 沪深300 (000300)
 * - 深证成指 (399001)
 * - 创业板指 (399006)
 *
 * 使用 JSONP 方式调用东财 push2 接口
 */

// 指数代码映射：前缀 1 表示沪市，0 表示深市
const INDEX_SECIDS = [
  '1.000001',  // 上证指数
  '1.000300',  // 沪深300
  '0.399001',  // 深证成指
  '0.399006'   // 创业板指
]

/**
 * 安全转换为浮点数
 * @param {any} v - 待转换值
 * @returns {number|null} 转换后的数值，无效时返回 null
 */
function safeFloat(v) {
  if (v == null || v === '' || v === '--') return null
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

/**
 * 获取指数快照（JSONP方式）
 *
 * 使用东财 push2 接口，通过 JSONP 回调获取数据
 * 接口参数说明：
 * - secids: 证券代码列表
 * - fields: f2(最新价), f3(涨跌幅), f4(涨跌额), f12(代码), f14(名称)
 * - cb: JSONP 回调函数名
 *
 * @returns {Promise<Array>} 指数数据数组 [{ code, name, last, chg, pct }, ...]
 */
export async function fetchIndexLive() {
  return new Promise((resolve, reject) => {
    // 生成唯一回调函数名
    const callback = 'jsonp_index_' + Date.now() + '_' + Math.random().toString(36).slice(2)
    const url =
      'https://push2.eastmoney.com/api/qt/ulist.np/get' +
      '?fltt=2&secids=' + encodeURIComponent(INDEX_SECIDS.join(',')) +
      '&fields=f2,f3,f4,f12,f14' +
      '&cb=' + callback

    let resolved = false
    let script = null

    // 超时处理
    const timer = setTimeout(() => {
      if (resolved) return
      resolved = true
      try { delete window[callback] } catch (e) {}
      if (script && script.parentNode) document.head.removeChild(script)
      reject(new Error('timeout'))
    }, 10000)

    // JSONP 回调函数
    window[callback] = (obj) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)

      const out = []
      const datas = ((obj && obj.data) || {}).diff || []

      datas.forEach(it => {
        if (!it) return
        out.push({
          code: String(it.f12 || ''),    // 指数代码
          name: String(it.f14 || ''),    // 指数名称
          last: safeFloat(it.f2),        // 最新价
          chg: safeFloat(it.f4),         // 涨跌额
          pct: safeFloat(it.f3)          // 涨跌幅(%)
        })
      })

      resolve(out)
    }

    // 创建 script 标签发起 JSONP 请求
    script = document.createElement('script')
    script.src = url
    script.onerror = () => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      try { delete window[callback] } catch (e) {}
      if (script.parentNode) document.head.removeChild(script)
      reject(new Error('script load error'))
    }
    script.onload = () => {
      // script 加载完成后再清理回调函数
      setTimeout(() => {
        try { delete window[callback] } catch (e) {}
      }, 100)
      if (script.parentNode) document.head.removeChild(script)
    }
    document.head.appendChild(script)
  })
}