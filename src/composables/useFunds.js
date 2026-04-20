/**
 * 基金数据组合式函数
 *
 * 封装基金数据的获取、状态管理和错误处理逻辑
 * 作为组件与 API 模块之间的桥梁
 */

import { ref, reactive } from 'vue'
import {
  fetchSingleFundgz,
  getLastTradingChange
} from '../api/funds'

/**
 * 基金数据管理 Hook
 *
 * @returns {Object} {
 *   funds,       // 基金列表响应式数据
 *   fundNameMap, // 基金代码→名称映射缓存
 *   loading,     // 加载状态
 *   error,       // 错误信息
 *   lastUpdate,  // 最后更新时间
 *   loadFunds    // 加载基金数据方法
 * }
 */
export function useFunds() {
  // 基金列表数据
  const funds = ref([])
  // 基金名称缓存：{ code: name }（使用 reactive 确保深层响应式）
  const fundNameMap = reactive({})
  // 加载状态
  const loading = ref(false)
  // 错误信息
  const error = ref(null)
  // 最后更新时间
  const lastUpdate = ref(null)

  /**
   * 加载基金数据
   *
   * 流程：
   * 1. fundgz 获取实时数据，成功则直接使用
   * 2. fundgz 返回空数据或失败重试3次后，调用 pingzhongdata 作为备选
   *
   * @param {string[]} codes - 基金代码数组
   */
  async function loadFunds(codes) {
    if (!codes || !codes.length) {
      funds.value = []
      return
    }

    loading.value = true
    error.value = null

    // 刷新前先清空表格数据
    funds.value = []

    try {
      // 所有代码都需要通过 fundgz 获取
      const missing = [...codes]

      // 逐个获取基金数据，全部完成后再关闭 loading
      async function fetchWithRetry(code, remainRetries = 3) {
        try {
          const r = await fetchSingleFundgz(code)
          if (r && (r.GSZ != null || r.GSZZL != null)) {
            const idx = funds.value.findIndex(f => f.FCODE === code)
            if (idx >= 0) funds.value[idx] = r
            else funds.value.push(r)
            if (r.SHORTNAME) fundNameMap[code] = r.SHORTNAME
            lastUpdate.value = new Date()
          } else {
            throw new Error('fundgz empty response')
          }
        } catch (e) {
          if (remainRetries > 0 && e.message !== 'fundgz empty response') {
            await new Promise(resolve => setTimeout(resolve, 150))
            return fetchWithRetry(code, remainRetries - 1)
          }
          try {
            const lcd = await getLastTradingChange(code)
            if (lcd.change !== null) {
              const fundData = {
                FCODE: code,
                SHORTNAME: lcd.name || '',
                GSZ: lcd.nav,
                GSZZL: lcd.change,
                GZTIME: lcd.date,
                LAST_CHG: lcd.change
              }
              const idx = funds.value.findIndex(f => f.FCODE === code)
              if (idx >= 0) funds.value[idx] = fundData
              else funds.value.push(fundData)
              if (lcd.name) fundNameMap[code] = lcd.name
              lastUpdate.value = new Date()
            }
          } catch {
            // 两个数据源都失败，跳过该基金
          }
        }
      }

      await Promise.allSettled(missing.map(code => fetchWithRetry(code)))
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  return {
    funds,
    fundNameMap,
    loading,
    error,
    lastUpdate,
    loadFunds
  }
}