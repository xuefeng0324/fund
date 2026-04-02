/**
 * 配置管理组合式函数
 *
 * 负责加载和管理基金配置数据：
 * - 基金代码列表（fund_codes.json）
 * - 基金分组配置（fund_groups.json）
 *
 * 配置在构建时直接 import 嵌入 bundle，
 * 不依赖运行时网络请求，彻底规避 GitHub Pages 缓存问题。
 */

import { ref } from 'vue'
import { getStorage, setStorage, STORAGE_KEYS } from '../utils/storage'

// 构建时直接 import 配置（Vite 会将 JSON 打入 bundle）
import fundCodesData from '../../public/config/fund_codes.json'
import fundGroupsData from '../../public/config/fund_groups.json'

/**
 * 配置管理 Hook
 *
 * @returns {Object} {
 *   fundCodes,          // 基金代码列表
 *   fundGroups,         // 基金分组配置
 *   configSha,          // 配置文件的 SHA 值（用于 GitHub API 更新）
 *   loading,            // 加载状态
 *   error,              // 错误信息
 *   loadConfig,         // 从 public/config/ 加载配置
 *   loadConfigFromGitHub // 从 GitHub API 加载配置（带 SHA）
 * }
 */
export function useConfig() {
  // 基金代码列表
  const fundCodes = ref([])
  // 基金分组配置 { groupName: [codes] }
  const fundGroups = ref({})
  // 配置文件 SHA 值（用于 GitHub API 更新时检测冲突）
  const configSha = ref({ fundCodes: null, fundGroups: null })
  // 加载状态
  const loading = ref(false)
  // 错误信息
  const error = ref(null)
  // 诊断信息
  const configDiag = ref({ tried: [], succeeded: null, failed: null, fromCache: false })

  /**
   * 加载配置文件
   *
   * 主数据源：构建时 import 的 JSON（嵌入 JS bundle，永不依赖网络）
   * 用户覆盖：localStorage（用户修改的配置优先）
   */
  async function loadConfig() {
    loading.value = true
    error.value = null
    configDiag.value.tried = []
    configDiag.value.succeeded = null
    configDiag.value.failed = null
    configDiag.value.fromCache = false

    configDiag.value.tried.push('bundle')
    const cached = getStorage(STORAGE_KEYS.USER_CONFIG)
    const hasUserConfig = cached &&
      Array.isArray(cached.fundCodes) &&
      cached.fundCodes.length > 0 &&
      cached.fundGroups

    if (hasUserConfig) {
      fundCodes.value = cached.fundCodes
      fundGroups.value = cached.fundGroups
      configDiag.value.succeeded = 'cache'
      configDiag.value.fromCache = true
      console.info('[PXF] 使用用户已保存的配置（localStorage）')
    } else {
      fundCodes.value = Array.isArray(fundCodesData) ? fundCodesData : []
      fundGroups.value = (fundGroupsData && typeof fundGroupsData === 'object') ? fundGroupsData : {}
      configDiag.value.succeeded = 'bundle'
      console.info('[PXF] 使用构建时嵌入的配置数据')
    }

    loading.value = false
    return { fundCodes: fundCodes.value, fundGroups: fundGroups.value }
  }

  async function fetchJsonWithTimeout(url, timeout = CONFIG_FETCH_TIMEOUT) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => {
      if (ctrl) ctrl.abort()
    }, timeout)
    try {
      const res = await fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 通过 GitHub API 获取配置
   *
   * 用于需要更新配置时，获取文件的 SHA 值
   * SHA 是 Git 文件的版本标识，更新时必须提供
   *
   * @param {string} token - GitHub Personal Access Token
   * @returns {Object|null} { fundCodes, fundGroups, sha } 或 null（失败时）
   */
  async function loadConfigFromGitHub(token) {
    try {
      const config = await getFileContent('public/config/fund_codes.json', token)
      const groups = await getFileContent('public/config/fund_groups.json', token)

      fundCodes.value = config.content
      fundGroups.value = groups.content
      configSha.value = {
        fundCodes: config.sha,
        fundGroups: groups.sha
      }

      return {
        fundCodes: fundCodes.value,
        fundGroups: fundGroups.value,
        sha: configSha.value
      }
    } catch (e) {
      return null
    }
  }

  return {
    fundCodes,
    fundGroups,
    configSha,
    loading,
    error,
    loadConfig,
    loadConfigFromGitHub,
    configDiag
  }
}