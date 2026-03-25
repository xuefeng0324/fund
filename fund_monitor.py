#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
基金监控（本地HTTP服务）

相对你桌面版 fund_monitor.py 的关键改动：
- 估值分时：不再依赖本地采样/保存；改为直接从 pingzhongdata 的 Data_fundValueTrend 拉取“历史分时”。
- HTTP：参考 1_fund_nav_extract.py，统一 GET 文本解码策略，降低乱码/风控导致的失败概率。
- 实时估值：批量接口 FundMNFInfo 仍为主；当某基金 GSZ/GZTIME 缺失时，自动用 fundgz.1234567 补齐。
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from datetime import datetime, timedelta
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
import traceback
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

try:
    import akshare as ak  # type: ignore[import]
except Exception:
    ak = None

# ========== 配置区 ==========
FUND_CODES = [
    "001549",
    "012922",
    "024195",
    "014425",
    "012349",
    "004010",
    "012847",
    "025949",
    "007467",
    "004753",
    "024329",
    "010364",
    "001595",
    "020256",
    "008591",
    "014413",
    "008280",
    "016858",
    "014162",
    "020900",
    "014111",
    "017836",
    "004744",
    "006531",
    "005918",
    "012805",
    "011103",
    "012414",
    "400015",
    "004643",
    "012769",
    "019667",
    "025209",
    "011613",
    # 下面这几只是你当前自选里的部分基金，之前通过特殊列表强制归到“上一交易日涨跌”区，
    # 现在改为按是否有估值(GSZ)自动分组，这里仅作为普通基金代码存在。
    "006328",
    "019671",
    "020404",
    "019005",
]

ETF_MAPPING = {
    "001549": "510050",
    "024195": "159819",
    "014425": "513060",
    "012349": "513130",
    "007467": "512890",
    "004753": "512980",
    "024329": "513200",
    "001595": "515290",
    "020256": "159530",
    "008591": "159841",
    "008280": "515220",
    "014111": "159608",
    "004744": "159977",
    "005918": "515330",
    "012805": "513380",
    "011103": "159857",
    "012414": "161725",
    "004643": "512200",
    "012769": "159869",
    "011613": "588000",
    "010364": "160643",
    "019667": "516080",
}

# 可选：基金 -> 场内 LOF/ETF 代码（用于新浪/腾讯等备选数据源）
LOF_MAPPING = {
    # 示例：易方达信创ETF联接C -> 对应场内ETF代码
    "020404": "588400",  # 若有更准确映射，可在此处调整
}

# 密钥分组配置：密钥 -> 基金代码列表（用于按密钥过滤显示）
# 如果输入密钥，只显示该密钥对应的基金；如果密钥为空，显示全部基金
# 从文件加载，支持动态更新
FUND_GROUPS_BY_KEY: Dict[str, List[str]] = {}

# 缓存配置
SPARKLINE_CACHE: Dict[str, Dict[str, Any]] = {}
SPARKLINE_TTL_SECONDS = 60 * 60 * 6
INTRADAY_CACHE_TTL_SECONDS = 60 * 5
AK_FUND_EST_CACHE: Dict[str, Any] = {}  # akshare fund_value_estimation_em 缓存：{"ts": float, "data": {code: row_dict}}

# 仍保留本地存储（用于“建议”里拿到更接近实时的采样价），但分时图不再依赖它
INTRADAY_STORE_FILE = os.path.join(os.path.dirname(__file__), "intraday_store.json")
INTRADAY_LOCK = threading.Lock()
INTRADAY_STORE: Dict[str, Any] = {}

FUND_CODES_FILE = os.path.join(os.path.dirname(__file__), "fund_codes.json")
FUND_GROUPS_FILE = os.path.join(os.path.dirname(__file__), "fund_groups.json")

# 建议缓存：在估值/净值未变化时，避免重复计算买卖建议
ADVICE_CACHE: Dict[str, Dict[str, Any]] = {}
ADVICE_VER: Dict[str, str] = {}
ADVICE_LOCK = threading.Lock()


# ========== 工具函数 ==========
def _safe_float(val: Any, default: Optional[float] = None) -> Optional[float]:
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip()
    if not s or s == "--":
        return default
    try:
        return float(s)
    except ValueError:
        return default


def _today_str() -> str:
    return time.strftime("%Y-%m-%d", time.localtime())


def _hhmm_from_gztime(gztime: Any) -> Optional[str]:
    if not gztime:
        return None
    parts = str(gztime).split(" ")
    if len(parts) >= 2:
        return parts[1][:5]
    return None


def _moving_average(values: List[float], window: int) -> Optional[float]:
    if not values or window <= 0 or len(values) < window:
        return None
    return sum(values[-window:]) / window


def _pct(a: Any, b: Any) -> Optional[float]:
    if a is None or b in (None, 0):
        return None
    try:
        return (float(a) - float(b)) / float(b) * 100.0
    except Exception:
        return None


# ========== HTTP（参考 1_fund_nav_extract.py）==========
def _http_get_text(url: str, timeout_s: int = 20) -> str:
    """
    统一 GET 文本请求：
    - UA：用朴素 UA 减少移动接口风控
    - 编码：兼容服务端 charset 不规范/缺失
    """
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0", "Accept": "*/*", "Referer": "http://fund.eastmoney.com/"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        raw = resp.read()
        charset = resp.headers.get_content_charset()
        if charset:
            charset = charset.split(",")[0].strip().lower()
            try:
                return raw.decode(charset, errors="replace")
            except LookupError:
                pass

        # 无charset时：pingzhongdata 常见为 gb/gb2312；移动端 JSON 常见为 utf-8。
        # 用“中文命中率 + � 数量”做一个启发式择优。
        text_utf8 = raw.decode("utf-8", errors="replace")
        text_gbk = raw.decode("gb18030", errors="replace")

        def score(s: str) -> Tuple[int, int]:
            cjk = sum(1 for ch in s if "\u4e00" <= ch <= "\u9fff")
            bad = s.count("\ufffd")
            return (cjk, -bad)

        return text_gbk if score(text_gbk) > score(text_utf8) else text_utf8


def _http_get_json(url: str, timeout_s: int = 20) -> Dict[str, Any]:
    text = _http_get_text(url, timeout_s=timeout_s)
    obj = json.loads(text)
    if not isinstance(obj, dict):
        raise RuntimeError("返回不是JSON对象(dict)")
    return obj


def _now_ms() -> int:
    return int(time.time() * 1000)


# ========== 数据获取逻辑 ==========
def fetch_realtime_akshare_estimation(codes: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    备选实时估值源：AKShare fund_value_estimation_em(symbol="全部")。
    依赖外部安装 akshare，仅作为测试/辅助接口使用。
    返回 map: code -> {FCODE, SHORTNAME, GSZ, GSZZL, GZTIME, SRC}
    """
    if ak is None or not codes:
        return {}
    now = time.time()
    cached_ts = AK_FUND_EST_CACHE.get("ts", 0)
    data_map: Dict[str, Dict[str, Any]] = AK_FUND_EST_CACHE.get("data") or {}
    # 1 分钟内复用缓存，避免频繁全量拉取
    if not data_map or now - cached_ts > 60:
        try:
            df = ak.fund_value_estimation_em(symbol="全部")  # type: ignore[attr-defined]
        except Exception:
            return {}
        data_map = {}
        try:
            # 动态识别当日“估算值/估算涨幅”所在的列（列名形如：2026-03-13-估算数据-估算值）
            cols = [str(c) for c in getattr(df, "columns", [])]
            est_val_col = next((c for c in cols if "估算数据-估算值" in c), None)
            est_pct_col = next((c for c in cols if "估算数据-日增长率" in c), None)
            # 前一日单位净值列：形如“2026-03-12-单位净值”
            prev_nav_col = None
            for c in reversed(cols):
                if "单位净值" in c and "公布数据" not in c and "估算数据" not in c:
                    prev_nav_col = c
                    break

            for _, row in df.iterrows():  # type: ignore[attr-defined]
                try:
                    code = str(row.get("基金代码") or row.get("基金代码（基金代码）") or "").strip()
                except Exception:
                    code = ""
                if not code:
                    continue
                name = (row.get("基金简称") or row.get("基金名称") or "").strip()
                gsz = row.get(est_val_col) if est_val_col else None
                gz_zl = row.get(est_pct_col) if est_pct_col else None
                gsz_f = _safe_float(gsz)
                gz_zl_f = _safe_float(gz_zl)

                # 若接口没给估算涨跌，尝试用“估算净值 / 昨日单位净值 - 1”反推
                if gz_zl_f is None and gsz_f is not None and prev_nav_col:
                    prev_nav = _safe_float(row.get(prev_nav_col))
                    if prev_nav not in (None, 0):
                        try:
                            gz_zl_f = (gsz_f / float(prev_nav) - 1.0) * 100.0
                        except Exception:
                            gz_zl_f = None

                gtime = _today_str()
                data_map[code] = {
                    "FCODE": code,
                    "SHORTNAME": name or None,
                    "GSZ": gsz_f,
                    "GSZZL": gz_zl_f,
                    "GZTIME": gtime,
                    "SRC": "akshare_est",
                }
        except Exception:
            data_map = {}
        AK_FUND_EST_CACHE["ts"] = now
        AK_FUND_EST_CACHE["data"] = data_map
    # 只返回所需 codes
    out: Dict[str, Dict[str, Any]] = {}
    for c in codes:
        if c in data_map:
            out[c] = dict(data_map[c])
    return out

def _fund_to_stock_ticker_for_sina(code: str) -> Optional[str]:
    """
    将基金代码映射为新浪股票实时行情代码，例如:
    - '588000' -> 'sh588000'
    - '159915' -> 'sz159915'
    先查 ETF_MAPPING，再查 LOF_MAPPING。
    """
    etf = ETF_MAPPING.get(code) or LOF_MAPPING.get(code)
    if not etf:
        return None
    etf = str(etf).strip()
    if not etf.isdigit():
        return None
    return ("sh" + etf) if etf.startswith(("5", "6")) else ("sz" + etf)


def fetch_realtime_sina_fund(code: str) -> Dict[str, Any]:
    """
    备选实时行情源：新浪“基金实时行情”接口。
    使用 fu_基金代码 形式，例如 fu_020404。
    返回: {GSZ, GSZZL, GZTIME, SHORTNAME, SRC}
    说明：字段含义参考网络资料，大致为：
      0 基金名称, 1 单位净值, 2 累计净值, 3 估算净值, 4 估算增量, 5 估算涨幅%, 6 估算时间, ...
    """
    url = f"http://hq.sinajs.cn/list=fu_{urllib.parse.quote(code)}"
    text = _http_get_text(url, timeout_s=5)
    m = re.search(r'="([^"]*)"', text)
    if not m:
        return {}
    parts = m.group(1).split(",")
    if len(parts) < 7:
        return {}
    name = (parts[0] or "").strip()
    gsz = _safe_float(parts[3])  # 估算净值
    gz_zl = _safe_float(parts[5])  # 估算涨幅%
    gz_time = (parts[6] or "").strip()
    if gsz is None:
        return {}
    return {
        "FCODE": code,
        "SHORTNAME": name or None,
        "GSZ": gsz,
        "GSZZL": gz_zl,
        "GZTIME": gz_time or None,
        "SRC": "sina_fund",
    }


def fetch_realtime_sina_stock(ticker: str) -> Dict[str, Any]:
    """
    备选实时行情源：新浪股票接口。
    ticker 如 'sh510300' / 'sz159915'。
    返回: {GSZ, GSZZL, GZTIME, SRC}
    """
    url = f"http://hq.sinajs.cn/list={urllib.parse.quote(ticker)}"
    text = _http_get_text(url, timeout_s=5)
    m = re.search(r'="([^"]*)"', text)
    if not m:
        return {}
    parts = m.group(1).split(",")
    if len(parts) < 4:
        return {}
    last = _safe_float(parts[3])  # 现价
    prev = _safe_float(parts[2])  # 昨收
    if last is None or prev in (None, 0):
        return {}
    try:
        gz = float(last)
        gz_zl = (gz - float(prev)) / float(prev) * 100.0
    except Exception:
        return {}
    return {
        "GSZ": gz,
        "GSZZL": gz_zl,
        "GZTIME": None,
        "SRC": "sina_stock",
    }

INDEX_SECIDS = [
    "1.000001",  # 上证指数
    "1.000300",  # 沪深300
    "0.399001",  # 深证成指
    "0.399006",  # 创业板指
]


def get_index_snapshot() -> List[Dict[str, Any]]:
    """
    获取几大指数的即时快照（点位 + 涨跌点数 + 涨跌幅）。
    数据源：东方财富 push2 ulist 接口。
    """
    if not INDEX_SECIDS:
        return []
    secids_str = ",".join(INDEX_SECIDS)
    url = (
        "https://push2.eastmoney.com/api/qt/ulist.np/get"
        f"?fltt=2&secids={urllib.parse.quote(secids_str)}"
        "&fields=f2,f3,f4,f12,f14"
    )
    out: List[Dict[str, Any]] = []
    try:
        obj = _http_get_json(url, timeout_s=10)
        datas = (obj.get("data") or {}).get("diff") or []
        for it in datas:
            if not isinstance(it, dict):
                continue
            try:
                code = str(it.get("f12") or "")
                name = str(it.get("f14") or "")
                last = _safe_float(it.get("f2"))
                pct = _safe_float(it.get("f3"))
                chg = _safe_float(it.get("f4"))
            except Exception:
                continue
            out.append(
                {
                    "code": code,
                    "name": name,
                    "last": last,
                    "chg": chg,
                    "pct": pct,
                }
            )
    except Exception as e:
        print(f"获取指数快照失败: {e}")
    return out
def fetch_realtime_batch(codes: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    批量实时估值（FundMNFInfo）。字段可能为 null（尤其 GSZ/GZTIME）。
    """
    if not codes:
        return {}
    fc_str = ",".join(codes)
    url = (
        "https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo"
        "?pageIndex=1&pageSize=200&plat=Android&appType=ttjj&product=EFund&Version=1"
        f"&deviceid=Wap&Fcodes={urllib.parse.quote(fc_str)}"
    )
    result_map: Dict[str, Dict[str, Any]] = {}
    try:
        data = _http_get_json(url, timeout_s=20)
        datas = data.get("Datas") or []
        for item in datas:
            if not isinstance(item, dict):
                continue
            code = item.get("FCODE")
            if not code:
                continue
            gsz = _safe_float(item.get("GSZ"))
            gszzl = _safe_float(item.get("GSZZL"))
            pdate = item.get("PDATE")  # 最近一次已公布净值日期
            result_map[code] = {
                "FCODE": code,
                "SHORTNAME": item.get("SHORTNAME"),
                "GSZ": gsz,
                "GSZZL": gszzl,
                "DWJZ": _safe_float(item.get("NAV")),
                "GZTIME": item.get("GZTIME"),
                "PDATE": pdate,
            }
    except Exception as e:
        print(f"批量获取实时数据失败: {e}")
    return result_map


def fetch_realtime_single_fundgz(code: str) -> Dict[str, Any]:
    """
    单只实时估值补齐（fundgz.1234567）：
    返回 JSONP: jsonpgz({...});
    """
    url = f"https://fundgz.1234567.com.cn/js/{urllib.parse.quote(code)}.js?rt={_now_ms()}"
    text = _http_get_text(url, timeout_s=15)
    m = re.search(r"jsonpgz\((\{.*\})\)\s*;?\s*$", text.strip(), flags=re.S)
    if not m:
        raise RuntimeError(f"fundgz返回格式异常: {text[:200]!r}")
    obj = json.loads(m.group(1))
    if not isinstance(obj, dict):
        raise RuntimeError("fundgz返回不是JSON对象(dict)")
    return {
        "FCODE": obj.get("fundcode") or code,
        "SHORTNAME": obj.get("name"),
        "GSZ": _safe_float(obj.get("gsz")),
        "GSZZL": _safe_float(obj.get("gszzl")),
        "DWJZ": _safe_float(obj.get("dwjz")),
        "GZTIME": obj.get("gztime"),
    }


def fetch_realtime_auto(codes: List[str], mode: str = "auto") -> Dict[str, Dict[str, Any]]:
    """
    先批量 mnfinfo；若某只 GSZ/GZTIME 缺失则用 fundgz 补齐。
    输出 map: code -> info
    """
    # 特殊模式：仅使用某个单一数据源，便于临时测试。
    mode = (mode or "auto").lower()
    if mode == "em":
        # 仅东财 FundMNFInfo 批量接口
        return fetch_realtime_batch(codes)

    if mode == "akshare":
        # 仅 AKShare fund_value_estimation_em，名称优先东财
        base = fetch_realtime_batch(codes)
        ak_map = fetch_realtime_akshare_estimation(codes)
        out: Dict[str, Dict[str, Any]] = {}
        for c in codes:
            base_info = dict(base.get(c) or {})
            snap = dict(ak_map.get(c) or {})
            info: Dict[str, Any] = {}
            info.update(base_info)
            info.update({k: v for k, v in snap.items() if k in ("GSZ", "GSZZL", "GZTIME", "SRC")})
            if snap.get("SHORTNAME") and not info.get("SHORTNAME"):
                info["SHORTNAME"] = snap.get("SHORTNAME")
            info.setdefault("FCODE", c)
            info.setdefault("GSZ", None)
            info.setdefault("GSZZL", None)
            info.setdefault("GZTIME", "--")
            out[c] = info
        return out

    if mode == "fundgz":
        # 仅天天基金 fundgz 单只接口，但名称仍优先使用东财 FundMNFInfo，保证名称口径一致
        base = fetch_realtime_batch(codes)
        out: Dict[str, Dict[str, Any]] = {}
        for c in codes:
            base_info = dict(base.get(c) or {})
            try:
                gz = fetch_realtime_single_fundgz(c)
            except Exception:
                gz = {}
            info: Dict[str, Any] = {}
            info.update(base_info)
            info.update(gz)
            info.setdefault("FCODE", c)
            info.setdefault("GSZ", None)
            info.setdefault("GSZZL", None)
            info.setdefault("GZTIME", "--")
            out[c] = info
        return out

    if mode == "sina_fund":
        # 名称仍优先用东财 FundMNFInfo / fundgz，估值相关字段来自新浪基金接口
        base = fetch_realtime_batch(codes)
        out: Dict[str, Dict[str, Any]] = {}
        for c in codes:
            base_info = dict(base.get(c) or {})
            try:
                snap = fetch_realtime_sina_fund(c)
            except Exception:
                snap = {}
            if snap.get("GSZ") is not None:
                info: Dict[str, Any] = {}
                info.update(base_info)
                info["FCODE"] = c
                info["GSZ"] = snap.get("GSZ")
                info["GSZZL"] = snap.get("GSZZL")
                info["GZTIME"] = snap.get("GZTIME") or base_info.get("GZTIME") or "--"
                if not info.get("SHORTNAME"):
                    info["SHORTNAME"] = snap.get("SHORTNAME")
                info["SRC"] = snap.get("SRC")
            else:
                info = base_info or {"FCODE": c}
                info.setdefault("FCODE", c)
                info.setdefault("GSZ", None)
                info.setdefault("GSZZL", None)
                info.setdefault("GZTIME", "--")
            out[c] = info
        return out

    if mode == "sina_stock":
        # 仅新浪股票行情（通过 ETF/LOF 场内代码映射）
        base = fetch_realtime_batch(codes)
        out: Dict[str, Dict[str, Any]] = {}
        for c in codes:
            base_info = dict(base.get(c) or {})
            ticker = _fund_to_stock_ticker_for_sina(c)
            if ticker:
                try:
                    snap = fetch_realtime_sina_stock(ticker)
                except Exception:
                    snap = {}
            else:
                snap = {}
            if snap.get("GSZ") is not None:
                info = {}
                info.update(base_info)
                info["FCODE"] = c
                info["GSZ"] = snap.get("GSZ")
                info["GSZZL"] = snap.get("GSZZL")
                info["GZTIME"] = base_info.get("GZTIME") or "--"
                if not info.get("SHORTNAME"):
                    info["SHORTNAME"] = base_info.get("SHORTNAME")
                info["SRC"] = snap.get("SRC")
            else:
                info = base_info or {"FCODE": c}
                info.setdefault("FCODE", c)
                info.setdefault("GSZ", None)
                info.setdefault("GSZZL", None)
                info.setdefault("GZTIME", "--")
            out[c] = info
        return out

    # 默认模式：东财批量 + fundgz + AKShare + 新浪基金 + 新浪股票 多源自动补齐
    m = fetch_realtime_batch(codes)
    ak_map = fetch_realtime_akshare_estimation(codes)
    for c in codes:
        r = m.get(c)
        need_fill = (
            r is None
            or r.get("GSZ") is None
            or r.get("GZTIME") in (None, "", "--")
        )
        if need_fill:
            # 1) 优先用 fundgz 补齐
            try:
                gz = fetch_realtime_single_fundgz(c)
                if r is None:
                    r = gz
                    m[c] = r
                else:
                    r["GSZ"] = gz.get("GSZ") if r.get("GSZ") is None else r.get("GSZ")
                    r["GSZZL"] = gz.get("GSZZL") if r.get("GSZZL") is None else r.get("GSZZL")
                    r["GZTIME"] = gz.get("GZTIME") if r.get("GZTIME") in (None, "", "--") else r.get("GZTIME")
                    if not r.get("SHORTNAME"):
                        r["SHORTNAME"] = gz.get("SHORTNAME")
                time.sleep(0.12)
            except Exception:
                # 静默失败：后面还有其他备选源
                pass

        # 2) 若仍然没有 GSZ，则尝试 AKShare 估值
        if (r is None or r.get("GSZ") is None) and ak_map:
            snap_ak = ak_map.get(c) or {}
            if snap_ak.get("GSZ") is not None:
                if r is None:
                    r = {"FCODE": c}
                    m[c] = r
                r["GSZ"] = snap_ak.get("GSZ")
                r["GSZZL"] = snap_ak.get("GSZZL")
                r["GZTIME"] = snap_ak.get("GZTIME") or r.get("GZTIME") or "--"
                if not r.get("SHORTNAME"):
                    r["SHORTNAME"] = snap_ak.get("SHORTNAME")
                r["SRC"] = snap_ak.get("SRC") or r.get("SRC")

        # 3) 若仍然没有 GSZ，则尝试新浪“基金实时行情”接口 fu_代码
        if r is None or r.get("GSZ") is None:
            try:
                snap_fund = fetch_realtime_sina_fund(c)
                if snap_fund.get("GSZ") is not None:
                    if r is None:
                        r = {"FCODE": c}
                        m[c] = r
                    r["GSZ"] = snap_fund.get("GSZ")
                    r["GSZZL"] = snap_fund.get("GSZZL")
                    if not r.get("GZTIME") or r.get("GZTIME") in ("--", ""):
                        r["GZTIME"] = snap_fund.get("GZTIME") or r.get("GZTIME")
                    if not r.get("SHORTNAME"):
                        r["SHORTNAME"] = snap_fund.get("SHORTNAME")
                    r["SRC"] = snap_fund.get("SRC")
            except Exception:
                pass

        # 4) 仍然没有 GSZ，则尝试新浪股票接口（通过 ETF/LOF 映射）
        if r is None or r.get("GSZ") is None:
            ticker = _fund_to_stock_ticker_for_sina(c)
            if ticker:
                try:
                    snap = fetch_realtime_sina_stock(ticker)
                    if snap.get("GSZ") is not None:
                        if r is None:
                            r = {"FCODE": c}
                            m[c] = r
                        r["GSZ"] = snap.get("GSZ")
                        r["GSZZL"] = snap.get("GSZZL")
                        # 若东财没有时间，可不填 GZTIME，让前端展示 '--'
                        if not r.get("GZTIME"):
                            r["GZTIME"] = "--"
                        r["SRC"] = snap.get("SRC")
                except Exception:
                    pass
    return m


def get_last_trading_change(code: str) -> Tuple[str, Optional[float], str]:
    """获取上一交易日涨跌幅（pingzhongdata: Data_netWorthTrend 的 equityReturn）"""
    url = f"http://fund.eastmoney.com/pingzhongdata/{code}.js"
    try:
        text = _http_get_text(url, timeout_s=15)
        name_match = re.search(r'var\s+fS_name\s*=\s*"([^"]+)"', text)
        name = name_match.group(1) if name_match else "--"
        trend_match = re.search(r"var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);", text)
        if not trend_match:
            return name, None, "--"
        data_list = json.loads(trend_match.group(1))
        if not data_list:
            return name, None, "--"
        last = data_list[-1]
        change = last.get("equityReturn")
        date_ms = last.get("x")
        try:
            dt = time.localtime(int(date_ms / 1000))
            date_str = time.strftime("%Y-%m-%d", dt)
        except Exception:
            date_str = "--"
        return name, _safe_float(change), date_str
    except Exception as e:
        print(f"获取 {code} 上一交易日涨跌幅失败：{e}")
        return "--", None, "--"


def get_fund_data(fund_codes: List[str], mode: str = "auto") -> List[Dict[str, Any]]:
    """主获取逻辑：批量获取 + 多数据源回退；所有源都拿不到估值的才放到“上一交易日涨跌”

    mode:
        - "auto"       默认模式：东财批量 + fundgz + 新浪基金 + 新浪股票 多源自动补齐
        - "em"         仅使用东财 FundMNFInfo 批量接口
        - "fundgz"     仅使用 fundgz.1234567 单只接口
        - "sina_fund"  仅使用新浪基金实时行情接口（fu_代码）
        - "sina_stock" 仅使用新浪股票实时行情接口（通过 ETF/LOF 场内代码）
        - "akshare"    仅使用 AKShare fund_value_estimation_em(symbol="全部")
    """
    results: List[Dict[str, Any]] = []
    # 新交易日开始时，清理掉前几天的本地分时估值采样，避免旧数据干扰
    cleanup_intraday_store_for_today()

    # 1) 主 + 备数据源：只要任何源能拿到估值，就归入“实时估值基金”
    batch_data = fetch_realtime_auto(fund_codes, mode=mode)
    no_estimate_codes: List[str] = []

    for code in fund_codes:
        info = batch_data.get(code)
        if info and info.get("GSZ") is not None:
            # 如果当天官方净值已公布，则覆盖估值：用 DWJZ 代替 GSZ，
            # 同时若能拿到“当天净值涨跌”，则用净值涨跌替换估值涨跌。
            pdate = (info.get("PDATE") or "").strip()
            try:
                today = _today_str()
            except Exception:
                today = ""
            if pdate and today and pdate == today and info.get("DWJZ") is not None:
                info["GSZ"] = info.get("DWJZ")
                # 若能从 pingzhongdata 拿到当天净值涨跌，则覆盖 GSZZL
                try:
                    _, day_change, day_date = get_last_trading_change(code)
                    if day_change is not None and day_date == pdate:
                        info["GSZZL"] = day_change
                except Exception:
                    pass
                # 此时 GZTIME 直接使用净值日期（无具体时间）
                info["GZTIME"] = pdate

            # 无论是否有官方净值，都按当前的 GSZ/GZTIME 记录一个分时点
            record_intraday_point(code, info.get("GSZ"), info.get("GZTIME"))
            results.append(info)
        else:
            no_estimate_codes.append(code)

    # 2) 所有源都拿不到估值的基金：只展示上一交易日涨跌
    #    名称优先使用东财/FundMNFInfo 或 fundgz 返回的 SHORTNAME，避免 pingzhongdata 解码乱码
    for code in no_estimate_codes:
        info0 = batch_data.get(code) or {}
        short = info0.get("SHORTNAME")
        short = short.strip() if isinstance(short, str) else ""
        name_ping, last_change, last_date = get_last_trading_change(code)
        name = short or name_ping
        results.append(
            {
                "FCODE": code,
                "SHORTNAME": name,
                "GSZ": None,
                "GSZZL": None,
                "GZTIME": last_date,
                "LAST_CHG": last_change,
            }
        )
    # 调试输出：看一下实际返回了多少只基金，避免前端因空数组看起来“全空白”
    try:
        print(f"[get_fund_data] mode={mode}, 输入代码数={len(fund_codes)}, 返回结果数={len(results)}")
    except Exception:
        pass
    return results


# ========== 趋势/分时图 ==========
def _parse_pingzhongdata_networth_series(text: str) -> Tuple[str, List[Tuple[str, float]]]:
    """
    从 pingzhongdata/{code}.js 中抽取净值序列 Data_netWorthTrend。
    返回: (name, [(YYYY-MM-DD, close), ...])  按日期升序。
    """
    name_match = re.search(r'var\s+fS_name\s*=\s*"([^"]+)"', text)
    name = name_match.group(1) if name_match else "--"

    m = re.search(r"var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);", text)
    if not m:
        return name, []
    raw = json.loads(m.group(1))
    if not isinstance(raw, list) or not raw:
        return name, []

    out: List[Tuple[str, float]] = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        y = _safe_float(it.get("y"))
        x = it.get("x")
        if y is None or x is None:
            continue
        try:
            ds = time.strftime("%Y-%m-%d", time.localtime(int(x) / 1000))
        except Exception:
            continue
        out.append((ds, float(y)))

    # 升序、去重（同日取最后一条）
    out.sort(key=lambda t: t[0])
    dedup: Dict[str, float] = {}
    for ds, v in out:
        dedup[ds] = v
    return name, sorted(dedup.items(), key=lambda t: t[0])


def _group_weekly_last(daily: List[Tuple[str, float]]) -> List[Tuple[str, float]]:
    """
    日序列聚合成周线：同一 ISO 周取最后一个交易日作为周 close。
    输出 (date, close) 仍按日期升序。
    """
    buckets: Dict[Tuple[int, int], Tuple[str, float]] = {}
    for ds, close in daily:
        try:
            d = datetime.strptime(ds, "%Y-%m-%d").date()
        except Exception:
            continue
        iso = d.isocalendar()  # (year, week, weekday)
        key = (int(iso[0]), int(iso[1]))
        buckets[key] = (ds, float(close))  # 遍历是升序时覆盖即可取最后一天；我们后面也会再排序
    weekly = list(buckets.values())
    weekly.sort(key=lambda t: t[0])
    return weekly


def get_nav_sparkline_points(code: str, points: int = 60) -> Optional[Dict[str, Any]]:
    now = time.time()
    cache_key = f"nav:{code}:{points}"
    cached = SPARKLINE_CACHE.get(cache_key)
    if cached and (now - cached.get("ts", 0) < SPARKLINE_TTL_SECONDS):
        return cached.get("data")

    url = f"http://fund.eastmoney.com/pingzhongdata/{code}.js"
    try:
        text = _http_get_text(url, timeout_s=15)
        name_match = re.search(r'var\s+fS_name\s*=\s*"([^"]+)"', text)
        name = name_match.group(1) if name_match else "--"
        trend_match = re.search(r"var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);", text)
        if not trend_match:
            return None
        data_list = json.loads(trend_match.group(1))
        if not data_list:
            return None
        tail = data_list[-points:] if len(data_list) > points else data_list
        ys: List[float] = []
        last_date = "--"
        for item in tail:
            y = item.get("y")
            if y is None:
                continue
            fv = _safe_float(y)
            if fv is None:
                continue
            ys.append(fv)
            if item.get("x"):
                try:
                    dt = time.localtime(int(item["x"] / 1000))
                    last_date = time.strftime("%Y-%m-%d", dt)
                except Exception:
                    pass
        if len(ys) < 2:
            return None
        data = {"code": code, "name": name, "points": ys, "date": last_date}
        SPARKLINE_CACHE[cache_key] = {"ts": now, "data": data}
        return data
    except Exception:
        return None


def get_nav_sparkline_points_daily_3m(code: str, points: int = 60) -> Optional[Dict[str, Any]]:
    """
    3个月 日K：净值趋势 sparkline（基于 Data_netWorthTrend 日净值序列截断）。
    """
    now = time.time()
    cache_key = f"nav_d_3m:{code}:{points}"
    cached = SPARKLINE_CACHE.get(cache_key)
    if cached and (now - cached.get("ts", 0) < SPARKLINE_TTL_SECONDS):
        return cached.get("data")

    url = f"http://fund.eastmoney.com/pingzhongdata/{code}.js"
    try:
        text = _http_get_text(url, timeout_s=15)
        name, daily = _parse_pingzhongdata_networth_series(text)
        if not daily:
            return None
        cut = (datetime.now().date() - timedelta(days=92)).strftime("%Y-%m-%d")
        daily2 = [(ds, v) for ds, v in daily if ds >= cut]
        # 兜底：若近3个月数据不足（停牌/新基金/源缺失），回退用全量尾部 points 个点
        use = daily2 if len(daily2) >= 2 else daily
        ys = [v for _, v in (use[-points:] if len(use) > points else use)]
        if len(ys) < 2:
            return None
        window = "3M" if use is daily2 else "ALL(fallback)"
        data = {"code": code, "name": name, "points": ys, "freq": "D", "window": window}
        SPARKLINE_CACHE[cache_key] = {"ts": now, "data": data}
        return data
    except Exception:
        return None


def get_nav_sparkline_points_weekly_1y(code: str, points: int = 60) -> Optional[Dict[str, Any]]:
    """
    1年 周K：净值趋势 sparkline（日净值序列 -> 周聚合 -> 截断）。
    """
    now = time.time()
    cache_key = f"nav_w_1y:{code}:{points}"
    cached = SPARKLINE_CACHE.get(cache_key)
    if cached and (now - cached.get("ts", 0) < SPARKLINE_TTL_SECONDS):
        return cached.get("data")

    url = f"http://fund.eastmoney.com/pingzhongdata/{code}.js"
    try:
        text = _http_get_text(url, timeout_s=15)
        name, daily = _parse_pingzhongdata_networth_series(text)
        if not daily:
            return None
        cut = (datetime.now().date() - timedelta(days=370)).strftime("%Y-%m-%d")
        daily2 = [(ds, v) for ds, v in daily if ds >= cut]
        weekly = _group_weekly_last(daily2)
        # 兜底：若近1年周线不足（新基金/数据缺失），回退用全量日序列聚合的周线
        if len(weekly) < 2:
            weekly = _group_weekly_last(daily)
        ys = [v for _, v in (weekly[-points:] if len(weekly) > points else weekly)]
        if len(ys) < 2:
            return None
        window = "1Y" if (len(daily2) > 0 and len(_group_weekly_last(daily2)) >= 2) else "ALL(fallback)"
        data = {"code": code, "name": name, "points": ys, "freq": "W", "window": window}
        SPARKLINE_CACHE[cache_key] = {"ts": now, "data": data}
        return data
    except Exception:
        return None


def get_kdj_j_daily_weekly(code: str) -> Dict[str, Any]:
    """
    返回基金净值序列计算的 J 值：
    - 日K：近3个月（日序列）
    - 周K：近1年（周聚合）
    """
    now = time.time()
    cache_key = f"kdj_j:{code}"
    cached = SPARKLINE_CACHE.get(cache_key)
    if cached and (now - cached.get("ts", 0) < 60 * 10):
        return cached.get("data") or {}

    url = f"http://fund.eastmoney.com/pingzhongdata/{code}.js"
    payload: Dict[str, Any] = {}
    try:
        text = _http_get_text(url, timeout_s=15)
        name, daily = _parse_pingzhongdata_networth_series(text)
        payload["name"] = name
        if daily:
            cut_d = (datetime.now().date() - timedelta(days=92)).strftime("%Y-%m-%d")
            d3m = [v for ds, v in daily if ds >= cut_d]
            _, _, j_d, _ = compute_kdj_from_closes(d3m, n=9) if d3m else (None, None, None, None)
            payload["j_daily_3m"] = j_d

            # 周K：近1年用于计算J值
            cut_w = (datetime.now().date() - timedelta(days=370)).strftime("%Y-%m-%d")
            d1y = [(ds, v) for ds, v in daily if ds >= cut_w]
            w1y = _group_weekly_last(d1y)
            closes_w = [v for _, v in w1y]
            _, _, j_w, _ = compute_kdj_from_closes(closes_w, n=9) if closes_w else (None, None, None, None)
            payload["j_weekly_1y"] = j_w

            # 周MA30/MA60：需要更长时间的历史数据（至少2-3年，约104-156周）
            # 使用全部历史数据来计算，确保能计算出60周均线
            w_all = _group_weekly_last(daily)
            closes_w_all = [v for _, v in w_all]

            # 同时算一条"周MA30 + 周MA60 + 最近周收盘"供买入规则使用
            if closes_w_all:
                payload["weekly_close"] = closes_w_all[-1]
                payload["ma30_weekly"] = _moving_average(closes_w_all, 30)
                payload["ma60_weekly"] = _moving_average(closes_w_all, 60)
    except Exception:
        payload = {}

    SPARKLINE_CACHE[cache_key] = {"ts": now, "data": payload}
    return payload


def get_intraday_estimate_points_from_history(code: str, points: int = 80) -> Optional[Dict[str, Any]]:
    """
    估值分时：直接从 pingzhongdata 的 Data_fundValueTrend 拉取历史分时数据。
    注意：这是“历史分时/估值曲线”，不是本机采样。
    """
    now = time.time()
    cache_key = f"intraday_hist:{code}:{points}"
    cached = SPARKLINE_CACHE.get(cache_key)
    if cached and (now - cached.get("ts", 0) < INTRADAY_CACHE_TTL_SECONDS):
        return cached.get("data")

    url = f"http://fund.eastmoney.com/pingzhongdata/{code}.js"
    try:
        text = _http_get_text(url, timeout_s=15)
        name_match = re.search(r'var\s+fS_name\s*=\s*"([^"]+)"', text)
        name = name_match.group(1) if name_match else "--"
        m = re.search(r"var\s+Data_fundValueTrend\s*=\s*(\[[\s\S]*?\]);", text)
        if not m:
            return None
        data_list = json.loads(m.group(1))
        if not isinstance(data_list, list) or not data_list:
            return None

        # 以 5 分钟为一档做重采样（同一档取最后一个点）
        buckets: Dict[int, float] = {}
        for item in data_list:
            if not isinstance(item, dict):
                continue
            yv = _safe_float(item.get("y"))
            ts = item.get("x")
            if yv is None or ts is None:
                continue
            try:
                ts_int = int(ts)
            except Exception:
                continue
            bucket = ts_int // (5 * 60 * 1000)  # 5分钟一档
            buckets[bucket] = float(yv)  # 遍历顺序即时间顺序，后出现的会覆盖前面的

        if not buckets:
            return None

        # 按时间顺序取出每个 5 分钟档的值，再截取最近 points 个
        sorted_buckets = sorted(buckets.items(), key=lambda kv: kv[0])
        vals = [v for _, v in sorted_buckets]
        ys = vals[-points:] if len(vals) > points else vals

        if len(ys) < 2:
            return None
        data = {"code": code, "name": name, "points": ys}
        SPARKLINE_CACHE[cache_key] = {"ts": now, "data": data}
        return data
    except Exception:
        return None


def get_intraday_estimate_points(code: str, points: int = 80) -> Optional[Dict[str, Any]]:
    """
    对外的“估值分时”入口：
    - 优先：pingzhongdata 的 Data_fundValueTrend（历史分时）
    - 回退：本地 INTRADAY_STORE（仅在历史分时获取失败时兜底）
    """
    hist = get_intraday_estimate_points_from_history(code, points=points)
    if hist and hist.get("points"):
        return hist

    # fallback: 本地采样（避免网络被拦/字段缺失导致页面一直是 --），同样做 5 分钟重采样
    day = _today_str()
    with INTRADAY_LOCK:
        arr = (INTRADAY_STORE.get(day, {}).get(code) or [])
        buckets: Dict[int, float] = {}
        for it in arr:
            if not isinstance(it, dict):
                continue
            v = it.get("v")
            t = it.get("t")
            if not isinstance(v, (int, float)) or not isinstance(t, str):
                continue
            try:
                hh, mm = t.split(":")
                minutes = int(hh) * 60 + int(mm)
            except Exception:
                continue
            bucket = minutes // 5
            buckets[bucket] = float(v)
        if buckets:
            sorted_buckets = sorted(buckets.items(), key=lambda kv: kv[0])
            vals = [v for _, v in sorted_buckets]
            ys = vals[-points:] if len(vals) > points else vals
        else:
            ys = []
    if len(ys) >= 2:
        return {
            "code": code,
            "name": (hist or {}).get("name") or "--",
            "points": ys,
            "source": "local_sample_fallback_5min",
        }

        return None


# ========== KDJ ==========
def compute_kdj_from_closes(closes: List[float], n: int = 9):
    if not closes or len(closes) < n + 1:
        return None, None, None, None
    k = 50.0
    d = 50.0
    j_list: List[float] = []
    for i in range(n - 1, len(closes)):
        window = closes[i - n + 1 : i + 1]
        llv = min(window)
        hhv = max(window)
        c = closes[i]
        rsv = 50.0 if hhv == llv else (c - llv) / (hhv - llv) * 100.0
        k = (2.0 / 3.0) * k + (1.0 / 3.0) * rsv
        d = (2.0 / 3.0) * d + (1.0 / 3.0) * k
        j_list.append(3.0 * k - 2.0 * d)
    if not j_list:
        return None, None, None, None
    j = j_list[-1]
    prev_j = j_list[-2] if len(j_list) >= 2 else None
    return k, d, j, prev_j


def compute_kdj_from_ohlc(highs: List[float], lows: List[float], closes: List[float], n: int = 9):
    if not closes or len(closes) < n + 1:
        return None, None, None, None
    m = len(closes)
    if len(highs) != m or len(lows) != m:
        return None, None, None, None
    k = 50.0
    d = 50.0
    j_list: List[float] = []
    for i in range(n - 1, m):
        win_h = highs[i - n + 1 : i + 1]
        win_l = lows[i - n + 1 : i + 1]
        hhv = max(win_h)
        llv = min(win_l)
        c = closes[i]
        rsv = 50.0 if hhv == llv else (c - llv) / (hhv - llv) * 100.0
        k = (2.0 / 3.0) * k + (1.0 / 3.0) * rsv
        d = (2.0 / 3.0) * d + (1.0 / 3.0) * k
        j_list.append(3.0 * k - 2.0 * d)
    if not j_list:
        return None, None, None, None
    return k, d, j_list[-1], j_list[-2] if len(j_list) >= 2 else None


def get_etf_kdj_for_fund(fund_code: str, n: int = 9, limit: int = 120):
    etf_code = ETF_MAPPING.get(fund_code)
    if not etf_code:
        return None, None, None, None
    secid = f"1.{etf_code}" if etf_code.startswith(("5", "6")) else f"0.{etf_code}"
    url = (
        "https://push2his.eastmoney.com/api/qt/stock/kline/get"
        f"?secid={secid}&klt=101&fqt=1&lmt={limit}"
        "&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55,f56"
    )
    try:
        data = _http_get_json(url, timeout_s=10)
        kl = (data.get("data") or {}).get("klines") or []
        if len(kl) < n + 1:
            return None, None, None, None
        highs: List[float] = []
        lows: List[float] = []
        closes: List[float] = []
        for item in kl:
            parts = str(item).split(",")
            if len(parts) < 5:
                continue
            try:
                closes.append(float(parts[1]))
                highs.append(float(parts[3]))
                lows.append(float(parts[4]))
            except ValueError:
                continue
        return compute_kdj_from_ohlc(highs, lows, closes, n=n)
    except Exception:
        return None, None, None, None


def _check_dead_cross(ma30_list: List[float], ma60_list: List[float]) -> Optional[int]:
    """
    检查是否发生死叉（日k30线跌破日k60线）
    返回最近一次死叉的位置（索引），如果没有死叉返回None
    """
    if len(ma30_list) < 2 or len(ma60_list) < 2:
        return None
    # 从后往前查找死叉，跳过包含 None 的位置
    for i in range(len(ma30_list) - 1, 0, -1):
        a0 = ma30_list[i]
        b0 = ma60_list[i]
        a1 = ma30_list[i - 1]
        b1 = ma60_list[i - 1]
        if a0 is None or b0 is None or a1 is None or b1 is None:
            continue
        if a0 < b0 and a1 >= b1:
            return i
    return None


def _get_prev_high_before_dead_cross(closes: List[float], ma30_list: List[float], ma60_list: List[float]) -> Optional[float]:
    """
    获取最近一次死叉之前的净值最高点（前高）
    """
    if len(closes) < 2:
        return None
    dead_cross_idx = _check_dead_cross(ma30_list, ma60_list)
    if dead_cross_idx is None:
        # 如果没有死叉，返回整个序列的最高点
        return max(closes) if closes else None
    # 死叉之前的部分
    if dead_cross_idx > 0:
        prev_slice = closes[:dead_cross_idx]
        return max(prev_slice) if prev_slice else None
    return None


def _check_main_rise(prev_high: Optional[float], latest: float, breakout_prev_high: bool) -> bool:
    """
    判断是否进入主升浪：突破前高后，大涨4-6%
    """
    if prev_high is None or not breakout_prev_high:
        return False
    pct_rise = ((latest - prev_high) / prev_high) * 100.0
    return 4.0 <= pct_rise <= 6.0


def get_trade_advice_for_code(
    code: str, name_hint: str = "--", gszzl: Optional[float] = None, has_position: bool = True
) -> Dict[str, Any]:
    """
    基于净值趋势 + 当日估算涨幅的买卖建议。
    优先级：止损 > 止盈 > 买入 / 持有。
    """
    nav = get_nav_sparkline_points(code, points=120)
    if not nav or not nav.get("points"):
        return {"action": "观望", "reasons": ["无法获取近120天净值序列"], "metrics": {}}

    ys = nav["points"]
    last_nav = ys[-1] if ys else None
    ma30 = _moving_average(ys, 30)
    ma60 = _moving_average(ys, 60)

    # ETF KDJ 优先，若没有映射则退回基金净值序列
    k_val, d_val, j_val, j_prev = get_etf_kdj_for_fund(code, n=9, limit=120)
    if j_val is None:
        k_val, d_val, j_val, j_prev = compute_kdj_from_closes(ys, n=9)

    # 获取现价 (优先本地采样到的 gsz；否则用 NAV close)
    latest = None
    latest_src = "NAV"
    try:
        day = _today_str()
        with INTRADAY_LOCK:
            arr = (INTRADAY_STORE.get(day, {}).get(code) or [])
            if arr:
                latest = arr[-1].get("v")
                latest_src = "GSZ(sample)"
    except Exception:
        pass

    if latest is None:
        latest = last_nav

    reasons: List[str] = []
    metrics: Dict[str, Any] = {
        "ma30": ma30,
        "ma60": ma60,
        "latest": latest,
        "latest_src": latest_src,
        "gszzl": gszzl,
    }
    metrics.update({"kdj_k": k_val, "kdj_d": d_val, "kdj_j": j_val, "kdj_prev_j": j_prev})

    # 额外提供：基金净值序列计算的 日K/周K J 值（用于表格展示）
    try:
        j2 = get_kdj_j_daily_weekly(code)
        metrics.update(
            {
                "j_daily_3m": j2.get("j_daily_3m"),
                "j_weekly_1y": j2.get("j_weekly_1y"),
                "weekly_close": j2.get("weekly_close"),
                "ma30_weekly": j2.get("ma30_weekly"),
                "ma60_weekly": j2.get("ma60_weekly"),
            }
        )
    except Exception:
        metrics.update(
            {
                "j_daily_3m": None,
                "j_weekly_1y": None,
                "weekly_close": None,
                "ma30_weekly": None,
                "ma60_weekly": None,
            }
        )

    if latest is None or ma30 is None or ma60 is None:
        return {"action": "观望", "reasons": ["数据不足"], "metrics": metrics}

    above60 = latest >= ma60
    above30 = latest >= ma30
    dist60 = _pct(latest, ma60)

    # 计算日K的MA30和MA60序列（用于死叉判断）
    ma30_list = []
    ma60_list = []
    for i in range(len(ys)):
        if i >= 29:
            ma30_list.append(_moving_average(ys[: i + 1], 30))
        else:
            ma30_list.append(None)
        if i >= 59:
            ma60_list.append(_moving_average(ys[: i + 1], 60))
        else:
            ma60_list.append(None)

    # 新规则：前高 = 最近一次死叉之前的净值最高点
    prev_high = _get_prev_high_before_dead_cross(ys, ma30_list, ma60_list)
    breakout_prev_high = (latest > prev_high) if prev_high is not None else False
    metrics["prev_high_before_dead_cross"] = prev_high

    # 判断是否发生死叉
    dead_cross_idx = _check_dead_cross(ma30_list, ma60_list)
    has_dead_cross = dead_cross_idx is not None
    metrics["has_dead_cross"] = has_dead_cross
    metrics["dead_cross_idx"] = dead_cross_idx

    # 判断是否进入主升浪
    is_main_rise = _check_main_rise(prev_high, latest, breakout_prev_high)
    metrics["is_main_rise"] = is_main_rise

    # KDJ 过滤（用 J 从下向上穿越 20 作为"低位回升"）
    kdj_ok = (j_val is not None and j_val < 20 and (j_prev is None or j_prev >= 20))

    # ---- 优先级：清仓 > 止损 > 止盈 > 买入/持有 ----
    stop_reasons: List[str] = []
    tp_reasons: List[str] = []
    buy_reasons: List[str] = []
    clear_reasons: List[str] = []

    # 获取当日涨跌幅
    z = None
    if gszzl is not None:
        try:
            z = float(gszzl)
        except Exception:
            z = None

    # 获取周K数据
    w_close = metrics.get("weekly_close")
    ma30_w = metrics.get("ma30_weekly")
    ma60_w = metrics.get("ma60_weekly")

    # 0) 清仓：周k跌破60线，牛市结束，清仓
    if w_close is not None and ma60_w is not None and w_close < ma60_w:
        clear_reasons.append("周K跌破60日线：牛市结束，建议清仓")
        if has_position:
            metrics["phase"] = "熊市"
            return {
                "action": "清仓",
                "reasons": clear_reasons,
                "metrics": metrics,
                "name": nav.get("name") or name_hint,
            }
        # 无仓位 → 记录信号，继续判断买入

    # 1) 止损：跌破30日线，无条件减到半仓
    if not above30:
        metrics["hit_stop_loss"] = True
        stop_reasons.append("跌破30日均线：无条件减到半仓（止损/控风险）")
        if has_position:
            # 跌破30日线属于短期风险控制，不等同于“熊市结束”
            # 阶段标记为“半仓”，表示处于风控减仓状态
            metrics["phase"] = "半仓"
            return {
                "action": "减仓到半仓",
                "reasons": stop_reasons,
                "metrics": metrics,
                "name": nav.get("name") or name_hint,
            }
        # 无仓位 → 记录风控信号，继续判断买入

    # 2) 止盈：细分三种情况
    #    a) 仅站上日K60线（但未突破前高）
    #    b) 仅突破前高（但暂未明显站上60线）
    #    c) 同时站上60线并突破前高
    can_take_profit = above60 or breakout_prev_high
    cond_text = None
    if above60 and breakout_prev_high:
        cond_text = "站上60线并突破前高"
    elif above60:
        cond_text = "站上60线"
    elif breakout_prev_high:
        cond_text = "突破前高"

    if can_take_profit and z is not None and z > 0:
        if z >= 3.0:
            tp_reasons.append(f"{cond_text}且大涨{z:.1f}%：推荐卖出")
        elif z >= 1.0:
            tp_reasons.append(f"{cond_text}且涨幅{z:.1f}%：考虑卖出")

        # KDJ辅助判断：J从低位上升到80以上，进入超买区
        if j_val is not None and j_val > 80:
            tp_reasons.append("KDJ超买(J>80)")

    metrics["hit_take_profit"] = bool(tp_reasons)
    if tp_reasons and has_position:
        metrics["phase"] = "持有"
        return {
            "action": "考虑减仓",
            "reasons": tp_reasons,
            "metrics": metrics,
            "name": nav.get("name") or name_hint,
        }

    # 反弹减仓提醒：如果之前没有减仓清仓，反弹回到日k30线需要提醒适当减仓
    if has_position and above30 and z is not None and z > 0:
        # 如果之前跌破过30线（从下方反弹回来），提醒减仓
        # 这里简化处理：如果当前在30线上方且上涨，且之前有止损信号记录，则提醒
        if metrics.get("hit_stop_loss"):
            tp_reasons.append("反弹回到30日线上方：建议适当减仓")
            if tp_reasons:
                metrics["phase"] = "持有"
                return {
                    "action": "反弹减仓",
                    "reasons": tp_reasons,
                    "metrics": metrics,
                    "name": nav.get("name") or name_hint,
                }

    # 3) 买入逻辑（ETF指数基金新规则）
    # 买入前提条件：当日跌幅≥1% 且 站上周k60线上方
    can_buy = False
    if z is not None and z <= -1.0:  # 当日跌幅≥1%
        if w_close is not None and ma60_w is not None and w_close >= ma60_w:
            can_buy = True

    # 持有逻辑：日k在30线上方停止买入
    if above30 and not has_position:
        # 空仓视角：这里应该是“观望”，而不是“持有观望”
        buy_reasons.append("日K在30日线上方：观望，暂不买入")
        metrics["phase"] = "观望"
        return {
            "action": "观望",
            "reasons": buy_reasons,
            "metrics": metrics,
            "name": nav.get("name") or name_hint,
        }

    # 新规则买入逻辑
    if can_buy:
        # 波段心法1：牛市早期，短线，周k突破60线，日k跌破60线后买入
        # 判断：周k在60线上方，日k跌破60线
        if w_close is not None and ma60_w is not None and w_close >= ma60_w and not above60:
            buy_reasons.append("波段心法1：周K突破60线，日K跌破60线后买入（牛市早期短线）")
            metrics["phase"] = "波段心法1"
            return {
                "action": "波段买入1",
                "reasons": buy_reasons,
                "metrics": metrics,
                "name": nav.get("name") or name_hint,
            }

        # 波段心法2：牛市前期，长线，从日k60线上方到突破前高之前逢低买入
        # 判断：日k在60线上方，未突破前高，当日跌幅≥1%
        if above60 and not breakout_prev_high:
            buy_reasons.append("波段心法2：日K60线上方，突破前高之前逢低买入（牛市前期长线）")
            if kdj_ok:
                buy_reasons.append("KDJ辅助：J值从高位回落到20以下，进入超跌反弹区")
            metrics["phase"] = "波段心法2"
            return {
                "action": "波段买入2",
                "reasons": buy_reasons,
                "metrics": metrics,
                "name": nav.get("name") or name_hint,
            }

        # 波段心法3：牛回头，突破前高后，周k回踩30日线，日k运行在60日线下方，日k产生死叉后才买入
        # 判断：突破前高后，周k回踩30日线（接近1-2%），日k在60线下方，发生死叉
        if breakout_prev_high and not above60 and has_dead_cross:
            if w_close is not None and ma30_w is not None:
                dist_ma30_w = _pct(w_close, ma30_w)
                if dist_ma30_w is not None and -2.0 <= dist_ma30_w <= 1.0:
                    if dist_ma30_w < 0:
                        buy_reasons.append("波段心法3：突破前高后，周K回踩30日线，日K死叉后买入（牛回头）")
                        metrics["phase"] = "波段心法3"
                    else:
                        buy_reasons.append("波段心法3提示：接近周K30日线（1-2%），即将可以买入")
                    return {
                        "action": "波段买入3",
                        "reasons": buy_reasons,
                        "metrics": metrics,
                        "name": nav.get("name") or name_hint,
                    }

        # 反弹心法：主升后回调，J值小于20，没有跌破日K30线，小仓位买入
        # 判断：主升后，J<20，在30线上方
        if is_main_rise and above30 and j_val is not None and j_val < 20:
            buy_reasons.append("反弹心法：主升后回调，J<20，未跌破30线，小仓位买入（反弹概率高）")
            metrics["phase"] = "反弹心法"
            return {
                "action": "反弹买入",
                "reasons": buy_reasons,
                "metrics": metrics,
                "name": nav.get("name") or name_hint,
            }

    # 默认：趋势正常，持有/观望
    if has_position:
        buy_reasons.append("趋势正常，持有观望")
        metrics["phase"] = "持有"
        return {
            "action": "持有",
            "reasons": buy_reasons,
            "metrics": metrics,
            "name": nav.get("name") or name_hint,
        }
    else:
        buy_reasons.append("趋势正常，暂无明显买卖信号，继续观望")
        return {
            "action": "观望",
            "reasons": buy_reasons,
            "metrics": metrics,
            "name": nav.get("name") or name_hint,
        }


def _merge_hold_flat_advice(hold: Dict[str, Any], flat: Dict[str, Any]) -> Dict[str, Any]:
    """
    将“持仓视角”和“空仓视角”的两份建议合并成一份，便于前端在一行里展示。
    - action:  持仓:xxx / 空仓:yyy
    - reasons: ["持仓：...；...", "空仓：...；..."]
    - metrics: 在原 metrics 基础上补充 hold/flat 的动作与原因，方便调试查看。
    """
    if not flat:
        return hold
    act_hold = (hold.get("action") or "观望").strip()
    act_flat = (flat.get("action") or "观望").strip()
    if act_hold == act_flat:
        action = f"持仓/空仓:{act_hold}"
    else:
        action = f"持仓:{act_hold} / 空仓:{act_flat}"

    reasons_hold = hold.get("reasons") or []
    reasons_flat = flat.get("reasons") or []
    merged_reasons: List[str] = []
    if reasons_hold:
        merged_reasons.append("持仓：" + "；".join(str(r) for r in reasons_hold))
    if reasons_flat:
        merged_reasons.append("空仓：" + "；".join(str(r) for r in reasons_flat))

    metrics = dict(hold.get("metrics") or {})
    # 阶段：优先使用持仓视角的 phase，其次空仓视角
    phase_hold = (hold.get("metrics") or {}).get("phase")
    phase_flat = (flat.get("metrics") or {}).get("phase")
    if phase_hold or phase_flat:
        metrics["phase"] = phase_hold or phase_flat
    metrics.update(
        {
            "hold_action": act_hold,
            "flat_action": act_flat,
            "hold_reasons": reasons_hold,
            "flat_reasons": reasons_flat,
        }
    )
    name = hold.get("name") or flat.get("name") or "--"
    return {"action": action, "reasons": merged_reasons, "metrics": metrics, "name": name}


def _get_advice_with_cache(code: str, rt_row: Dict[str, Any]) -> Dict[str, Any]:
    """
    基于实时估值行 rt_row（含 GSZ/GZTIME/PDATE/DWJZ 等）计算合并后的建议，带简单缓存：
    - 版本键：PDATE + DWJZ + GZTIME + GSZ
    - 版本未变时直接复用 ADVICE_CACHE[code]
    """
    try:
        # 版本键：PDATE + DWJZ + round(GSZZL, 1)
        # 含义：同一天 & 同一净值，只有当估算涨跌幅变化超过 0.1% 时才触发重算建议。
        raw_gszzl = rt_row.get("GSZZL")
        g_ver = ""
        try:
            g_val = float(raw_gszzl)
            g_ver = f"{g_val:.1f}"
        except Exception:
            g_ver = ""
        ver = f"{rt_row.get('PDATE') or ''}_{rt_row.get('DWJZ') or ''}_{g_ver}"
        with ADVICE_LOCK:
            if ADVICE_VER.get(code) == ver and code in ADVICE_CACHE:
                return ADVICE_CACHE[code]
        g = _safe_float(raw_gszzl)
        adv_hold = get_trade_advice_for_code(code, gszzl=g, has_position=True)
        adv_flat = get_trade_advice_for_code(code, gszzl=g, has_position=False)
        merged = _merge_hold_flat_advice(adv_hold, adv_flat)
        with ADVICE_LOCK:
            ADVICE_VER[code] = ver
            ADVICE_CACHE[code] = merged
        return merged
    except Exception as e:
        # 避免单只基金的建议计算异常导致整个 /api/advice 失败
        print(f"计算基金 {code} 建议时出错: {e}")
        return {
            "action": "观望",
            "reasons": ["内部错误，暂不给出建议"],
            "metrics": {},
            "name": code,
        }


# ========== 存储 ==========
def load_intraday_store() -> None:
    global INTRADAY_STORE
    try:
        if os.path.exists(INTRADAY_STORE_FILE):
            with open(INTRADAY_STORE_FILE, "r", encoding="utf-8") as f:
                INTRADAY_STORE = json.load(f) or {}
    except Exception:
        INTRADAY_STORE = {}


def cleanup_intraday_store_for_today() -> None:
    """
    每天只保留当日的分时估值数据：
    - 避免第二天仍带着上一交易日的本地采样
    - 文件不会无限增长
    """
    today = _today_str()
    with INTRADAY_LOCK:
        changed = False
        keys = list(INTRADAY_STORE.keys())
        for k in keys:
            if k != today:
                del INTRADAY_STORE[k]
                changed = True
        if changed:
            try:
                with open(INTRADAY_STORE_FILE, "w", encoding="utf-8") as f:
                    json.dump(INTRADAY_STORE, f, ensure_ascii=False)
            except Exception:
                pass


def load_fund_codes_from_file() -> None:
    """
    从本地 JSON 文件加载基金代码列表；
    若文件不存在，则用默认 FUND_CODES 写入一份，便于后续编辑。
    """
    global FUND_CODES
    try:
        if os.path.exists(FUND_CODES_FILE):
            with open(FUND_CODES_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                codes: List[str] = []
                for c in data:
                    s = str(c).strip()
                    if s and s.isdigit() and len(s) == 6:
                        codes.append(s)
                if codes:
                    FUND_CODES = codes
                    return
    except Exception:
        pass
    # 文件不存在或无效：写入当前内置 FUND_CODES 作为初始值
    try:
        with open(FUND_CODES_FILE, "w", encoding="utf-8") as f:
            json.dump(FUND_CODES, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def save_fund_codes_to_file() -> None:
    try:
        with open(FUND_CODES_FILE, "w", encoding="utf-8") as f:
            json.dump(FUND_CODES, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def load_fund_groups_from_file() -> None:
    """从本地 JSON 文件加载密钥分组配置"""
    global FUND_GROUPS_BY_KEY
    try:
        if os.path.exists(FUND_GROUPS_FILE):
            with open(FUND_GROUPS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                FUND_GROUPS_BY_KEY = {}
                for key, codes in data.items():
                    if isinstance(codes, list):
                        valid_codes = []
                        for c in codes:
                            s = str(c).strip()
                            if s and s.isdigit() and len(s) == 6:
                                valid_codes.append(s)
                        if valid_codes:
                            FUND_GROUPS_BY_KEY[str(key)] = valid_codes
                return
    except Exception:
        pass
    # 文件不存在或无效：初始化为空字典
    FUND_GROUPS_BY_KEY = {}


def save_fund_groups_to_file() -> None:
    """保存密钥分组配置到本地 JSON 文件"""
    try:
        with open(FUND_GROUPS_FILE, "w", encoding="utf-8") as f:
            json.dump(FUND_GROUPS_BY_KEY, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def save_intraday_store() -> None:
    try:
        with open(INTRADAY_STORE_FILE, "w", encoding="utf-8") as f:
            json.dump(INTRADAY_STORE, f, ensure_ascii=False)
    except Exception:
        pass


def record_intraday_point(code: str, gsz: Any, gztime: Any) -> None:
    hhmm = _hhmm_from_gztime(gztime)
    if not hhmm:
        return
    v = _safe_float(gsz)
    if v is None:
        return
    day = _today_str()
    with INTRADAY_LOCK:
        day_map = INTRADAY_STORE.setdefault(day, {})
        arr = day_map.setdefault(code, [])
        if arr and arr[-1].get("t") == hhmm:
            arr[-1]["v"] = v
        else:
            arr.append({"t": hhmm, "v": v})
        if len(arr) > 500:
            del arr[: len(arr) - 500]


# ========== Web 服务 ==========
class FundRequestHandler(BaseHTTPRequestHandler):
    def end_headers(self) -> None:  # noqa: N802
        """重写 end_headers 以捕获 BrokenPipeError"""
        try:
            super().end_headers()
        except (BrokenPipeError, ConnectionResetError, OSError):
            # 客户端断开连接，静默处理
            pass

    def _set_json_headers(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def _set_html_headers(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler API)
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            qs = parse_qs(parsed.query or "")

            # 数据接口
            if path == "/api/funds":
                mode = (qs.get("mode") or ["auto"])[0]
                key = (qs.get("key") or [""])[0].strip()
                # 根据密钥过滤基金代码列表
                if key and key in FUND_GROUPS_BY_KEY:
                    codes = FUND_GROUPS_BY_KEY[key]
                else:
                    codes = FUND_CODES
                data = get_fund_data(codes, mode=mode)
                with INTRADAY_LOCK:
                    save_intraday_store()
                self._set_json_headers()
                self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))
                return

            if path == "/api/index":
                payload = get_index_snapshot()
                self._set_json_headers()
                self.wfile.write(json.dumps(payload or [], ensure_ascii=False).encode("utf-8"))
                return

            if path == "/api/fund_codes":
                # GET: 返回当前基金代码列表
                self._set_json_headers()
                self.wfile.write(json.dumps(FUND_CODES, ensure_ascii=False).encode("utf-8"))
                return

            if path == "/api/fund_groups":
                key = (qs.get("key") or [""])[0].strip()
                if key:
                    # GET: 根据密钥返回对应的基金代码列表
                    if key in FUND_GROUPS_BY_KEY:
                        codes = FUND_GROUPS_BY_KEY[key]
                    else:
                        codes = []
                else:
                    # GET: 返回所有密钥分组（用于检查基金是否在其他分组中）
                    self._set_json_headers()
                    self.wfile.write(json.dumps(FUND_GROUPS_BY_KEY, ensure_ascii=False).encode("utf-8"))
                    return
                self._set_json_headers()
                self.wfile.write(json.dumps(codes, ensure_ascii=False).encode("utf-8"))
                return

            if path == "/api/advice":
                code = (qs.get("code") or [""])[0].strip()
                codes_param = (qs.get("codes") or [""])[0].strip()
                if code:
                    # 单只基金：实时拉一次估值，走带缓存的建议计算逻辑
                    try:
                        rt_map = fetch_realtime_auto([code])
                        row = rt_map.get(code) or {}
                        payload = _get_advice_with_cache(code, row)
                    except Exception:
                        payload = _get_advice_with_cache(code, {})
                elif codes_param:
                    # 批量：仅对指定 codes 计算建议（用于密钥过滤后的子集）
                    codes = [c.strip() for c in codes_param.split(",") if c.strip()]
                    try:
                        rt_map = fetch_realtime_auto(codes)
                    except Exception:
                        rt_map = {}
                    payload = {
                        c: _get_advice_with_cache(
                            c,
                            (rt_map.get(c) or {}),
                        )
                        for c in codes
                    }
                else:
                    # 全量：先批量获取实时估值，再按 code 生成“持仓/空仓合并”的建议（带缓存）
                    try:
                        rt_map = fetch_realtime_auto(FUND_CODES)
                    except Exception:
                        rt_map = {}
                    payload = {
                        c: _get_advice_with_cache(
                            c,
                            (rt_map.get(c) or {}),
                        )
                        for c in FUND_CODES
                    }
                self._set_json_headers()
                self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
                return

            if path == "/api/sparkline/nav":
                code = (qs.get("code") or [""])[0].strip()
                points = int((qs.get("points") or ["60"])[0])
                # 兼容旧接口：默认仍返回“日序列尾部 points 个点”
                payload = get_nav_sparkline_points(code, points=points)
                self._set_json_headers()
                self.wfile.write(json.dumps(payload or {}, ensure_ascii=False).encode("utf-8"))
                return

            if path == "/api/sparkline/nav/daily":
                code = (qs.get("code") or [""])[0].strip()
                points = int((qs.get("points") or ["60"])[0])
                payload = get_nav_sparkline_points_daily_3m(code, points=points)
                self._set_json_headers()
                self.wfile.write(json.dumps(payload or {}, ensure_ascii=False).encode("utf-8"))
                return

            if path == "/api/sparkline/nav/weekly":
                code = (qs.get("code") or [""])[0].strip()
                points = int((qs.get("points") or ["60"])[0])
                payload = get_nav_sparkline_points_weekly_1y(code, points=points)
                self._set_json_headers()
                self.wfile.write(json.dumps(payload or {}, ensure_ascii=False).encode("utf-8"))
                return

            if path == "/api/kdj":
                code = (qs.get("code") or [""])[0].strip()
                payload = get_kdj_j_daily_weekly(code) if code else {}
                self._set_json_headers()
                self.wfile.write(json.dumps(payload or {}, ensure_ascii=False).encode("utf-8"))
                return

            if path == "/api/log":
                # 前端错误/调试信息上报接口，仅用于在终端打印 JS 报错信息
                msg = (qs.get("msg") or [""])[0]
                src = (qs.get("src") or [""])[0]
                line = (qs.get("line") or [""])[0]
                col = (qs.get("col") or [""])[0]
                detail = (qs.get("detail") or [""])[0]
                try:
                    print(f"[FE_LOG] msg={msg!r}, src={src!r}, line={line}, col={col}, detail={detail!r}")
                except Exception:
                    pass
                self._set_json_headers()
                self.wfile.write(b"{}")
                return

            if path == "/api/sparkline/intraday":
                code = (qs.get("code") or [""])[0].strip()
                points = int((qs.get("points") or ["80"])[0])
                payload = get_intraday_estimate_points(code, points=points)
                self._set_json_headers()
                self.wfile.write(json.dumps(payload or {}, ensure_ascii=False).encode("utf-8"))
                return

            # 默认 HTML
            self._set_html_headers()
            html = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>基金监控</title>
<style>
body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif; margin: 0; padding: 0; background: #f8fafc; }
header { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color: #fff; padding: 18px 28px; display:flex; justify-content:space-between; align-items:center; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
header h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
.container { padding: 20px 28px; max-width: 100%; }
.toolbar { display:flex; gap:10px; margin-bottom:16px; flex-wrap:wrap; align-items:center; padding: 12px 16px; background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
input[type="text"] { padding:8px 12px; border-radius:6px; border:1px solid #e2e8f0; min-width:100px; font-size:13px; transition: border-color 0.2s; }
input[type="text"]:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
button { padding:8px 16px; border-radius:6px; border:none; background:#3b82f6; color:#fff; cursor:pointer; font-size:13px; font-weight:500; transition: all 0.2s; }
button:hover { background:#2563eb; transform: translateY(-1px); box-shadow: 0 2px 4px rgba(59,130,246,0.3); }
button:disabled { background:#94a3b8; cursor:not-allowed; transform: none; }
select {
    padding:8px 32px 8px 12px;
    border-radius:6px;
    border:1px solid #e2e8f0;
    font-size:13px;
    background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23475569' d='M6 9L1 4h10z'/%3E%3C/svg%3E") no-repeat right 10px center;
    cursor:pointer;
    transition: all 0.2s;
    min-width:120px;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    color: #1e293b;
    font-weight: 500;
}
select:hover {
    border-color: #cbd5e1;
    background-color: #f8fafc;
}
select:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
    background-color: #fff;
}
select option {
    padding: 10px 12px;
    background: #fff;
    color: #1e293b;
    font-size: 13px;
    line-height: 1.5;
}
select option:hover {
    background: #f1f5f9;
}
select option:checked,
select option:focus {
    background: #3b82f6;
    color: #fff;
    font-weight: 500;
}
.toolbar label {
    display:flex;
    align-items:center;
    gap:10px;
    font-size:13px;
    color:#64748b;
    font-weight:500;
    white-space: nowrap;
}
table { width:100%; border-collapse:collapse; background:#fff; box-shadow:0 2px 4px rgba(0,0,0,0.06); border-radius:8px; overflow:hidden; }
th, td { padding:10px 12px; border-bottom:1px solid #f1f5f9; text-align:left; font-size:13px; }
th { background:#f8fafc; cursor:pointer; user-select:none; white-space:nowrap; font-weight:600; color:#475569; }
tr:hover { background:#f8fafc; }
tr:last-child td { border-bottom: none; }
.negative { color:#10b981; }
.positive { color:#ef4444; }
.chg { font-weight:600; }
.advice-buy { color:#dc2626; font-weight:600; }
.sub-section-title { margin-top:20px; margin-bottom:10px; font-weight:600; font-size:15px; color:#1e293b; }
.muted { color:#64748b; font-size:12px; }
.index-strip { display:flex; gap:12px; padding:12px 28px; background:linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color:#e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.index-card { min-width:120px; padding:10px 14px; border-radius:8px; background:rgba(255,255,255,0.08); backdrop-filter: blur(10px); font-size:12px; transition: transform 0.2s; }
.index-card:hover { transform: translateY(-2px); }
.index-card-title { font-size:11px; margin-bottom:6px; color:#94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
.index-card-main { font-size:18px; font-weight:600; }
.index-card-sub { font-size:11px; margin-top:4px; opacity: 0.8; }
.modal-backdrop { position:fixed; inset:0; background:rgba(15,23,42,.6); backdrop-filter: blur(4px); display:none; align-items:center; justify-content:center; z-index:50; }
.modal-panel { background:#ffffff; border-radius:12px; padding:24px; min-width:480px; max-width:90vw; max-height:80vh; overflow:auto; box-shadow:0 20px 60px rgba(0,0,0,0.3); font-size:13px; }
.modal-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid #e2e8f0; }
.modal-title { font-weight:600; font-size:16px; color:#1e293b; }
.fund-list-table { width:100%; border-collapse:collapse; margin-top:12px; }
.fund-list-table th, .fund-list-table td { padding:10px 12px; border-bottom:1px solid #f1f5f9; text-align:left; }
.fund-list-table th { background:#f8fafc; font-weight:600; color:#475569; }
.fund-list-table tr:hover { background:#f8fafc; }
.tag-del { color:#ef4444; cursor:pointer; padding:4px 8px; border-radius:4px; transition: all 0.2s; display:inline-block; }
.tag-del:hover { background:#fee2e2; color:#dc2626; }
.key-only-btn { display:none; }
.key-only-btn.show { display:inline-block !important; }
.col-spark-intra,
.col-spark-nav-d,
.col-spark-nav-w,
td[data-spark-intraday],
td[data-spark-nav-d],
td[data-spark-nav-w] {
    display: none;
}
.custom-alert-backdrop { position:fixed; inset:0; background:rgba(15,23,42,.6); backdrop-filter: blur(4px); display:none; align-items:center; justify-content:center; z-index:1000; }
.custom-alert-backdrop.show { display:flex; }
.custom-alert-box { background:#fff; border-radius:12px; padding:24px; min-width:320px; max-width:480px; box-shadow:0 20px 60px rgba(0,0,0,0.3); animation: alertFadeIn 0.2s ease-out; }
@keyframes alertFadeIn {
    from { opacity:0; transform: scale(0.95) translateY(-10px); }
    to { opacity:1; transform: scale(1) translateY(0); }
}
.custom-alert-title { font-size:16px; font-weight:600; color:#1e293b; margin-bottom:12px; }
.custom-alert-message { font-size:14px; color:#475569; line-height:1.6; margin-bottom:20px; }
.custom-alert-button { padding:8px 20px; border-radius:6px; border:none; background:#3b82f6; color:#fff; cursor:pointer; font-size:13px; font-weight:500; transition: all 0.2s; float:right; }
.custom-alert-button:hover { background:#2563eb; }
.key-input-wrapper { position:relative; display:inline-block; }
.key-delete-btn { position:absolute; right:4px; top:50%; transform:translateY(-50%); padding:4px 8px; border:none; background:transparent; color:#ef4444; cursor:pointer; font-size:12px; border-radius:4px; display:none; transition: background-color 0.2s; }
.key-delete-btn:hover { background:#fee2e2; transform:translateY(-50%); }
.key-delete-btn.show { display:block; }
.custom-select { position:relative; display:inline-block; width: auto; min-width:100px; }
.custom-select-btn {
    padding:8px 28px 8px 12px;
    border-radius:6px;
    border:1px solid #e2e8f0;
    font-size:13px;
    background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23475569' d='M6 9L1 4h10z'/%3E%3C/svg%3E") no-repeat right 10px center;
    cursor:pointer;
    transition: all 0.2s;
    color: #1e293b;
    font-weight: 500;
    user-select: none;
    display: inline-block;
    white-space: nowrap;
}
.custom-select-btn:hover {
    border-color: #cbd5e1;
    background-color: #f8fafc;
}
.custom-select-btn.active {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
}
.custom-select-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 6px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.08);
    z-index: 1000;
    display: none;
    overflow: hidden;
    max-height: 280px;
    overflow-y: auto;
    animation: dropdownFadeIn 0.15s ease-out;
}
@keyframes dropdownFadeIn {
    from {
        opacity: 0;
        transform: translateY(-4px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}
.custom-select-dropdown.show { display: block; }
.custom-select-option {
    padding: 11px 14px;
    cursor: pointer;
    font-size: 13px;
    color: #334155;
    transition: all 0.15s ease;
    border-bottom: 1px solid #f1f5f9;
    position: relative;
}
.custom-select-option:first-child {
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
}
.custom-select-option:last-child {
    border-bottom: none;
    border-bottom-left-radius: 8px;
    border-bottom-right-radius: 8px;
}
.custom-select-option:hover {
    background: #f8fafc;
    color: #1e40af;
    padding-left: 16px;
}
.custom-select-option.selected {
    background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
    color: #1e40af;
    font-weight: 600;
}
.custom-select-option.selected:hover {
    background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
}
</style>
</head>
<body>
<header>
<h1>基金监控（估值分时）</h1>
</header>
<div id="indexStrip" class="index-strip"></div>
<div class="container">
<div class="toolbar">
<input id="search" type="text" placeholder="按代码 / 名称搜索..." />
<div class="key-input-wrapper">
  <input id="keyInput" type="text" placeholder="输入密钥        " style="width:100px; padding-right:28px;" />
  <button id="keyDeleteBtn" class="key-delete-btn" title="删除密钥">×</button>
</div>
<label>
  接口:
  <div class="custom-select" id="sourceSelectWrapper">
    <div class="custom-select-btn" id="sourceSelectBtn">自动</div>
    <div class="custom-select-dropdown" id="sourceSelectDropdown">
      <div class="custom-select-option selected" data-value="auto">自动</div>
      <div class="custom-select-option" data-value="fundgz">fundgz</div>
      <div class="custom-select-option" data-value="akshare">AKShare</div>
      <div class="custom-select-option" data-value="em">东财</div>
      <div class="custom-select-option" data-value="sina_fund">新浪基金</div>
      <div class="custom-select-option" data-value="sina_stock">新浪股票</div>
    </div>
    <select id="sourceSelect" style="display:none;">
      <option value="auto" selected>自动</option>
      <option value="fundgz">fundgz</option>
      <option value="akshare">AKShare</option>
      <option value="em">东财</option>
      <option value="sina_fund">新浪基金</option>
      <option value="sina_stock">新浪股票</option>
    </select>
  </div>
</label>
<button id="refreshBtn" style="margin-left:8px;">刷新数据</button>
<span id="updateTime" class="muted"></span>
<button id="manageFundsBtn" class="key-only-btn" style="margin-left:8px; display:none;">管理基金</button>
<button id="viewToggleBtn" class="key-only-btn" style="margin-left:8px; display:none;">看全部</button>
</div>
<div>
<div class="sub-section-title">实时估值基金</div>
<table id="fundTable">
<thead><tr>
<th data-key="FCODE">代码</th>
<th data-key="SHORTNAME">名称</th>
<th class="col-spark-intra">估值分时</th>
<th class="col-spark-nav-d">净值趋势(日K/3M)</th>
<th class="col-spark-nav-w">净值趋势(周K/1Y)</th>
<th data-key="GSZ">估算净值</th>
<th data-key="GSZZL">估算涨跌</th>
<th data-key="KDJJ_D">J(日)</th>
<th>阶段</th>
<th>建议</th>
<th>原因</th>
<th data-key="GZTIME">更新时间</th>
</tr></thead>
<tbody></tbody>
</table>
</div>
<div style="margin-top:16px;">
<div class="sub-section-title">上一交易日涨跌</div>
<table id="specialTable">
<thead><tr>
<th data-key="FCODE">代码</th>
<th data-key="SHORTNAME">名称</th>
<th data-key="LAST_CHG">涨跌幅</th>
<th data-key="KDJJ_D">J(日)</th>
<th>阶段</th>
<th>建议</th>
<th>原因</th>
<th data-key="GZTIME">日期</th>
</tr></thead>
<tbody></tbody>
</table>
</div>
</div>
<div id="fundManageModal" class="modal-backdrop">
  <div class="modal-panel">
    <div class="modal-header">
      <div class="modal-title">管理基金列表</div>
      <button id="closeFundManageBtn">关闭</button>
    </div>
    <div>
      <div style="margin-bottom:6px;">
        <input id="newFundInput" type="text" placeholder="新增基金代码(6位)" style="width:120px; margin-right:4px;" />
        <button id="addFundBtn">添加</button>
      </div>
      <table class="fund-list-table">
        <thead><tr><th style="width:80px;">代码</th><th>名称</th><th style="width:60px;">操作</th></tr></thead>
        <tbody id="fundManageList"></tbody>
      </table>
    </div>
    <div style="margin-top:10px; text-align:right;">
      <button id="saveFundListBtn" style="margin-right:6px;">保存</button>
      <button id="cancelFundListBtn">取消</button>
    </div>
</div>
</div>
<script>
// 自定义alert函数，替换原生alert
function customAlert(message, title = '提示') {
    return new Promise((resolve) => {
        const backdrop = document.getElementById('customAlertBackdrop');
        const titleEl = document.getElementById('customAlertTitle');
        const messageEl = document.getElementById('customAlertMessage');
        const button = document.getElementById('customAlertButton');

        if (!backdrop || !titleEl || !messageEl || !button) {
            // 如果元素不存在，使用原生alert
            alert(message);
            resolve();
            return;
        }

        titleEl.textContent = title;
        messageEl.textContent = message;
        button.textContent = '确定';
        // 隐藏取消按钮（如果存在）
        const cancelBtn = backdrop.querySelector('.custom-alert-cancel');
        if (cancelBtn) cancelBtn.style.display = 'none';
        backdrop.classList.add('show');

        const closeAlert = () => {
            backdrop.classList.remove('show');
            resolve(true);
        };

        button.onclick = closeAlert;
        backdrop.onclick = (e) => {
            if (e.target === backdrop) {
                closeAlert();
            }
        };
    });
}

// 自定义confirm函数
function customConfirm(message, title = '确认') {
    return new Promise((resolve) => {
        const backdrop = document.getElementById('customAlertBackdrop');
        const titleEl = document.getElementById('customAlertTitle');
        const messageEl = document.getElementById('customAlertMessage');
        const button = document.getElementById('customAlertButton');

        if (!backdrop || !titleEl || !messageEl || !button) {
            // 如果元素不存在，使用原生confirm
            resolve(confirm(message));
            return;
        }

        titleEl.textContent = title;
        messageEl.textContent = message;
        button.textContent = '确定';
        backdrop.classList.add('show');

        const handleConfirm = () => {
            backdrop.classList.remove('show');
            resolve(true);
        };

        const handleCancel = () => {
            backdrop.classList.remove('show');
            resolve(false);
        };

        button.onclick = handleConfirm;
        button.textContent = '确定';

        // 添加或显示取消按钮
        let cancelBtn = backdrop.querySelector('.custom-alert-cancel');
        if (!cancelBtn) {
            cancelBtn = document.createElement('button');
            cancelBtn.className = 'custom-alert-cancel';
            cancelBtn.textContent = '取消';
            cancelBtn.style.cssText = 'padding:8px 20px; border-radius:6px; border:1px solid #e2e8f0; background:#fff; color:#475569; cursor:pointer; font-size:13px; font-weight:500; transition: all 0.2s; float:right; margin-right:10px;';
            cancelBtn.onmouseenter = () => { cancelBtn.style.background = '#f1f5f9'; };
            cancelBtn.onmouseleave = () => { cancelBtn.style.background = '#fff'; };
            button.parentElement.insertBefore(cancelBtn, button);
        }
        cancelBtn.style.display = 'block';
        cancelBtn.onclick = handleCancel;

        backdrop.onclick = (e) => {
            if (e.target === backdrop) {
                handleCancel();
            }
        };
    });
}

let rawData = [];
let lastKey = ''; // 记录上一次的密钥，用于检测密钥变化
let sortState = { key: null, asc: true };
let sparkVersion = {}; // code -> 版本标记（基于时间+净值），用于避免重复重画分时/净值趋势图
let isLoading = false; // 避免重复触发刷新请求
let pendingReload = false; // 切换接口时，若正在加载，则在本轮完成后再自动刷新一次
let fundCodes = []; // 当前基金代码列表（从后端加载）
let dataSourceMode = 'auto'; // 当前选中的数据接口模式：auto / em / fundgz / sina_fund / sina_stock / akshare
let viewMode = 'self'; // 查看模式：'self' 看自己 / 'all' 看全部
let currentValidKey = ''; // 当前验证成功的密钥

// 验证密钥并更新UI
async function validateKey(key) {
    if (!key || key.trim() === '') {
        currentValidKey = '';
        viewMode = 'self';
        // 隐藏管理基金和切换按钮
        const manageBtn = document.getElementById('manageFundsBtn');
        const toggleBtn = document.getElementById('viewToggleBtn');
        const deleteBtn = document.getElementById('keyDeleteBtn');
        if (manageBtn) manageBtn.classList.remove('show');
        if (toggleBtn) toggleBtn.classList.remove('show');
        if (deleteBtn) deleteBtn.classList.remove('show');
        // 清除localStorage
        localStorage.removeItem('fundMonitorValidKey');
        return false;
    }

    try {
        // 验证密钥是否存在：传入key参数，如果返回数组说明密钥存在
        const res = await fetch('/api/fund_groups?key=' + encodeURIComponent(key));
        const result = await res.json();
        // 如果返回的是数组，说明密钥存在
        const keyExists = Array.isArray(result);

        if (keyExists) {
            currentValidKey = key;
            viewMode = 'self';
            // 保存到localStorage
            localStorage.setItem('fundMonitorValidKey', key);
            // 显示管理基金和切换按钮
            const manageBtn = document.getElementById('manageFundsBtn');
            const toggleBtn = document.getElementById('viewToggleBtn');
            const deleteBtn = document.getElementById('keyDeleteBtn');
            if (manageBtn) manageBtn.classList.add('show');
            if (toggleBtn) {
                toggleBtn.classList.add('show');
                toggleBtn.textContent = '看全部';
            }
            if (deleteBtn) deleteBtn.classList.add('show');
            return true;
        } else {
            currentValidKey = '';
            // 隐藏按钮
            const manageBtn = document.getElementById('manageFundsBtn');
            const toggleBtn = document.getElementById('viewToggleBtn');
            const deleteBtn = document.getElementById('keyDeleteBtn');
            if (manageBtn) manageBtn.classList.remove('show');
            if (toggleBtn) toggleBtn.classList.remove('show');
            if (deleteBtn) deleteBtn.classList.remove('show');
            localStorage.removeItem('fundMonitorValidKey');
            customAlert('密钥验证失败，该密钥不存在');
            return false;
        }
    } catch (e) {
        console.error('验证密钥失败:', e);
        return false;
    }
}

// 检查是否是休市日（周末或节假日）
function isMarketClosed() {
    const now = new Date();
    const day = now.getDay();
    // 周六(6)或周日(0)是休市日
    if (day === 0 || day === 6) {
        return true;
    }
    // TODO: 可以添加节假日判断
    return false;
}

async function loadIndexStrip() {
    try {
        const res = await fetch('/api/index');
        const items = await res.json();
        const bar = document.getElementById('indexStrip');
        if (!bar) return;
        bar.innerHTML = '';
        if (!Array.isArray(items) || items.length === 0) {
            bar.innerHTML = '<span class="muted">指数数据加载中...</span>';
            return;
        }
        for (const it of items) {
            const last = (it.last != null && !isNaN(parseFloat(it.last))) ? parseFloat(it.last).toFixed(2) : '--';
            const chg = (it.chg != null && !isNaN(parseFloat(it.chg))) ? parseFloat(it.chg).toFixed(2) : '--';
            const pct = (it.pct != null && !isNaN(parseFloat(it.pct))) ? (parseFloat(it.pct).toFixed(2) + '%') : '--';
            const up = it.pct != null && !isNaN(parseFloat(it.pct)) ? parseFloat(it.pct) >= 0 : null;
            const cls = up == null ? '' : (up ? 'positive' : 'negative');
            const signChg = chg === '--' ? '--' : (up ? '+' + chg : chg);
            const signPct = pct === '--' ? '--' : (up ? '+' + pct : pct);
            const card = document.createElement('div');
            card.className = 'index-card';
            card.innerHTML = `<div class="index-card-title">${it.name || it.code || '--'}</div>
<div class="index-card-main ${cls}">${last}</div>
<div class="index-card-sub ${cls}">${signChg}  ${signPct}</div>`;
            bar.appendChild(card);
        }
    } catch (e) {
        const bar = document.getElementById('indexStrip');
        if (bar) bar.innerHTML = '<span class="muted">指数数据加载失败</span>';
    }
}
async function loadFundCodes() {
    try {
        const res = await fetch('/api/fund_codes');
        const data = await res.json();
        if (Array.isArray(data)) {
            fundCodes = data;
        }
    } catch (e) {
        // 忽略基金代码加载错误，保持默认列表
    }
}
async function openFundManageModal() {
    const modal = document.getElementById('fundManageModal');
    const listBody = document.getElementById('fundManageList');
    if (!modal || !listBody) return;
    // 验证密钥（从localStorage或输入框获取）
    const storedKey = localStorage.getItem('fundMonitorValidKey');
    const keyInput = document.getElementById('keyInput');
    const inputKey = keyInput ? keyInput.value.trim() : '';
    const key = storedKey || inputKey;
    if (!key || key !== currentValidKey) {
        customAlert('请先输入并验证密钥');
        return;
    }
    listBody.innerHTML = '';
    // 获取当前密钥分组的基金列表
    try {
        const res = await fetch('/api/fund_groups?key=' + encodeURIComponent(key));
        const codes = await res.json();
        if (!Array.isArray(codes)) {
            customAlert('获取基金列表失败');
            return;
        }
        const byCode = {};
        if (Array.isArray(rawData)) {
            for (const f of rawData) {
                if (f && f.FCODE) byCode[f.FCODE] = f;
            }
        }
        codes.forEach(code => {
            const tr = document.createElement('tr');
            const f = byCode[code] || {};
            tr.innerHTML = `<td>${code}</td><td>${(f.SHORTNAME || '--').slice ? (f.SHORTNAME || '--').slice(0, 16) : '--'}</td><td><span class="tag-del" data-code="${code}">删除</span></td>`;
            listBody.appendChild(tr);
        });
        modal.style.display = 'flex';
    } catch (e) {
        customAlert('获取基金列表失败：' + e);
    }
}
function closeFundManageModal() {
    const modal = document.getElementById('fundManageModal');
    if (modal) modal.style.display = 'none';
}
function renderSparklineSvg(points, width=90, height=26, stroke='#16a34a') {
    if (!points || points.length < 2) return '';
    const min = Math.min(...points); const max = Math.max(...points);
    const span = (max - min) || 1; const pad = 2;
    const w = width - pad * 2; const h = height - pad * 2;
    const step = w / (points.length - 1);
    let d = '';
    for (let i = 0; i < points.length; i++) {
        const x = pad + step * i;
        const y = pad + (1 - (points[i] - min) / span) * h;
        d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2) + ' ';
    }
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="${d.trim()}" fill="none" stroke="${stroke}" stroke-width="1.6"></path></svg>`;
}
async function fillSparklines(tableSelector) {
    const rows = document.querySelectorAll(tableSelector + ' tbody tr[data-code]');
    for (const tr of rows) {
        const code = tr.getAttribute('data-code');
        const ver = tr.getAttribute('data-ver') || '';
        const cellIntra = tr.querySelector('td[data-spark-intraday]');
        const cellNavD = tr.querySelector('td[data-spark-nav-d]');
        const cellNavW = tr.querySelector('td[data-spark-nav-w]');
        if (!code) continue;
        // 若版本号未变化且已有svg，不必重复请求/重画，提高刷新速度
        const lastVer = sparkVersion[code];
        const hasDrawn =
            (cellIntra && cellIntra.querySelector('svg')) ||
            (cellNavD && cellNavD.querySelector('svg')) ||
            (cellNavW && cellNavW.querySelector('svg'));
        if (ver && lastVer === ver && hasDrawn) {
            continue;
        }
        if (cellIntra) {
            cellIntra.innerHTML = '<span class="muted">...</span>';
            try {
                const res = await fetch('/api/sparkline/intraday?code=' + encodeURIComponent(code));
                const payload = await res.json();
                const pts = payload.points;
                if (!pts || pts.length < 2) { cellIntra.innerHTML = '<span class="muted">--</span>'; }
                else {
                    const up = pts[pts.length - 1] >= pts[0];
                    cellIntra.innerHTML = renderSparklineSvg(pts, 90, 26, up ? '#dc2626' : '#16a34a');
                }
            } catch (e) { cellIntra.innerHTML = '<span class="muted">--</span>'; }
        }
        if (cellNavD) {
            cellNavD.innerHTML = '<span class="muted">...</span>';
            try {
                const res = await fetch('/api/sparkline/nav/daily?code=' + encodeURIComponent(code));
                const payload = await res.json();
                const pts = payload.points;
                if (!pts || pts.length < 2) { cellNavD.innerHTML = '<span class="muted">--</span>'; }
                else {
                    const up = pts[pts.length - 1] >= pts[0];
                    cellNavD.innerHTML = renderSparklineSvg(pts, 90, 26, up ? '#dc2626' : '#16a34a');
                }
            } catch (e) { cellNavD.innerHTML = '<span class="muted">--</span>'; }
        }
        if (cellNavW) {
            cellNavW.innerHTML = '<span class="muted">...</span>';
            try {
                const res = await fetch('/api/sparkline/nav/weekly?code=' + encodeURIComponent(code));
                const payload = await res.json();
                const pts = payload.points;
                if (!pts || pts.length < 2) { cellNavW.innerHTML = '<span class="muted">--</span>'; }
                else {
                    const up = pts[pts.length - 1] >= pts[0];
                    cellNavW.innerHTML = renderSparklineSvg(pts, 90, 26, up ? '#dc2626' : '#16a34a');
                }
            } catch (e) { cellNavW.innerHTML = '<span class="muted">--</span>'; }
        }
        sparkVersion[code] = ver;
    }
}
// */

// 全局错误上报：把前端 JS 错误发到 /api/log，让 Python 终端可以看到
window.addEventListener('error', function (e) {
    try {
        const msg = encodeURIComponent(String(e.message || ''));
        const src = encodeURIComponent(String(e.filename || ''));
        const line = encodeURIComponent(String(e.lineno || ''));
        const col = encodeURIComponent(String(e.colno || ''));
        const detail = encodeURIComponent(String((e.error && e.error.stack) || ''));
        fetch('/api/log?msg=' + msg + '&src=' + src + '&line=' + line + '&col=' + col + '&detail=' + detail);
    } catch (_) {}
});
function splitFunds(data) {
    const normal = []; const special = [];
    for (const f of data) {
        // 有估值(GSZ 不为 null)的放在“实时估值基金”，否则放在“上一交易日涨跌”
        if (f && f.GSZ != null) normal.push(f);
        else special.push(f);
    }
    return { normal, special };
}
function renderTables() {
    const keyword = document.getElementById('search').value.trim().toLowerCase();
    const keyInput = document.getElementById('keyInput');
    const currentKey = keyInput ? keyInput.value.trim() : '';
    const hasKey = currentKey.length > 0;
    // 如果有密钥，显示"管理基金"按钮
    const manageBtn = document.getElementById('manageFundsBtn');
    if (manageBtn) {
        if (hasKey) {
            manageBtn.classList.add('show');
        } else {
            manageBtn.classList.remove('show');
        }
    }
    const { normal, special } = splitFunds(rawData);
    const filterFn = f => !keyword || (f.FCODE && f.FCODE.toLowerCase().includes(keyword)) || (f.SHORTNAME && f.SHORTNAME.toLowerCase().includes(keyword));
    let normalData = normal.filter(filterFn); let specialData = special.filter(filterFn);
    // 默认排序：
    // - 实时估值基金：按估算涨跌(GSZZL)从高到低
    // - 上一交易日涨跌：按上一日涨跌(LAST_CHG)从高到低
    if (!sortState.key) {
        const asc = false;
        const cmpBy = key => (a, b) => {
            const va = a[key]; const vb = b[key];
            if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
            const na = parseFloat(va); const nb = parseFloat(vb);
            if (!isNaN(na) && !isNaN(nb)) { return asc ? na - nb : nb - na; }
            return asc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
        };
        normalData.sort(cmpBy('GSZZL'));
        specialData.sort(cmpBy('LAST_CHG'));
    } else {
        const { key, asc } = sortState;
        const cmp = (a, b) => {
            const va = a[key]; const vb = b[key];
            if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
            const na = parseFloat(va); const nb = parseFloat(vb);
            if (!isNaN(na) && !isNaN(nb)) { return asc ? na - nb : nb - na; }
            return asc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
        };
        normalData.sort(cmp); specialData.sort(cmp);
    }
    const fundBody = document.querySelector('#fundTable tbody');
    // 缓存旧行，避免每次重建导致分时/净值趋势图和建议/原因都被清空
    const oldFundRows = {};
    for (const tr of fundBody.querySelectorAll('tr[data-code]')) {
        const c = tr.getAttribute('data-code');
        if (c) oldFundRows[c] = tr;
    }
    fundBody.innerHTML = '';
    for (const f of normalData) {
        const tr = document.createElement('tr');
        const chg = f.GSZZL != null ? parseFloat(f.GSZZL) : null;
        const cls = chg == null ? '' : (chg > 0 ? 'chg positive' : (chg < 0 ? 'chg negative' : 'chg'));
        const ver = `${f.GZTIME || ''}_${f.GSZ != null ? f.GSZ : ''}`;
        const code = f.FCODE || '';
        let trExisting = oldFundRows[code];
        if (trExisting) {
            // 复用旧行：只更新基础文本/类名，不动分时/净值趋势 svg
            trExisting.setAttribute('data-code', code);
            const oldVer = trExisting.getAttribute('data-ver') || '';
            trExisting.setAttribute('data-ver', ver);
            const tds = trExisting.children;
            if (tds.length >= 12) {
                tds[0].textContent = code || '--';
                tds[1].textContent = (f.SHORTNAME || '--').slice(0, 12);
                tds[5].textContent = f.GSZ != null ? f.GSZ : '--';
                tds[6].className = cls;
                tds[6].textContent = chg != null ? chg.toFixed(2) + '%' : '--';
                // 只有在"数据版本变化"时才清空 KDJ / 建议 / 原因；
                // 否则保留原有计算结果，避免刷新时闪一下。
                if (oldVer !== ver) {
                    tds[7].innerHTML = '<span class="muted">--</span>';  // J(日)
                    tds[8].innerHTML = '<span class="muted">--</span>';  // 阶段
                    tds[9].innerHTML = '<span class="muted">...</span>'; // 建议
                    tds[10].innerHTML = '<span class="muted">--</span>'; // 原因
                }
                tds[11].textContent = f.GZTIME || '--';
            }
            fundBody.appendChild(trExisting);
        } else {
            tr.setAttribute('data-code', code);
            tr.setAttribute('data-ver', ver);
            tr.innerHTML = `<td>${code || '--'}</td><td>${(f.SHORTNAME || '--').slice(0, 12)}</td><td data-spark-intraday></td><td data-spark-nav-d></td><td data-spark-nav-w></td><td>${f.GSZ != null ? f.GSZ : '--'}</td><td class="${cls}">${chg != null ? chg.toFixed(2) + '%' : '--'}</td><td data-kdjj-d><span class="muted">--</span></td><td data-phase><span class="muted">--</span></td><td data-advice><span class="muted">...</span></td><td data-reason><span class="muted">--</span></td><td>${f.GZTIME || '--'}</td>`;
        fundBody.appendChild(tr);
        }
    }
    const specialBody = document.querySelector('#specialTable tbody');
    const oldSpecialRows = {};
    for (const tr of specialBody.querySelectorAll('tr[data-code]')) {
        const c = tr.getAttribute('data-code');
        if (c) oldSpecialRows[c] = tr;
    }
    specialBody.innerHTML = '';
    for (const f of specialData) {
        const chg = f.LAST_CHG != null ? parseFloat(f.LAST_CHG) : null;
        const cls = chg == null ? '' : (chg > 0 ? 'positive' : (chg < 0 ? 'negative' : ''));
        const date = f.GZTIME || '--';
        const ver = `${date}_${chg != null ? chg : ''}`;
        const code = f.FCODE || '';
        let trExisting = oldSpecialRows[code];
        if (trExisting) {
            const oldVer = trExisting.getAttribute('data-ver') || '';
            trExisting.setAttribute('data-code', code);
            trExisting.setAttribute('data-ver', ver);
            const tds = trExisting.children;
            if (tds.length >= 8) {
                tds[0].textContent = code || '--';
                tds[1].textContent = (f.SHORTNAME || '--').slice(0, 12);
                tds[2].className = `chg ${cls}`;
                tds[2].textContent = chg != null ? chg.toFixed(2) + '%' : '--';
                if (oldVer !== ver) {
                    tds[3].innerHTML = '<span class="muted">--</span>';  // J(日)
                    tds[4].innerHTML = '<span class="muted">--</span>';  // 阶段
                    tds[5].innerHTML = '<span class="muted">...</span>'; // 建议
                    tds[6].innerHTML = '<span class="muted">--</span>';  // 原因
                }
                tds[7].textContent = date;
            }
            specialBody.appendChild(trExisting);
        } else {
            specialBody.innerHTML += `<tr data-code="${code}" data-ver="${ver}"><td>${code || '--'}</td><td>${(f.SHORTNAME || '--').slice(0, 12)}</td><td class="chg ${cls}">${chg != null ? chg.toFixed(2) + '%' : '--'}</td><td data-kdjj-d><span class="muted">--</span></td><td data-phase><span class="muted">--</span></td><td data-advice><span class="muted">...</span></td><td data-reason><span class="muted">--</span></td><td>${date}</td></tr>`;
        }
    }
}
async function loadData() {
    if (isLoading) return; // 上一次刷新尚未完成，忽略本次点击
    isLoading = true;
    const btn = document.getElementById('refreshBtn');
    const oldLabel = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = '刷新中...';
    }
    try {
        const keyInput = document.getElementById('keyInput');
        const key = keyInput ? keyInput.value.trim() : '';
        // 如果viewMode是'all'，即使有密钥也不过滤
        const useKey = (key && viewMode === 'self' && currentValidKey === key) ? key : '';
        const url = '/api/funds?mode=' + encodeURIComponent(dataSourceMode || 'auto') + (useKey ? '&key=' + encodeURIComponent(useKey) : '');
        const res = await fetch(url);
        const fresh = await res.json();
        // 如果密钥改变了，完全替换 rawData（因为密钥分组可能不同）
        const keyChanged = key !== lastKey;
        if (keyChanged) {
            lastKey = key;
            rawData = Array.isArray(fresh) ? fresh : [];
        } else {
            // 若已有数据，则"增量更新"：新数据按代码覆盖旧数据；
            // 若基金列表发生变化（有新增/删除），则直接用 fresh 覆盖。
            if (Array.isArray(rawData) && rawData.length > 0 && Array.isArray(fresh) && fresh.length > 0) {
            const freshCodes = new Set(fresh.map(f => f && f.FCODE).filter(Boolean));
            let needReplace = false;
            if (rawData.length !== fresh.length) {
                needReplace = true;
            } else {
                for (const f of rawData) {
                    const c = f && f.FCODE;
                    if (c && !freshCodes.has(c)) {
                        needReplace = true;
                        break;
                    }
                }
            }
            if (needReplace) {
                rawData = fresh;
            } else {
                const mergedMap = {};
                for (const f of rawData) {
                    if (f && f.FCODE) mergedMap[f.FCODE] = f;
                }
                for (const f of fresh) {
                    if (f && f.FCODE) mergedMap[f.FCODE] = f;
                }
                rawData = Object.values(mergedMap);
            }
            } else if (Array.isArray(fresh)) {
                // 首次加载或之前没有数据，直接用新数据
                rawData = fresh;
            } else {
                // 异常情况下保持旧数据不变
            }
        }
        renderTables();
        document.getElementById('updateTime').textContent = '最后刷新：' + new Date().toLocaleString();
        fillSparklines('#fundTable');
        fillSparklines('#specialTable');
        window.__ADVICE__ = {};
        try {
            // 只对当前 rawData 中涉及的基金计算建议（支持密钥过滤后的子集）
            const codes = Array.isArray(rawData)
                ? rawData.map(f => f && f.FCODE).filter(Boolean)
                : [];
            const advUrl = codes.length
                ? '/api/advice?codes=' + encodeURIComponent(codes.join(','))
                : '/api/advice';
            const advRes = await fetch(advUrl);
            window.__ADVICE__ = await advRes.json();
        } catch (e) {}
        renderAdviceCells('#fundTable');
        renderAdviceCells('#specialTable');
        // 刷新指数栏
        loadIndexStrip();
    } catch (e) {
        // 网络异常时给出提示，但不让多次快速点击堆积请求
        alert('加载数据失败：' + e);
    } finally {
        isLoading = false;
        if (btn) {
            btn.disabled = false;
            btn.textContent = oldLabel || '刷新数据';
        }
        // 若加载过程中用户切换了接口，则在本轮完成后再自动刷新一次，确保使用最新接口的数据
        if (pendingReload) {
            pendingReload = false;
            loadData();
        }
    }
}
function renderAdviceCells(tableSelector) {
    const rows = document.querySelectorAll(tableSelector + ' tbody tr[data-code]');
    for (const tr of rows) {
        const code = tr.getAttribute('data-code');
        const cell = tr.querySelector('td[data-advice]');
        const cellJd = tr.querySelector('td[data-kdjj-d]');
        const cellPhase = tr.querySelector('td[data-phase]');
        const cellReason = tr.querySelector('td[data-reason]');
        if (!cell) continue;
        const adv = (window.__ADVICE__ || {})[code];
        if (!adv || !adv.action) {
            if(cell) cell.innerHTML = '<span class="muted">--</span>';
            if(cellJd) cellJd.innerHTML = '<span class="muted">--</span>';
            if(cellPhase) cellPhase.innerHTML = '<span class="muted">--</span>';
            if(cellReason) cellReason.innerHTML = '<span class="muted">--</span>';
            continue;
        }
        if (cellJd) {
            const j = adv.metrics && adv.metrics.j_daily_3m;
            cellJd.innerHTML = (j == null || isNaN(parseFloat(j))) ? '<span class="muted">--</span>' : (parseFloat(j).toFixed(2));
        }
        if (cellPhase) {
            const phase = adv.metrics && adv.metrics.phase;
            cellPhase.innerHTML = phase ? `<span>${phase}</span>` : '<span class="muted">--</span>';
        }
        const reasonsArr = adv.reasons || [];
        const reasons = reasonsArr.join('；');
        // 建议：多空分行显示，并用分隔符区分
        const holdAct = adv.metrics && adv.metrics.hold_action;
        const flatAct = adv.metrics && adv.metrics.flat_action;
        let advHtml = '';
        if (holdAct) advHtml += `<div>持仓：${holdAct}</div>`;
        if (holdAct && flatAct) advHtml += `<div class="muted">————</div>`;
        if (flatAct) advHtml += `<div>空仓：${flatAct}</div>`;
        if (!advHtml) advHtml = `<span>${adv.action}</span>`;
        // 认为包含以下关键词的动作为“买入/加仓类”：买入 / 低吸 / 加仓 / 建仓 / 布局
        const buyKeywords = ['买入', '低吸', '加仓', '建仓', '布局'];
        const actStr = [holdAct || '', flatAct || ''].join(' ');
        const isBuy = buyKeywords.some(k => actStr.indexOf(k) !== -1);
        const clsAdvice = isBuy ? 'advice-buy' : '';
        cell.innerHTML = `<div class="${clsAdvice}" title="${reasons.replace(/"/g,'&quot;')}">${advHtml}</div>`;
        if (cellReason) {
            const holdReasons = (adv.metrics && adv.metrics.hold_reasons) || [];
            const flatReasons = (adv.metrics && adv.metrics.flat_reasons) || [];
            const holdLine = holdReasons.length ? '持仓：' + holdReasons.join('；') : '';
            const flatLine = flatReasons.length ? '空仓：' + flatReasons.join('；') : '';
            let reasonHtml = '';
            if (holdLine) reasonHtml += `<div>${holdLine}</div>`;
            if (holdLine && flatLine) reasonHtml += `<div class="muted">————</div>`;
            if (flatLine) reasonHtml += `<div>${flatLine}</div>`;
            const title = [holdLine, flatLine].filter(Boolean).join(' / ') || reasons;
            cellReason.innerHTML = reasonHtml
                ? `<div title="${title.replace(/"/g,'&quot;')}">${reasonHtml}</div>`
                : '<span class="muted">--</span>';
        }
    }
}
document.getElementById('refreshBtn').addEventListener('click', () => { loadData(); });
// 自定义下拉组件
(function() {
    const wrapper = document.getElementById('sourceSelectWrapper');
    const btn = document.getElementById('sourceSelectBtn');
    const dropdown = document.getElementById('sourceSelectDropdown');
    const select = document.getElementById('sourceSelect');
    const options = dropdown.querySelectorAll('.custom-select-option');

    if (!wrapper || !btn || !dropdown || !select) return;

    // 点击按钮切换下拉菜单
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('show');
        if (isOpen) {
            dropdown.classList.remove('show');
            btn.classList.remove('active');
        } else {
            dropdown.classList.add('show');
            btn.classList.add('active');
        }
    });

    // 点击选项
    options.forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            const value = option.getAttribute('data-value');
            const text = option.textContent;

            // 更新选中状态
            options.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');

            // 更新按钮文本
            btn.textContent = text;

            // 更新隐藏的 select 元素
            select.value = value;

            // 触发 change 事件
            select.dispatchEvent(new Event('change'));

            // 关闭下拉菜单
            dropdown.classList.remove('show');
            btn.classList.remove('active');
        });
    });

    // 点击外部关闭下拉菜单
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            dropdown.classList.remove('show');
            btn.classList.remove('active');
        }
    });

    // 键盘导航
    btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            btn.click();
        }
    });

    dropdown.addEventListener('keydown', (e) => {
        const currentIndex = Array.from(options).findIndex(opt => opt.classList.contains('selected'));
        let newIndex = currentIndex;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            newIndex = (currentIndex + 1) % options.length;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            newIndex = (currentIndex - 1 + options.length) % options.length;
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (currentIndex >= 0) {
                options[currentIndex].click();
            }
            return;
        } else if (e.key === 'Escape') {
            e.preventDefault();
            dropdown.classList.remove('show');
            btn.classList.remove('active');
            return;
        }

        if (newIndex !== currentIndex) {
            options.forEach(opt => opt.classList.remove('selected'));
            options[newIndex].classList.add('selected');
            options[newIndex].scrollIntoView({ block: 'nearest' });
        }
    });

    // 初始化：从隐藏的 select 获取当前值
    const currentValue = select.value || 'auto';
    const currentOption = dropdown.querySelector(`[data-value="${currentValue}"]`);
    if (currentOption) {
        options.forEach(opt => opt.classList.remove('selected'));
        currentOption.classList.add('selected');
        btn.textContent = currentOption.textContent;
    }
})();
const sourceSelect = document.getElementById('sourceSelect');
if (sourceSelect) {
    sourceSelect.addEventListener('change', () => {
        const val = sourceSelect.value || 'auto';
        dataSourceMode = val;
        // 切换接口后重置排序状态，恢复为默认"按涨跌从高到低"
        sortState.key = null;
        sortState.asc = true;
        if (isLoading) {
            // 当前正在加载：标记为 pending，等本轮结束后自动再刷新一次
            pendingReload = true;
        } else {
            loadData();
        }
    });
}
document.getElementById('search').addEventListener('input', renderTables);
const keyInput = document.getElementById('keyInput');
if (keyInput) {
    keyInput.addEventListener('change', async () => {
        const key = keyInput.value.trim();
        // 验证密钥
        const isValid = await validateKey(key);
        if (isValid || key === '') {
            // 密钥验证成功或清空，重置排序并刷新数据
            sortState.key = null;
            sortState.asc = true;
            if (isLoading) {
                pendingReload = true;
            } else {
                loadData();
            }
        } else {
            // 验证失败，清空输入
            keyInput.value = '';
        }
    });
    // 支持回车键触发
    keyInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            const key = keyInput.value.trim();
            // 验证密钥
            const isValid = await validateKey(key);
            if (isValid || key === '') {
                sortState.key = null;
                sortState.asc = true;
                if (isLoading) {
                    pendingReload = true;
                } else {
                    loadData();
                }
            } else {
                keyInput.value = '';
            }
        }
    });
}
// 删除密钥按钮
document.getElementById('keyDeleteBtn').addEventListener('click', async () => {
    if (!currentValidKey) return;
    const confirmed = await customConfirm('确定要删除当前密钥吗？这将从系统中永久删除该密钥及其所有基金代码。', '确认删除密钥');
    if (confirmed) {
        try {
            // 从后端删除密钥分组（传入空列表会删除该密钥）
            const res = await fetch('/api/fund_groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: currentValidKey, codes: [] }),
            });
            const data = await res.json();

            // 清空密钥输入框
            const keyInput = document.getElementById('keyInput');
            if (keyInput) keyInput.value = '';
            // 清除验证状态
            const keyToDelete = currentValidKey;
            currentValidKey = '';
            localStorage.removeItem('fundMonitorValidKey');
            // 隐藏相关按钮
            const manageBtn = document.getElementById('manageFundsBtn');
            const toggleBtn = document.getElementById('viewToggleBtn');
            const deleteBtn = document.getElementById('keyDeleteBtn');
            if (manageBtn) manageBtn.classList.remove('show');
            if (toggleBtn) toggleBtn.classList.remove('show');
            if (deleteBtn) deleteBtn.classList.remove('show');
            // 重新加载数据（显示全部）
            sortState.key = null;
            sortState.asc = true;
            if (isLoading) {
                pendingReload = true;
            } else {
                loadData();
            }
            customAlert('密钥"' + keyToDelete + '"已成功删除');
        } catch (e) {
            customAlert('删除密钥失败：' + e);
        }
    }
});
document.getElementById('manageFundsBtn').addEventListener('click', () => { openFundManageModal(); });
// 切换看自己/看全部按钮
document.getElementById('viewToggleBtn').addEventListener('click', () => {
    if (viewMode === 'self') {
        viewMode = 'all';
        document.getElementById('viewToggleBtn').textContent = '看自己';
    } else {
        viewMode = 'self';
        document.getElementById('viewToggleBtn').textContent = '看全部';
    }
    // 重新加载数据
    sortState.key = null;
    sortState.asc = true;
    if (isLoading) {
        pendingReload = true;
    } else {
        loadData();
    }
});
document.getElementById('closeFundManageBtn').addEventListener('click', () => { closeFundManageModal(); });
document.getElementById('cancelFundListBtn').addEventListener('click', () => { closeFundManageModal(); });
let isAddingFund = false; // 防止重复点击添加按钮
document.getElementById('addFundBtn').addEventListener('click', async () => {
    // 防止重复点击
    if (isAddingFund) return;

    const input = document.getElementById('newFundInput');
    const addBtn = document.getElementById('addFundBtn');
    if (!input || !addBtn) return;

    const code = input.value.trim();
    if (!/^\d{6}$/.test(code)) {
        customAlert('请输入6位基金代码');
        return;
    }

    // 验证密钥（从localStorage或输入框获取）
    const storedKey = localStorage.getItem('fundMonitorValidKey');
    const keyInput = document.getElementById('keyInput');
    const inputKey = keyInput ? keyInput.value.trim() : '';
    const key = storedKey || inputKey;
    if (!key || key !== currentValidKey) {
        customAlert('请先输入并验证密钥');
        return;
    }

    // 检查是否已经在当前密钥分组中
    const listBody = document.getElementById('fundManageList');
    let alreadyExists = false;
    if (listBody) {
        for (const tr of listBody.querySelectorAll('tr')) {
            const existingCode = tr.querySelector('td')?.textContent?.trim();
            if (existingCode === code) {
                alreadyExists = true;
                break;
            }
        }
    }
    if (alreadyExists) {
        customAlert('该基金已在列表中');
        input.value = '';
        return;
    }

    // 设置loading状态
    isAddingFund = true;
    const oldBtnText = addBtn.textContent;
    addBtn.disabled = true;
    addBtn.textContent = '添加中...';

    try {
        // 立即更新UI（乐观更新）
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${code}</td><td>--</td><td><span class="tag-del" data-code="${code}">删除</span></td>`;
        if (listBody) {
            listBody.appendChild(tr);
        }
        input.value = '';

        // 异步更新后端（不阻塞UI）
        // 检查全部基金列表中是否有该基金
        const allCodesRes = await fetch('/api/fund_codes');
        const allCodes = await allCodesRes.json();
        const needsAddToAll = !allCodes.includes(code);

        // 如果全部基金列表中没有，添加到全部基金列表
        if (needsAddToAll) {
            const newAllCodes = [...allCodes, code];
            await fetch('/api/fund_codes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codes: newAllCodes }),
            });
        }

        // 更新密钥分组（添加到当前密钥分组）
        const groupRes = await fetch('/api/fund_groups?key=' + encodeURIComponent(key));
        const currentCodes = await groupRes.json();
        if (Array.isArray(currentCodes) && !currentCodes.includes(code)) {
            const newCodes = [...currentCodes, code];
            await fetch('/api/fund_groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: key, codes: newCodes }),
            });
        }
    } catch (e) {
        // 如果失败，从列表中移除刚添加的行
        if (listBody) {
            const rows = listBody.querySelectorAll('tr');
            for (const row of rows) {
                const firstTd = row.querySelector('td:first-child');
                if (firstTd && firstTd.textContent.trim() === code) {
                    row.remove();
                    break;
                }
            }
        }
        customAlert('添加基金失败：' + e);
    } finally {
        // 恢复按钮状态
        isAddingFund = false;
        addBtn.disabled = false;
        addBtn.textContent = oldBtnText;
    }
});
document.getElementById('fundManageList').addEventListener('click', async (e) => {
    const target = e.target;
    if (target && target.classList && target.classList.contains('tag-del')) {
        const code = target.getAttribute('data-code');
        if (!code) return;
        // 验证密钥（从localStorage或输入框获取）
        const storedKey = localStorage.getItem('fundMonitorValidKey');
        const keyInput = document.getElementById('keyInput');
        const inputKey = keyInput ? keyInput.value.trim() : '';
        const key = storedKey || inputKey;
        if (!key || key !== currentValidKey) {
            customAlert('请先输入并验证密钥');
            return;
        }
        // 从当前密钥分组中删除
        const tr = target.closest('tr');
        if (tr) tr.remove();
    }
});
document.getElementById('saveFundListBtn').addEventListener('click', async () => {
    // 验证密钥（从localStorage或输入框获取）
    const storedKey = localStorage.getItem('fundMonitorValidKey');
    const keyInput = document.getElementById('keyInput');
    const inputKey = keyInput ? keyInput.value.trim() : '';
    const key = storedKey || inputKey;
    if (!key || key !== currentValidKey) {
        customAlert('请先输入并验证密钥');
        return;
    }
    // 获取当前显示的基金代码列表
    const codes = [];
    document.querySelectorAll('#fundManageList tr').forEach(tr => {
        const code = tr.querySelector('td')?.textContent?.trim();
        if (code && /^\d{6}$/.test(code)) {
            codes.push(code);
        }
    });
    if (!codes.length) {
        customAlert('基金列表不能为空');
        return;
    }
    try {
        // 更新密钥分组
        const groupRes = await fetch('/api/fund_groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key, codes: codes }),
        });
        const groupData = await groupRes.json();
        if (!groupData || !Array.isArray(groupData.codes)) {
            customAlert('更新密钥分组失败');
            return;
        }
        // 检查其他密钥分组，决定是否从全部基金列表中删除
        const allGroupsRes = await fetch('/api/fund_groups');
        const allGroups = await allGroupsRes.json();
        const allGroupCodes = new Set();
        for (const k in allGroups) {
            if (k !== key && Array.isArray(allGroups[k])) {
                allGroups[k].forEach(c => allGroupCodes.add(c));
            }
        }
        // 获取当前全部基金列表
        const allCodesRes = await fetch('/api/fund_codes');
        const allCodes = await allCodesRes.json();
        // 从全部基金列表中删除不在任何密钥分组中的基金
        const codesToKeep = new Set(codes);
        allGroupCodes.forEach(c => codesToKeep.add(c));
        const newAllCodes = allCodes.filter(c => codesToKeep.has(c));
        // 更新全部基金列表
        const allCodesUpdateRes = await fetch('/api/fund_codes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codes: newAllCodes }),
        });
        const allCodesUpdateData = await allCodesUpdateRes.json();
        if (allCodesUpdateData && Array.isArray(allCodesUpdateData.codes)) {
            closeFundManageModal();
            customAlert('基金列表已更新，共 ' + codes.length + ' 只。');
            loadData();
        } else {
            customAlert('更新全部基金列表失败');
        }
    } catch (e) {
        customAlert('基金列表更新失败：' + e);
    }
});
for (const th of document.querySelectorAll('th[data-key]')) {
    th.addEventListener('click', () => {
        const key = th.getAttribute('data-key');
        if (sortState.key === key) { sortState.asc = !sortState.asc; }
        else { sortState.key = key; sortState.asc = true; }
        renderTables();
    });
}
    // 页面加载时，从localStorage恢复密钥
    const storedKey = localStorage.getItem('fundMonitorValidKey');
    if (storedKey) {
        const keyInput = document.getElementById('keyInput');
        if (keyInput) {
            keyInput.value = storedKey;
            validateKey(storedKey).then(() => {
                loadFundCodes().then(() => {});
loadData();
                loadIndexStrip();
            });
        } else {
            loadFundCodes().then(() => {});
            loadData();
            loadIndexStrip();
        }
    } else {
        loadFundCodes().then(() => {});
        loadData();
        loadIndexStrip();
    }
    // 每5分钟自动刷新一次数据和指数（休市日不刷新）
    setInterval(() => {
        if (!isMarketClosed()) {
            loadData();
            loadIndexStrip();
        }
    }, 5 * 60 * 1000);
</script>
    <div id="customAlertBackdrop" class="custom-alert-backdrop">
        <div class="custom-alert-box">
            <div class="custom-alert-title" id="customAlertTitle">提示</div>
            <div class="custom-alert-message" id="customAlertMessage"></div>
            <button class="custom-alert-button" id="customAlertButton">确定</button>
            <div style="clear:both;"></div>
        </div>
    </div>
</body>
</html>"""
            self.wfile.write(html.encode("utf-8"))
        except (BrokenPipeError, ConnectionResetError, OSError) as e:
            # 客户端断开连接，忽略这些网络错误
            pass
        except Exception as e:
            # 其他错误记录但不中断服务
            print(f"处理请求时出错: {e}")
            traceback.print_exc()

    def do_POST(self) -> None:  # noqa: N802
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/fund_codes":
                length = int(self.headers.get("Content-Length") or "0")
                raw_body = self.rfile.read(length) if length > 0 else b""
                try:
                    body = json.loads(raw_body.decode("utf-8") or "{}")
                except Exception:
                    body = {}
                codes_in = body.get("codes") or []
                new_codes: List[str] = []
                for c in codes_in:
                    s = str(c).strip()
                    if s and s.isdigit() and len(s) == 6:
                        new_codes.append(s)
                if new_codes:
                    global FUND_CODES
                    FUND_CODES = new_codes
                    save_fund_codes_to_file()
                    # 重置建议缓存，避免旧基金残留
                    with ADVICE_LOCK:
                        ADVICE_CACHE.clear()
                        ADVICE_VER.clear()
                self._set_json_headers()
                self.wfile.write(json.dumps({"codes": FUND_CODES}, ensure_ascii=False).encode("utf-8"))
                return

            if parsed.path == "/api/fund_groups":
                # POST: 更新密钥对应的基金列表
                # body: {"key": "xxx", "codes": ["001549", "012922", ...]}
                length = int(self.headers.get("Content-Length") or "0")
                raw_body = self.rfile.read(length) if length > 0 else b""
                try:
                    body = json.loads(raw_body.decode("utf-8") or "{}")
                except Exception:
                    body = {}
                key = (body.get("key") or "").strip()
                codes_in = body.get("codes") or []
                if key:
                    new_codes: List[str] = []
                    for c in codes_in:
                        s = str(c).strip()
                        if s and s.isdigit() and len(s) == 6:
                            new_codes.append(s)
                    global FUND_GROUPS_BY_KEY
                    if new_codes:
                        FUND_GROUPS_BY_KEY[key] = new_codes
                    elif key in FUND_GROUPS_BY_KEY:
                        # 如果传入空列表，删除该密钥
                        del FUND_GROUPS_BY_KEY[key]
                    save_fund_groups_to_file()
                self._set_json_headers()
                self.wfile.write(json.dumps({"key": key, "codes": FUND_GROUPS_BY_KEY.get(key, [])}, ensure_ascii=False).encode("utf-8"))
                return

            # 其它POST暂不支持
            self.send_error(404, "Unsupported POST path")
        except (BrokenPipeError, ConnectionResetError, OSError) as e:
            # 客户端断开连接，忽略这些网络错误
            pass
        except Exception as e:
            # 其他错误记录但不中断服务
            print(f"处理POST请求时出错: {e}")


def run_server(host: str = "127.0.0.1", port: int = 8000) -> None:
    server_address = (host, port)
    httpd = HTTPServer(server_address, FundRequestHandler)
    print(f"本地服务已启动：http://{host}:{port}")
    print("按 Ctrl+C 停止服务。")
    httpd.serve_forever()


if __name__ == "__main__":
    load_intraday_store()
    load_fund_codes_from_file()
    load_fund_groups_from_file()
    run_server()
