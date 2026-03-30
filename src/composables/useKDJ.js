/**
 * KDJ 指标组合式函数
 */

import { ref } from 'vue'
import { fetchPingzhongdata } from '../api/funds'
import { computeKDJ, groupWeeklyLast, movingAverage } from '../utils/kdj'

export function useKDJ() {
  const loading = ref(false)
  const cache = ref({})

  async function fetchKDJ(code) {
    if (cache.value[code]) {
      return cache.value[code]
    }

    loading.value = true

    try {
      const trend = await fetchPingzhongdata(code)

      if (!trend || trend.length < 10) {
        return {}
      }

      // 日K（近3个月）
      const cutDay = Date.now() - 92 * 86400000
      const daily = trend.filter(it => it.x >= cutDay)
      const dailyToUse = daily.length >= 10 ? daily : trend
      const dailyCloses = dailyToUse.map(it => it.y).filter(y => y != null)
      const dailyKDJ = computeKDJ(dailyCloses)
      const jDaily = dailyKDJ.j

      // 周K（近1年）
      const cutWeek = Date.now() - 370 * 86400000
      const weekly = trend.filter(it => it.x >= cutWeek)
      const weeklyToUse = weekly.length >= 10 ? weekly : trend
      const weeklyData = weeklyToUse.map(it => [new Date(it.x).toISOString().slice(0, 10), it.y])
      const weeklyCloses = groupWeeklyLast(weeklyData)
      const weeklyKDJ = computeKDJ(weeklyCloses)
      const jWeekly = weeklyKDJ.j

      // 周均线
      const allWeeklyCloses = groupWeeklyLast(trend.map(it => [new Date(it.x).toISOString().slice(0, 10), it.y]))
      const ma30Weekly = movingAverage(allWeeklyCloses, 30)
      const ma60Weekly = movingAverage(allWeeklyCloses, 60)

      const result = {
        code,
        j_daily: jDaily,
        j_weekly: jWeekly,
        weekly_close: allWeeklyCloses[allWeeklyCloses.length - 1],
        ma30_weekly: ma30Weekly,
        ma60_weekly: ma60Weekly
      }

      cache.value[code] = result
      return result
    } catch (e) {
      return {}
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    cache,
    fetchKDJ
  }
}