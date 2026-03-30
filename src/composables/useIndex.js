/**
 * 指数数据组合式函数
 *
 * 负责获取和管理四大指数的实时行情：
 * - 上证指数 (000001)
 * - 沪深300 (000300)
 * - 深证成指 (399001)
 * - 创业板指 (399006)
 */

import { ref } from 'vue'
import { fetchIndexLive } from '../api/index'

/**
 * 指数数据管理 Hook
 *
 * @returns {Object} {
 *   indexData,  // 指数数据数组
 *   loading,    // 加载状态
 *   error,      // 错误信息
 *   loadIndex   // 加载指数数据方法
 * }
 */
export function useIndex() {
  // 指数数据数组 [{ code, name, last, chg, pct }, ...]
  const indexData = ref([])
  // 加载状态
  const loading = ref(false)
  // 错误信息
  const error = ref(null)

  /**
   * 加载指数数据
   *
   * 从东财 push2 接口获取指数快照
   */
  async function loadIndex() {
    loading.value = true
    error.value = null

    try {
      indexData.value = await fetchIndexLive()
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  return {
    indexData,
    loading,
    error,
    loadIndex
  }
}