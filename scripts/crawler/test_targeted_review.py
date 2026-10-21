import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import requests
import targeted_review as review


class ReviewTests(unittest.TestCase):
    def page(self, text, status='ok'):
        return {'sourceId': 'snapshot:test', 'sourceUrl': review.BASE + '/zh/a312',
                'retrievedAt': '2026-10-21T12:00:00+00:00', 'extractionStatus': status,
                'paragraphs': review.paragraphs(text)}

    def diff(self, old, new):
        return review.page_diff({'content_md': old, 'retrievedAt': '2026-10-20'}, new,
                                {'knowledgeIds': ['service:change_address'], 'navigationTargets': []})

    def test_normalization_preserves_rule_numbers_negation_tables_and_order(self):
        value = '# 文件\n\n不可省略正本，10 日內寄回。\n\n|條件|金額|\n|---|---|\n|不適用|30萬元|'
        self.assertEqual(review.normalize(value), value)
        self.assertNotEqual(review.digest(review.normalize(value)), review.digest(review.normalize(value.replace('10', '15'))))
        self.assertNotEqual(review.digest(review.normalize(value)), review.digest(review.normalize(value.replace('不可', '可以'))))

    def test_paragraph_ids_do_not_depend_on_array_positions(self):
        before = review.paragraphs('# 地址\n\n原文一\n\n原文二')
        after = review.paragraphs('# 地址\n\n新段落\n\n原文一\n\n原文二')
        self.assertEqual([p['id'] for p in before], [p['id'] for p in after if p['text'] != '新段落'])

    def test_identical_repeated_paragraphs_have_unique_ids_without_global_position(self):
        before = review.paragraphs('# 地址\n\n下載\n\n下載')
        after = review.paragraphs('# 地址\n\n新增其他內容\n\n下載\n\n下載')
        self.assertEqual(len({r['id'] for r in before}), 3)
        self.assertEqual([r['id'] for r in before], [r['id'] for r in after if r['text'] != '新增其他內容'])

    def test_failed_fetch_and_extraction_never_remove_old_content(self):
        for status, category in [('fetch_failed', 'Fetch Failed'), ('extraction_failed', 'Extraction Failed')]:
            changes = self.diff('舊的有效規則，不可刪除', self.page('', status))
            self.assertEqual([c['category'] for c in changes], [category])
            self.assertTrue(changes[0]['oldContentRetained'])

    def test_modified_content_shows_both_hashes_and_pending_decision(self):
        changes = self.diff('# 文件\n\n須於 10 日內寄回正本。', self.page('# 文件\n\n須於 15 日內寄回正本。'))
        modified = next(c for c in changes if c['category'] == 'Modified')
        self.assertIn('10', modified['old']['text'])
        self.assertIn('15', modified['new']['text'])
        self.assertNotEqual(modified['old']['sha256'], modified['new']['sha256'])
        self.assertEqual(modified['reviewStatus'], 'pending')
        self.assertIn('原段落', review.render_report({'generatedAt':'now', 'summary':{}, 'pages':[], 'changes':changes}))

    def test_order_change_requires_manual_review(self):
        changes = self.diff('# 規則\n\n一\n\n二', self.page('# 規則\n\n二\n\n一'))
        self.assertEqual(sum(c['category'] == 'Requires Manual Review' for c in changes), 1)
        self.assertEqual(sum(c['category'] == 'Unchanged' for c in changes), 3)

    def test_inventory_only_uses_old_sources_and_verified_a319(self):
        pages = [json.loads(line) for line in review.BASELINE.read_text().splitlines()]
        self.assertEqual(len(review.inventory(pages)), 8)
        for page in pages:
            page['links'] = []
        with self.assertRaises(ValueError):
            review.inventory(pages)

    def test_timeout_has_one_retry_and_safe_failure(self):
        with patch.object(review, 'public_get', side_effect=requests.Timeout('secret transport detail')) as fetch:
            result = review.fetch_page(Mock(), Mock(), review.BASE + '/zh/a312', 1.5)
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(result['extractionStatus'], 'fetch_failed')
        self.assertEqual(result['error'], 'Timeout')
        self.assertEqual(result['attempts'], 2)

    def test_forbidden_and_binary_responses_are_not_retried_or_extracted(self):
        for code, mime, expected in [(403, 'text/html', 'fetch_failed'), (200, 'application/pdf', 'extraction_failed')]:
            response = Mock(status_code=code, content=b'no extract', headers={'Content-Type':mime})
            with patch.object(review, 'public_get', return_value=response) as fetch, patch.object(review, 'extract') as extract:
                result = review.fetch_page(Mock(), Mock(), review.BASE + '/zh/a312', 1.5)
            self.assertEqual(fetch.call_count, 1)
            extract.assert_not_called()
            self.assertEqual(result['extractionStatus'], expected)

    def test_robots_failure_does_not_fetch_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'fresh'
            with patch('sys.argv', ['review', '--out', str(out), '--report', str(Path(directory) / 'diff.md')]), \
                 patch.object(review.subprocess, 'check_output', return_value='[]'), \
                 patch.object(review.requests, 'Session') as session, patch.object(review, 'fetch_page') as fetch:
                session.return_value.get.return_value.status_code = 503
                with self.assertRaises(RuntimeError):
                    review.main()
                fetch.assert_not_called()

    def test_extractor_failure_is_recorded_without_deleting_previous_content(self):
        response = Mock(status_code=200, content=b'public html', headers={'Content-Type':'text/html'})
        with patch.object(review, 'public_get', return_value=response), patch.object(review, 'extract', side_effect=ValueError('bad markup')):
            result = review.fetch_page(Mock(), Mock(), review.BASE + '/zh/a312', 1.5)
        self.assertEqual(result['extractionStatus'], 'extraction_failed')
        self.assertTrue(self.diff('old valid rule', result)[0]['oldContentRetained'])


if __name__ == '__main__':
    unittest.main()
