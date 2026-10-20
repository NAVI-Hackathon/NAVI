import importlib.util, pathlib, tempfile, unittest
from unittest.mock import Mock, patch
spec = importlib.util.spec_from_file_location('crawler', pathlib.Path(__file__).with_name('cardif_crawler.py'))
c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
class Tests(unittest.TestCase):
 def test_redirect_never_fetches_external_host(self):
  session = Mock(); response = Mock(is_redirect=True, headers={'Location':'https://evil.example/'})
  session.get.return_value=response; rp=Mock(); rp.can_fetch.return_value=True
  with patch.object(c.time,'sleep'), self.assertRaises(ValueError): c.public_get(session,c.BASE+'/zh/a312',rp,2)
  self.assertEqual(session.get.call_count,1)
  self.assertFalse(session.get.call_args.kwargs['allow_redirects'])
 def test_robots_denial_is_checked_before_request(self):
  session=Mock();rp=Mock();rp.can_fetch.return_value=False
  with self.assertRaises(ValueError):c.public_get(session,c.BASE+'/private',rp,2)
  session.get.assert_not_called()
 def test_existing_snapshot_cannot_be_overwritten(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=pathlib.Path(tmp)/'pages.jsonl';p.write_text('preserve')
   with patch('sys.argv',['crawler','--out',tmp]),self.assertRaises(SystemExit):c.main()
   self.assertEqual(p.read_text(),'preserve')
 def test_robots_unavailable_stops_before_page_fetch(self):
  with tempfile.TemporaryDirectory() as tmp,patch('sys.argv',['crawler','--out',tmp]),patch.object(c.requests,'Session') as session:
   session.return_value.get.return_value.status_code=503
   with self.assertRaises(RuntimeError):c.main()
   self.assertEqual(session.return_value.get.call_count,1)
