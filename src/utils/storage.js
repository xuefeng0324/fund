/**
 * localStorage 管理工具
 *
 * 统一管理本地存储的键名前缀和读写操作
 */

const STORAGE_PREFIX = 'fundMonitor_'

/** 存储键名枚举 */
export const STORAGE_KEYS = {
  VALID_KEY: 'ValidKey',      // 用户密钥
  USER_CONFIG: 'UserConfig'   // 用户配置缓存
}

/**
 * 获取带前缀的存储键名
 * @param {string} key - 原始键名
 * @returns {string} 带前缀的键名
 */
export function getStorageKey(key) {
  return STORAGE_PREFIX + key
}

/**
 * 读取本地存储
 * @param {string} key - 键名
 * @returns {any} 解析后的值，不存在或解析失败返回 null
 */
export function getStorage(key) {
  try {
    const data = localStorage.getItem(getStorageKey(key))
    return data ? JSON.parse(data) : null
  } catch (e) {
    return null
  }
}

/**
 * 写入本地存储
 * @param {string} key - 键名
 * @param {any} value - 值（会被 JSON 序列化）
 * @returns {boolean} 是否写入成功
 */
export function setStorage(key, value) {
  try {
    localStorage.setItem(getStorageKey(key), JSON.stringify(value))
    return true
  } catch (e) {
    return false
  }
}

/**
 * 删除本地存储
 * @param {string} key - 键名
 * @returns {boolean} 是否删除成功
 */
export function removeStorage(key) {
  try {
    localStorage.removeItem(getStorageKey(key))
    return true
  } catch (e) {
    return false
  }
}