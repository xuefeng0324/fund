#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_pages.py

把 fund_monitor.py 的页面“静态化”为 GitHub Pages 可用的 index.html：
- 在本地临时启动 fund_monitor.py HTTPServer
- 抓取关键接口 JSON（fund_codes / funds / index）
- 将原始 HTML 注入 window.fetch 拦截器：
  - 当页面请求 /api/* 时，直接返回抓取到的静态 JSON（以及 sparkline 的轻量占位数据）
  - 从而避免在 GitHub Pages 无法运行 Python 服务的情况下，页面无法加载的问题

输出：
- docs/index.html
"""

from __future__ import annotations

import json
import os
import random
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


def _find_free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return int(port)


def _http_get_text(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        return raw.decode("utf-8", errors="replace")


def _http_get_json(url: str, timeout: int = 60, retries: int = 2) -> Any:
    last_err: Exception | None = None
    for attempt in range(1 + retries):
        try:
            text = _http_get_text(url, timeout=timeout)
            return json.loads(text)
        except Exception as e:
            last_err = e
            print(f"[WARN] attempt {attempt+1} failed for {url}: {e}")
            if attempt < retries:
                time.sleep(3)
    raise last_err  # type: ignore[misc]


def _http_get_json_or_fallback(url: str, fallback: Any, timeout: int = 180) -> Any:
    """Try to fetch JSON; return fallback on any failure (timeout, network, etc.)."""
    try:
        return _http_get_json(url, timeout=timeout, retries=2)
    except Exception as e:
        print(f"[WARN] using fallback for {url}: {e}")
        return fallback


def _wait_until_ok(base_url: str, timeout_s: int = 20) -> None:
    start = time.time()
    last_err: str = ""
    while time.time() - start < timeout_s:
        try:
            _ = _http_get_text(base_url + "/", timeout=5)
            return
        except Exception as e:
            last_err = str(e)
            time.sleep(0.5)
    raise RuntimeError("Local server not ready: " + last_err)


def _start_fund_server(port: int) -> threading.Thread:
    # fund_monitor.py 用全局变量，尽量在导入后调用其加载函数
    import fund_monitor as fm  # local module import

    fm.load_intraday_store()
    fm.load_fund_codes_from_file()
    fm.load_fund_groups_from_file()

    t = threading.Thread(
        target=fm.run_server,
        kwargs={"host": "127.0.0.1", "port": int(port)},
        daemon=True,
    )
    t.start()
    return t


def _inject_fetch_mock(html: str, *, fund_codes: list[Any], funds: list[dict[str, Any]], index: list[dict[str, Any]]) -> str:
    # 注意：注入位置选择第一个 <script>，确保 window.fetch 在应用 JS 执行前就替换完成。
    # mock 逻辑：对 /api/* 的请求返回静态 JSON；sparkline 返回占位 points。
    marker = "__PXF_FETCH_MOCK__"

    fund_codes_json = json.dumps(fund_codes, ensure_ascii=False)
    funds_json = json.dumps(funds, ensure_ascii=False)
    index_json = json.dumps(index, ensure_ascii=False)

    mock_js = f"""
<script>
(function() {{
  window.{marker} = true;
  const API = {{
    "/api/fund_codes": {fund_codes_json},
    "/api/funds?mode=auto": {funds_json},
    "/api/index": {index_json}
  }};

  const ORIG_FETCH = window.fetch ? window.fetch.bind(window) : null;

  function normPathAndQuery(url) {{
    try {{
      // url 可能是相对路径 /api/xxx?...
      if (typeof url === "string" && url.startsWith("http")) {{
        const u = new URL(url);
        return u.pathname + (u.search || "");
      }}
      if (typeof url === "string") {{
        const q = url.indexOf("?");
        if (q >= 0) return url.slice(0, q) + url.slice(q); // keep ?...
        return url;
      }}
    }} catch (e) {{}}
    return String(url);
  }}

  window.fetch = async function(input, init) {{
    const url = (typeof input === "string") ? input : (input && input.url ? input.url : String(input));
    const full = normPathAndQuery(url);
    const pathOnly = (typeof url === "string") ? url.split("?")[0] : String(url);

    // 关键接口：用于首屏渲染
    if (pathOnly === "/api/fund_codes") {{
      return new Response(JSON.stringify(API["/api/fund_codes"]), {{ headers: {{"Content-Type":"application/json; charset=utf-8"}} }});
    }}
    if (full === "/api/funds?mode=auto" || full === "/api/funds") {{
      return new Response(JSON.stringify(API["/api/funds?mode=auto"]), {{ headers: {{"Content-Type":"application/json; charset=utf-8"}} }});
    }}
    if (pathOnly === "/api/index") {{
      return new Response(JSON.stringify(API["/api/index"]), {{ headers: {{"Content-Type":"application/json; charset=utf-8"}} }});
    }}

    // advice：MVP 先返回空对象，保证页面不崩溃
    if (pathOnly === "/api/advice" || pathOnly === "/api/advice/") {{
      return new Response(JSON.stringify({{}}), {{ headers: {{"Content-Type":"application/json; charset=utf-8"}} }});
    }}

    // 页面 sparkline：返回占位 points（>=2 即可绘制 svg）
    if (pathOnly === "/api/sparkline/intraday" ||
        pathOnly === "/api/sparkline/nav/daily" ||
        pathOnly === "/api/sparkline/nav/weekly") {{
      return new Response(JSON.stringify({{ points: [1, 2] }}), {{ headers: {{"Content-Type":"application/json; charset=utf-8"}} }});
    }}

    // 其他接口：尽量返回空结构
    if (pathOnly === "/api/fund_groups" || pathOnly === "/api/kdj") {{
      return new Response(JSON.stringify([]), {{ headers: {{"Content-Type":"application/json; charset=utf-8"}} }});
    }}
    if (pathOnly === "/api/log") {{
      return new Response(JSON.stringify({{}}), {{ headers: {{"Content-Type":"application/json; charset=utf-8"}} }});
    }}

    // 未命中：走原始 fetch（如果有）
    if (ORIG_FETCH) return ORIG_FETCH(input, init);
    throw new Error("PXF fetch mock: no handler for " + url);
  }};
}})();
</script>
""".strip()

    # 只替换第一个 <script>，避免把其他脚本打乱
    # fund_monitor.py 的 HTML 中应用 JS 是从第一个 <script> 开始。
    out, n = re.subn(r"<script>", mock_js + "<script>", html, count=1)
    if n != 1:
        raise RuntimeError("Failed to inject fetch mock: cannot find <script> tag")
    if marker not in out:
        raise RuntimeError("Fetch mock marker not found after injection")
    return out


def main() -> None:
    repo_root = os.path.dirname(os.path.abspath(__file__))
    docs_dir = os.path.join(repo_root, "docs")
    os.makedirs(docs_dir, exist_ok=True)

    port = _find_free_port()
    base_url = f"http://127.0.0.1:{port}"

    _start_fund_server(port)
    _wait_until_ok(base_url)

    # 抓取“首屏必需”的数据
    fund_codes = _http_get_json(base_url + "/api/fund_codes", timeout=30)
    funds = _http_get_json_or_fallback(base_url + "/api/funds?mode=auto", fallback=[])
    index = _http_get_json_or_fallback(base_url + "/api/index", fallback=[])

    # 获取原始 HTML
    html = _http_get_text(base_url + "/")

    # 注入 fetch mock
    html_out = _inject_fetch_mock(html, fund_codes=fund_codes, funds=funds, index=index)

    out_path = os.path.join(docs_dir, "index.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html_out)

    print("OK: generated", out_path, "size=", len(html_out))


if __name__ == "__main__":
    main()

