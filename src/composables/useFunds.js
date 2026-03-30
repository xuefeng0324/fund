/**
 * 基金数据组合式函数
 *
 * 封装基金数据的获取、状态管理和错误处理逻辑
 * 作为组件与 API 模块之间的桥梁
 */

import { ref } from 'vue'
import { fetchFundsLive } from '../api/funds'

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
  // 基金名称缓存：{ code: name }
  const fundNameMap = ref({})
  // 加载状态
  const loading = ref(false)
  // 错误信息
  const error = ref(null)
  // 最后更新时间
  const lastUpdate = ref(null)

  /**
   * 加载基金数据
   *
   * @param {string[]} codes - 基金代码数组
   * @param {string} mode - 数据获取模式（'auto' | 'em' | 'fundgz' 等）
   */
  async function loadFunds(codes, mode = 'auto') {
    if (!codes || !codes.length) {
      funds.value = []
      return
    }

    loading.value = true
    error.value = null

    try {
      funds.value = await fetchFundsLive(codes, mode)
      // 更新名称缓存
      funds.value.forEach(f => {
        if (f.FCODE && f.SHORTNAME) {
          fundNameMap.value[f.FCODE] = f.SHORTNAME
        }
      })
      lastUpdate.value = new Date()
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