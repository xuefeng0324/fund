/**
 * 配置管理组合式函数
 *
 * 负责加载和管理基金配置数据：
 * - 基金代码列表（fund_codes.json）
 * - 基金分组配置（fund_groups.json）
 *
 * 配置文件放在 public/config/ 目录，运行时请求加载
 * 修改配置文件后无需重新构建，刷新页面即可生效
 */

import { ref } from 'vue'
import { getFileContent } from '../api/github'
import { getStorage, setStorage, STORAGE_KEYS } from '../utils/storage'

const CONFIG_FETCH_TIMEOUT = 8000

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
   * 从 public/config/ 目录请求配置文件
   * 添加时间戳参数避免浏览器缓存
   *
   * @returns {Object|null} { fundCodes, fundGroups } 或 null（失败时）
   */
  async function loadConfig() {
    loading.value = true
    error.value = null
    configDiag.value.tried = []
    configDiag.value.succeeded = null
    configDiag.value.failed = null
    configDiag.value.fromCache = false

    try {
      const t = Date.now()
      const primaryCodes = `/fund/config/fund_codes.json?t=${t}`
      const primaryGroups = `/fund/config/fund_groups.json?t=${t}`
      const fallbackCodes = `https://xuefeng0324.github.io/fund/config/fund_codes.json?t=${t}`
      const fallbackGroups = `https://xuefeng0324.github.io/fund/config/fund_groups.json?t=${t}`

      let codes = null
      let groups = null

      // Primary
      configDiag.value.tried.push('primary')
      try {
        ;[codes, groups] = await Promise.all([
          fetchJsonWithTimeout(primaryCodes),
          fetchJsonWithTimeout(primaryGroups)
        ])
        configDiag.value.succeeded = 'primary'
      } catch (e1) {
        // Fallback
        configDiag.value.tried.push('fallback')
        try {
          ;[codes, groups] = await Promise.all([
            fetchJsonWithTimeout(fallbackCodes),
            fetchJsonWithTimeout(fallbackGroups)
          ])
          configDiag.value.succeeded = 'fallback'
        } catch (e2) {
          // Cache
          configDiag.value.tried.push('cache')
          const cached = getStorage(STORAGE_KEYS.USER_CONFIG)
          if (cached && Array.isArray(cached.fundCodes) && cached.fundCodes.length > 0 && cached.fundGroups) {
            fundCodes.value = cached.fundCodes
            fundGroups.value = cached.fundGroups
            configDiag.value.fromCache = true
            configDiag.value.succeeded = 'cache'
            return { fundCodes: fundCodes.value, fundGroups: fundGroups.value, fromCache: true }
          }
          configDiag.value.failed = 'all'
          throw new Error('配置加载失败（主路径/回退路径/本地缓存均不可用）')
        }
      }

      fundCodes.value = Array.isArray(codes) ? codes : []
      fundGroups.value = groups && typeof groups === 'object' ? groups : {}
      setStorage(STORAGE_KEYS.USER_CONFIG, {
        fundCodes: fundCodes.value,
        fundGroups: fundGroups.value,
        updatedAt: Date.now()
      })

      return { fundCodes: fundCodes.value, fundGroups: fundGroups.value }
    } catch (e) {
      error.value = e.message
      return null
    } finally {
      loading.value = false
    }
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