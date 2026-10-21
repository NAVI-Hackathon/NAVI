"""Local, fixed-inventory HTML review. Never writes production knowledge."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from difflib import SequenceMatcher
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time
import unicodedata
from urllib import robotparser

import requests
from cardif_crawler import BASE, UA, NonHtmlResponse, extract, is_pdf, norm, public_get

ROOT = Path(__file__).resolve().parents[2]
BASELINE = ROOT / 'data/crawl/review-2026-10-20/pages.jsonl'
EXTRA = BASE + '/zh/a319'
REVIEW_STATES = {'pending', 'approved', 'rejected', 'needs_followup'}


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode('utf-8')).hexdigest()


def normalize(text):
    # Preserve numbers, negation, punctuation, table/paragraph boundaries and order.
    text = unicodedata.normalize('NFC', text).replace('\r\n', '\n').replace('\r', '\n')
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(re.sub(r'[ \t]+', ' ', line).strip() for line in text.split('\n'))).strip()


def paragraphs(markdown):
    heading = []
    rows = []
    occurrences = Counter()
    for block in re.split(r'\n\s*\n', normalize(markdown)):
        if not block:
            continue
        for line in block.splitlines():
            match = re.fullmatch(r'(#{1,6})\s+(.+)', line)
            if match:
                level = len(match[1])
                heading = [(n, title) for n, title in heading if n < level] + [(level, match[2])]
        section = 'section:' + digest(json.dumps(heading, ensure_ascii=False))[:20]
        identity = section + ':p:' + digest(block)[:20]
        occurrences[identity] += 1
        rows.append({'id': identity + ':occurrence:' + str(occurrences[identity]), 'sectionId': section,
                     'heading': ' / '.join(title for _, title in heading), 'text': block, 'sha256': digest(block)})
    return rows


def page_diff(old, new, impact):
    common = {'sourceId': new['sourceId'], 'sourceUrl': new['sourceUrl'], 'retrievedAt': new['retrievedAt'],
              'previousRetrievedAt': old.get('retrievedAt') if old else None, **impact}
    changes = []

    def add(kind, before=None, after=None, **extra):
        change_id = 'change:' + digest(json.dumps([common['sourceUrl'], kind, before, after], ensure_ascii=False, sort_keys=True))[:24]
        changes.append({**common, 'changeId': change_id, 'category': kind, 'old': before, 'new': after,
                        'reviewStatus': 'pending' if kind != 'Unchanged' else None,
                        'recommendation': '逐筆核對原文、條件與對應知識；未批准不可採用。', **extra})

    if new['extractionStatus'] != 'ok':
        add('Fetch Failed' if new['extractionStatus'] == 'fetch_failed' else 'Extraction Failed',
            failure=new.get('error'), oldContentRetained=True)
        return changes
    before = paragraphs(old['content_md']) if old else []
    after = new['paragraphs']
    remaining = list(after)
    unmatched = []
    for row in before:
        match = next((i for i, item in enumerate(remaining) if item['id'] == row['id']), None)
        if match is None:
            unmatched.append(row)
        else:
            add('Unchanged', row, remaining.pop(match))
    for row in unmatched:
        candidates = [(SequenceMatcher(None, row['text'], item['text'], autojunk=False).ratio(), i)
                      for i, item in enumerate(remaining) if item['sectionId'] == row['sectionId']]
        candidates.sort(reverse=True)
        # shortcut: pairing is an editorial aid, never an approved semantic change.
        if candidates and candidates[0][0] >= .72 and (len(candidates) == 1 or candidates[0][0] - candidates[1][0] >= .12):
            similarity, i = candidates[0]
            add('Modified', row, remaining.pop(i), pairing='same-section unique text similarity', similarity=similarity)
        else:
            add('Removed', row)
    for row in remaining:
        add('Added', after=row)
    old_order = [row['id'] for row in before]
    new_order = [row['id'] for row in after]
    if old_order != new_order:
        add('Requires Manual Review', reason='段落內容或順序不同；包含抽取器差異，不能直接視為官方規則變更。',
            oldOrder=old_order, newOrder=new_order)
    return changes


def inventory(old_pages):
    urls = [page['url'] for page in old_pages]
    if EXTRA not in {norm(link['url']) for page in old_pages for link in page.get('links', [])}:
        raise ValueError('a319 must be a verified baseline link')
    urls.append(EXTRA)
    if len(set(urls)) != 8 or any(norm(url) != url or is_pdf(url) for url in urls):
        raise ValueError('Unexpected source inventory')
    return urls


def fetch_page(session, rp, url, delay):
    page = {'sourceId': 'snapshot:' + digest(url)[:20], 'sourceUrl': url, 'url': url,
            'sourceType': 'public_site_snapshot', 'reviewStatus': 'pending', 'title': None,
            'httpStatus': None, 'rawContentSha256': None, 'normalizedContentSha256': None,
            'sectionIds': [], 'paragraphs': [], 'retrievedAt': None}
    for attempt in range(2):
        page['attempts'] = attempt + 1
        try:
            response = public_get(session, url, rp, delay, html_only=True)
            page['httpStatus'] = response.status_code
            if response.status_code in (502, 503, 504) and attempt == 0:
                continue
            page['retrievedAt'] = datetime.now(timezone.utc).isoformat()
            page['rawContentSha256'] = digest(response.content)
            if response.status_code != 200:
                raise ValueError('HTTP ' + str(response.status_code))
            if 'text/html' not in response.headers.get('Content-Type', '').lower():
                page.update(extractionStatus='extraction_failed', error='Not public HTML; binary/PDF not extracted')
                return page
            response.encoding = 'utf-8'
            try:
                extracted = extract(response.text, url)
            except Exception as error:
                page.update(extractionStatus='extraction_failed', error=type(error).__name__)
                return page
            content = normalize(extracted['content_md'])
            if len(content) < 40 or not extracted['title']:
                page.update(extractionStatus='extraction_failed', error='Missing title or substantive HTML content')
                return page
            rows = paragraphs(content)
            page.update(extracted, content_md=content, paragraphs=rows, sectionIds=list(dict.fromkeys(r['sectionId'] for r in rows)),
                        normalizedContentSha256=digest(content), extractionStatus='ok')
            return page
        except NonHtmlResponse as error:
            page.update(extractionStatus='extraction_failed', httpStatus=error.status_code, error=str(error))
            break
        except requests.RequestException as error:
            if attempt == 0 and isinstance(error, (requests.Timeout, requests.ConnectionError)):
                continue
            page.update(extractionStatus='fetch_failed', error=type(error).__name__)
            break
        except ValueError as error:
            page.update(extractionStatus='fetch_failed', error=str(error))
            break
    page['retrievedAt'] = datetime.now(timezone.utc).isoformat()
    return page


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def render_report(report):
    lines = ['# 官網定向擷取差異報告', '', f"產生時間：{report['generatedAt']}", '',
             '**候選資料，尚未批准，不在正式 Knowledge／Browser Bundle／VPS 中。**', '',
             '舊 Snapshot 只有日精度，不能推測時間；本次 retrievedAt 是實際擷取時間，非官方發布日。',
             'Modified 為同節唯一文字相似配對；Added／Removed 可能含抽取差異，全部必須人工核對。', '',
             '## 實際結果', '', '```json', json.dumps(report['summary'], ensure_ascii=False, indent=2), '```', '',
             '## 頁面', '']
    for page in report['pages']:
        lines.extend([f"- {page['sourceId']} — {page['sourceUrl']}",
                      f"  HTTP {page['httpStatus']}／{page['extractionStatus']}；{page['retrievedAt']}",
                      f"  raw SHA-256 `{page['rawContentSha256']}`；normalized `{page['normalizedContentSha256']}`"])
    lines.extend(['', '## 逐筆差異（Unchanged 原文與雜湊完整保留於 JSON）', ''])
    for change in report['changes']:
        if change['category'] == 'Unchanged':
            continue
        lines.extend([f"### {change['changeId']} — {change['category']}", '',
                      f"來源：{change['sourceId']} {change['sourceUrl']}",
                      f"擷取：{change['retrievedAt']}；審核：pending", '',
                      f"影響 Knowledge IDs：{', '.join(change['knowledgeIds']) or '無既有對應；需人工建立映射'}",
                      '導航：`' + json.dumps(change['navigationTargets'], ensure_ascii=False) + '`', ''])
        for key, title in [('old', '原段落'), ('new', '新段落')]:
            row = change[key]
            lines.extend([f"**{title}** SHA-256 `{row['sha256'] if row else '無'}`", '',
                          '```text', row['text'] if row else '無（詳見分類；失敗不代表內容刪除）', '```', ''])
        lines.extend([change.get('reason', change.get('failure', change['recommendation'])), ''])
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True)
    parser.add_argument('--report', required=True, help='Markdown output; JSON sibling is also written')
    parser.add_argument('--from-snapshot', help='Rebuild derived IDs/diff offline from a prior capture; no network or date refresh')
    args = parser.parse_args()
    out, report_path = Path(args.out), Path(args.report)
    if out.exists() or report_path.exists() or report_path.with_suffix('.json').exists():
        parser.error('Use fresh paths; existing snapshots/reports are never overwritten')
    old_pages = [json.loads(line) for line in BASELINE.read_text().splitlines() if line.strip()]
    urls = inventory(old_pages)
    mappings = json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
        "import {knowledgeEntries} from './shared/knowledge/index.js'; console.log(JSON.stringify(knowledgeEntries.map(e=>({id:e.id,url:e.sourceUrl,target:e.navigationDestination}))));"], cwd=ROOT, text=True))
    impacts = defaultdict(lambda: {'knowledgeIds': [], 'navigationTargets': []})
    for item in mappings:
        key = norm(item['url'])
        impacts[key]['knowledgeIds'].append(item['id'])
        impacts[key]['navigationTargets'].append({k: item['target'][k] for k in ('kind', 'path', 'anchor')})
    out.mkdir(parents=True)
    if args.from_snapshot:
        capture = Path(args.from_snapshot)
        pages = [json.loads(line) for line in (capture / 'pages.jsonl').read_text().splitlines()]
        if [p['sourceUrl'] for p in pages] != urls:
            raise ValueError('Snapshot inventory mismatch')
        for page in pages:
            if page['sourceId'] != 'snapshot:' + digest(page['sourceUrl'])[:20]:
                raise ValueError('Snapshot source ID mismatch')
            if datetime.fromisoformat(page['retrievedAt'].replace('Z', '+00:00')).utcoffset() is None:
                raise ValueError('Snapshot retrieval time must include a timezone')
            if page['extractionStatus'] == 'ok':
                if page['normalizedContentSha256'] != digest(normalize(page['content_md'])):
                    raise ValueError('Snapshot content hash mismatch')
                page['paragraphs'] = paragraphs(page['content_md'])
                page['sectionIds'] = list(dict.fromkeys(r['sectionId'] for r in page['paragraphs']))
        robots_bytes = (capture / 'robots.txt').read_bytes()
        (out / 'robots.txt').write_bytes(robots_bytes)
        delay = None
    else:
        session = requests.Session()
        session.headers['User-Agent'] = UA
        robots = session.get(BASE + '/robots.txt', timeout=(5, 15), allow_redirects=False)
        if robots.status_code != 200 or len(robots.content) > 256 * 1024:
            raise RuntimeError('Cannot verify robots; no source page was requested')
        robots_bytes = robots.content
        (out / 'robots.txt').write_text(robots.text, encoding='utf-8')
        rp = robotparser.RobotFileParser()
        rp.parse(robots.text.splitlines())
        delay = max(1.5, rp.crawl_delay(UA) or 0, rp.crawl_delay('*') or 0)
        time.sleep(delay)
        pages = []
        for url in urls:
            page = fetch_page(session, rp, url, delay)
            pages.append(page)
            print(page['extractionStatus'], page['httpStatus'], url, flush=True)
    (out / 'pages.jsonl').write_text(''.join(json.dumps(p, ensure_ascii=False) + '\n' for p in pages), encoding='utf-8')
    previous = {page['url']: page for page in old_pages}
    changes = [change for page in pages for change in page_diff(previous.get(page['sourceUrl']), page, impacts[page['sourceUrl']])]
    summary = {'pages': len(pages), 'successful': sum(p['extractionStatus'] == 'ok' for p in pages),
               'failed': sum(p['extractionStatus'] != 'ok' for p in pages),
               'categories': {key: sum(c['category'] == key for c in changes) for key in
                              ('Added', 'Modified', 'Removed', 'Unchanged', 'Fetch Failed', 'Extraction Failed', 'Requires Manual Review')},
               'pendingReview': sum(c['reviewStatus'] == 'pending' for c in changes),
               'adopted': 0, 'liveGeminiRequests': 0, 'paidApiCalls': 0, 'pdfDownloads': 0}
    report = {'generatedAt': datetime.now(timezone.utc).isoformat(), 'baseline': str(BASELINE.relative_to(ROOT)),
              'baselineSha256': digest(BASELINE.read_bytes()), 'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'robotsSha256': digest(robots_bytes), 'userAgent': UA, 'delaySeconds': delay,
              'derivedFromSnapshot': args.from_snapshot, 'runnerSha256': digest(Path(__file__).read_bytes()),
              'summary': summary, 'pages': [{k: v for k, v in page.items() if k not in ('content_md', 'paragraphs', 'links', 'pdfs')} for page in pages],
              'changes': changes}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(render_report(report), encoding='utf-8')
    write_json(report_path.with_suffix('.json'), report)
    write_json(out / 'review-checklist.json', {'allowedStates': sorted(REVIEW_STATES), 'autoAdoption': False,
               'items': [{'changeId': c['changeId'], 'sourceId': c['sourceId'], 'sourceUrl': c['sourceUrl'], 'category': c['category'],
                          'status': 'pending', 'reviewer': None, 'reviewedAt': None, 'decisionReason': None}
                         for c in changes if c['reviewStatus'] == 'pending']})
    write_json(out / 'documents.json', [{'sourceId': p['sourceId'], 'sourceUrl': p['sourceUrl'], 'retrievedAt': p['retrievedAt'],
                                       'links': p.get('pdfs', [])} for p in pages])
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
