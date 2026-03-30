/**
 * 密钥认证组合式函数
 *
 * 负责用户密钥的验证和管理：
 * - 密钥对应 fund_groups.json 中的分组名
 * - 验证通过后显示对应分组的基金
 * - 密钥存储在 localStorage，刷新后自动恢复
 */

import { ref } from 'vue'
import { getStorage, setStorage, removeStorage, STORAGE_KEYS } from '../utils/storage'

/**
 * 密钥认证管理 Hook
 *
 * @returns {Object} {
 *   validKey,    // 当前有效的密钥
 *   isValid,     // 密钥是否有效
 *   validateKey, // 验证密钥方法
 *   clearKey     // 清除密钥方法
 * }
 */
export function useAuth() {
  // 当前有效的密钥（从 localStorage 恢复）
  const validKey = ref(getStorage(STORAGE_KEYS.VALID_KEY) || '')
  // 密钥是否有效
  const isValid = ref(false)

  /**
   * 验证密钥
   *
   * 密钥对应 fund_groups.json 中的分组名
   * 如果密钥存在于分组中，则验证通过
   *
   * @param {string} key - 用户输入的密钥
   * @param {Object} fundGroups - 基金分组配置（可选，不传则从服务器加载）
   * @returns {Promise<boolean>} 验证结果
   */
  async function validateKey(key, fundGroups) {
    // 空密钥：清除状态
    if (!key || !key.trim()) {
      validKey.value = ''
      isValid.value = false
      removeStorage(STORAGE_KEYS.VALID_KEY)
      return false
    }

    // 如果传入了 fundGroups，直接验证
    if (fundGroups && fundGroups[key]) {
      validKey.value = key
      isValid.value = true
      setStorage(STORAGE_KEYS.VALID_KEY, key)
      return true
    }

    // 如果没有传入 fundGroups，从配置加载
    try {
      const res = await fetch('/fund/config/fund_groups.json?t=' + Date.now())
      const groups = await res.json()

      if (groups && groups[key]) {
        validKey.value = key
        isValid.value = true
        setStorage(STORAGE_KEYS.VALID_KEY, key)
        return true
      }
    } catch (e) {
    }

    isValid.value = false
    return false
  }

  /**
   * 清除密钥
   *
   * 退出当前分组，恢复显示全部基金
   */
  function clearKey() {
    validKey.value = ''
    isValid.value = false
    removeStorage(STORAGE_KEYS.VALID_KEY)
  }

  return {
    validKey,
    isValid,
    validateKey,
    clearKey
  }
}