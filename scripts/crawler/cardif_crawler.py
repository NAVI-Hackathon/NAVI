"""
法國巴黎人壽官網爬蟲（life.cardif.com.tw）
用途：Cardif InsurHack 2-2 智慧知識與服務導覽助手的資料蒐集

安裝：
    pip install requests beautifulsoup4 markdownify

執行：
    python cardif_crawler.py                 # 爬網頁，PDF 只記錄連結
    python cardif_crawler.py --download-pdfs # 連 PDF 一起下載
    python cardif_crawler.py --max-pages 50  # 先小量測試

輸出（./data/crawl/，請在專案根目錄執行）：
    pages.jsonl     每頁一行：url、title、breadcrumb、content_md、links、pdfs
    documents.json  全站 PDF 文件清單（標題、網址、出現在哪些頁面）
    pdfs/           --download-pdfs 時的 PDF 檔

原則：
    - 只爬 life.cardif.com.tw 公開頁面，遵守 robots.txt
    - 不碰 my.cardif.com.tw（會員登入區）與 maac.io（robots 禁止）
    - 每次請求間隔 1.5 秒，避免對官網造成負擔
"""

import argparse
import hashlib
from datetime import datetime, timezone
import json
import re
import time
from collections import deque
from pathlib import Path
from urllib.parse import urljoin, urlparse, urldefrag, unquote
from urllib import robotparser

import requests
from bs4 import BeautifulSoup
from markdownify import markdownify as to_md

BASE = "https://life.cardif.com.tw"
START_URLS = [f"{BASE}/zh/", f"{BASE}/zh/a3", f"{BASE}/zh/a311",
              f"{BASE}/insurancedictionary", f"{BASE}/zh/app", f"{BASE}/zh/a325", f"{BASE}/zh/a319"]
ALLOWED_HOST = "life.cardif.com.tw"
UA = "NAVI-InsurHack/1.0 (public information review; low-frequency local crawler)"

# Liferay 每頁都會重複出現的導覽/頁尾 portlet，抽內文時排除
BOILERPLATE_TITLE = re.compile(
    r"^(default_wc_|a3_wc_|com_wc_|new-news-home|news-home|巢狀應用程式|embedded-portlet|"
    r"首頁活動輪播清單|消息輪播列表|p-i-index-webcontent)"
)
# Liferay 的動態資源網址（下載按鈕、portlet 參數），不當成頁面爬
SKIP_QUERY = re.compile(r"p_p_id=|p_p_lifecycle=|_t=\d")


def norm(url: str) -> str | None:
    url, _ = urldefrag(url)
    p = urlparse(url)
    if p.scheme not in ("http", "https") or p.netloc != ALLOWED_HOST:
        return None
    if SKIP_QUERY.search(p.query or ""):
        return None
    path = p.path.rstrip("/") or "/"
    # /a312 與 /zh/a312 是同一頁，統一成 /zh/ 版本（只處理 a312、f8、k2 這類頁面代碼；
    # /insurancedictionary、/app、/zh-TW/... 等子站路徑保持原樣）
    if re.fullmatch(r"/[a-z]\d+", path):
        path = "/zh" + path
    elif path == "/":
        path = "/zh/"
    q = f"?{p.query}" if p.query else ""
    return f"https://{ALLOWED_HOST}{path}{q}"


def is_pdf(url: str) -> bool:
    return "/documents/" in url or url.lower().split("?")[0].endswith(".pdf")


def extract(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    title = (soup.title.string or "").replace(" - 法國巴黎人壽 - Liferay Production TW", "").strip() if soup.title else ""

    # 找 Liferay portlet，保留非導覽區塊
    portlets = soup.select("section.portlet, div.portlet-boundary")
    kept = []
    for pt in portlets:
        t = pt.select_one(".portlet-title-text, .portlet-title, h2")
        ptitle = t.get_text(strip=True) if t else ""
        if ptitle and BOILERPLATE_TITLE.match(ptitle):
            continue
        # 避免巢狀 portlet 重複收錄
        if any(pt in k.descendants for k in kept):
            continue
        kept.append(pt)

    if not kept:  # 版型不符時的備援：整個 body 去掉 header/footer/nav
        body = soup.body or soup
        for tag in body.select("header, footer, nav, script, style"):
            tag.decompose()
        kept = [body]

    for k in kept:
        for tag in k.select("script, style, select, input, button"):
            tag.decompose()

    content_md = "\n\n".join(to_md(str(k), heading_style="ATX") for k in kept)
    content_md = re.sub(r"\n{3,}", "\n\n", content_md).strip()

    # 麵包屑：內文中以「首頁」開頭的那串連結
    breadcrumb = []
    home = None
    for k in kept:
        home = k.find("a", string=re.compile(r"^\s*首頁\s*$"))
        if home:
            break
    if home and home.find_parent("ul"):
        breadcrumb = [a.get_text(strip=True) for a in home.find_parent("ul").find_all("a")]

    links, pdfs = [], []
    for k in kept:
        for a in k.find_all("a", href=True):
            href = urljoin(url, a["href"])
            text = a.get_text(" ", strip=True)
            if is_pdf(href):
                pdfs.append({"title": text, "url": href})
            else:
                links.append({"text": text, "url": href})

    return {"url": url, "title": title, "breadcrumb": breadcrumb,
            "content_md": content_md, "links": links, "pdfs": pdfs}


def safe_name(url: str) -> str:
    name = unquote(urlparse(url).path.split("/")[-1]) or "file.pdf"
    name = re.sub(r'[\\/:*?"<>|]', "_", name)
    return name if name.lower().endswith(".pdf") else name + ".pdf"


class NonHtmlResponse(ValueError):
    def __init__(self, status_code, content_type):
        super().__init__('非公開 HTML；不讀取或下載二進位內容')
        self.status_code, self.content_type = status_code, content_type


def public_get(session, url, rp, delay, *, html_only=False):
    """Check every redirect against the host and robots before making the next request."""
    for _ in range(4):
        if not norm(url) or not rp.can_fetch(UA, url) or (html_only and is_pdf(url)):
            raise ValueError("非允許的公開來源或 robots 禁止")
        try:
            response = session.get(url, timeout=(5, 15), allow_redirects=False, stream=True)
            if response.is_redirect:
                url = urljoin(url, response.headers.get("Location", ""))
                response.close()
                continue
            if html_only and 'text/html' not in response.headers.get('Content-Type', '').lower():
                response.close()
                raise NonHtmlResponse(response.status_code, response.headers.get('Content-Type', ''))
            chunks, size = [], 0
            for chunk in response.iter_content(65536):
                size += len(chunk)
                if size > 2 * 1024 * 1024:
                    response.close()
                    raise ValueError("頁面超過 2 MiB 限制")
                chunks.append(chunk)
            response._content = b"".join(chunks)
            response.close()
            return response
        finally:
            time.sleep(delay)
    raise ValueError("重新導向次數超過限制")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-pages", type=int, default=400)
    ap.add_argument("--delay", type=float, default=1.5)
    ap.add_argument("--download-pdfs", action="store_true")
    ap.add_argument("--out", default="data/crawl")
    ap.add_argument("--start-url", action="append", help="只從明確指定的公開來源開始")
    ap.add_argument("--no-follow-links", action="store_true")
    args = ap.parse_args()
    if args.delay < 1.5 or not 1 <= args.max_pages <= 400:
        ap.error("請保留至少 1.5 秒間隔、1–400 頁上限")

    out = Path(args.out)
    if out.exists() and any(out.iterdir()):
        ap.error("輸出目錄必須為全新或空目錄，避免覆蓋既有 Snapshot")
    out.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers["User-Agent"] = UA

    robots_url = f"{BASE}/robots.txt"
    robots = session.get(robots_url, timeout=(5, 15), allow_redirects=False)
    if robots.status_code != 200:
        raise RuntimeError("無法驗證 robots.txt；停止擷取")
    rp = robotparser.RobotFileParser()
    rp.parse(robots.text.splitlines())
    (out / "robots.txt").write_text(robots.text, encoding="utf-8")
    time.sleep(args.delay)
    queue = deque(filter(None, map(norm, args.start_url or START_URLS)))
    seen = set(queue)
    documents: dict[str, dict] = {}
    count = 0

    with open(out / "pages.jsonl", "w", encoding="utf-8") as f:
        while queue and count < args.max_pages:
            url = queue.popleft()
            if not rp.can_fetch(UA, url):
                print(f"[robots 禁止] {url}")
                continue
            try:
                r = public_get(session, url, rp, args.delay)
            except (requests.RequestException, ValueError) as e:
                print(f"[錯誤] {url} {e}")
                continue
            if r.status_code != 200 or "text/html" not in r.headers.get("Content-Type", ""):
                print(f"[略過 {r.status_code}] {url}")
                continue

            r.encoding = "utf-8"
            page = extract(r.text, url)
            page.update({"retrievedAt": datetime.now(timezone.utc).date().isoformat(), "sourceType": "public_site_snapshot", "reviewStatus": "pending", "sha256": hashlib.sha256(r.content).hexdigest(), "content_text": BeautifulSoup(r.text, "html.parser").get_text(" ", strip=True)})
            f.write(json.dumps(page, ensure_ascii=False) + "\n")
            count += 1
            print(f"[{count}] {page['title']}  {url}")

            for d in page["pdfs"]:
                doc = documents.setdefault(d["url"], {"title": d["title"], "url": d["url"], "found_on": []})
                if url not in doc["found_on"]:
                    doc["found_on"].append(url)
            for l in ([] if args.no_follow_links else page["links"]):
                n = norm(l["url"])
                if n and n not in seen:
                    seen.add(n)
                    queue.append(n)

    (out / "documents.json").write_text(
        json.dumps(list(documents.values()), ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n完成：{count} 頁，{len(documents)} 份 PDF 連結")

    if args.download_pdfs:
        pdf_dir = out / "pdfs"
        pdf_dir.mkdir(exist_ok=True)
        for i, doc in enumerate(documents.values(), 1):
            if not rp.can_fetch(UA, doc["url"]):
                continue
            try:
                r = public_get(session, doc["url"], rp, args.delay)
                if r.status_code == 200:
                    (pdf_dir / safe_name(doc["url"])).write_bytes(r.content)
                    print(f"[PDF {i}/{len(documents)}] {doc['title']}")
            except (requests.RequestException, ValueError) as e:
                print(f"[PDF 錯誤] {doc['url']} {e}")
            time.sleep(args.delay)


if __name__ == "__main__":
    main()
