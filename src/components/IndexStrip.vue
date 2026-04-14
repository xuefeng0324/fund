<template>
  <div
    class="index-strip"
    :style="{
      opacity,
      pointerEvents: opacity <= 0.01 ? 'none' : 'auto'
    }"
  >
    <div class="index-strip-inner">
      <div
        v-for="item in data"
        :key="item.code"
        class="index-card"
      >
        <div class="index-card-title">{{ item.name || item.code }}</div>
        <div class="index-card-price">
          {{ formatPrice(item) }}
        </div>
        <div class="index-card-chg" :class="priceClass(item)">
          {{ formatChange(item) }}
        </div>
        <div class="index-card-pct" :class="priceClass(item)">
          {{ formatPct(item) }}
        </div>
      </div>
      <div v-if="!data || !data.length" class="muted">
        指数数据加载中...
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  data: {
    type: Array,
    default: () => []
  },
  opacity: {
    type: Number,
    default: 1
  }
})

function formatPrice(item) {
  if (item.last == null || isNaN(parseFloat(item.last))) return '--'
  return parseFloat(item.last).toFixed(2)
}

function formatChange(item) {
  if (item.chg == null || isNaN(parseFloat(item.chg))) return '--'
  const sign = item.pct >= 0 ? '+' : ''
  return sign + parseFloat(item.chg).toFixed(2)
}

function formatPct(item) {
  if (item.pct == null || isNaN(parseFloat(item.pct))) return '--'
  const sign = item.pct >= 0 ? '+' : ''
  return sign + parseFloat(item.pct).toFixed(2) + '%'
}

function priceClass(item) {
  if (item.pct == null || isNaN(parseFloat(item.pct))) return ''
  return parseFloat(item.pct) >= 0 ? 'positive' : 'negative'
}
</script>

<style scoped>
.index-strip {
  display: flex;
  justify-content: center;
  padding: 12px 32px;
  background: #fff;
  border-bottom: 1px solid rgba(91, 97, 110, 0.2);
  box-sizing: border-box;
  transition: opacity 0.15s ease-out;
}

.index-strip-inner {
  display: flex;
  gap: 12px;
  width: 100%;
  max-width: 1344px;
  margin: 0 auto;
}

.index-card {
  flex: 1;
  padding: 10px 12px;
  background: #fff;
  border-radius: 12px;
  border: 1px solid rgba(91, 97, 110, 0.2);
  text-align: center;
  transition: border-color 0.2s ease;
}

.index-card:hover {
  border-color: #0052ff;
}

.index-card-title {
  font-size: 12px;
  margin-bottom: 4px;
  color: #5b616e;
  font-weight: 600;
}

.index-card-price {
  font-size: 18px;
  font-weight: 700;
  color: #0a0b0d;
  margin-bottom: 2px;
}

.index-card-chg {
  font-size: 13px;
  font-weight: 600;
  color: #5b616e;
}

.index-card-pct {
  font-size: 13px;
  font-weight: 600;
  color: #5b616e;
}

.positive {
  color: #dc2626;
}

.negative {
  color: #16a34a;
}

.muted {
  color: #5b616e;
  font-size: 13px;
  padding: 12px;
}

@media (max-width: 768px) {
  .index-strip {
    padding: 8px 16px;
  }

  .index-strip-inner {
    flex-wrap: wrap;
    gap: 6px;
  }

  .index-card {
    flex: 0 0 calc(25% - 6px);
    max-width: calc(25% - 6px);
    min-width: 0;
    padding: 6px 4px;
  }

  .index-card-title {
    font-size: 11px;
    margin-bottom: 2px;
    font-weight: 700;
  }

  .index-card-price {
    font-size: 14px;
    margin-bottom: 1px;
  }

  .index-card-chg {
    font-size: 11px;
  }
}
</style>
