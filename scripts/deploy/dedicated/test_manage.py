import importlib.util,pathlib,tempfile,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('dedicated',pathlib.Path(__file__).with_name('manage.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_release_path_and_symlink_escape(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(m,'ROOT',pathlib.Path(tmp).resolve()):
   root=m.ROOT;path=root/'releases'/('a'*12+'-1');path.mkdir(parents=True);(path/'ready.json').write_text('{}')
   self.assertEqual(m.release(path),path)
   with self.assertRaises(RuntimeError):m.release('/etc')
   (root/'current').symlink_to('/etc')
   with self.assertRaises(RuntimeError):m.release(root/'current')
 def test_writable_or_symlinked_ready_marker_is_refused(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(m,'ROOT',pathlib.Path(tmp).resolve()):
   p=m.ROOT/'releases'/('a'*12+'-1');p.mkdir(parents=True);ready=p/'ready.json';ready.write_text('{}');ready.chmod(0o666)
   with self.assertRaises(RuntimeError):m.release(p)
   ready.unlink();other=m.ROOT/'other.json';other.write_text('{}');ready.symlink_to(other)
   with self.assertRaises(RuntimeError):m.release(p)
 def test_failed_activation_restores_previous_release(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(m,'ROOT',pathlib.Path(tmp).resolve()):
   root=m.ROOT
   old=root/'releases'/('a'*12+'-1');new=root/'releases'/('b'*12+'-2')
   for p in [old,new]:p.mkdir(parents=True);(p/'ready.json').write_text('{"providerIsolation":true}' if p==new else '{}')
   (root/'current').symlink_to(old)
   with patch.object(m,'owned_service'),patch.object(m,'run'),patch.object(m,'healthy',side_effect=RuntimeError('synthetic health failure')),patch.object(m.time,'sleep'):
    with self.assertRaises(RuntimeError):m.activate(new)
   self.assertEqual((root/'current').resolve(),old)
 def test_foreign_service_is_never_managed(self):
  with patch.object(m.subprocess,'check_output',return_value='FragmentPath=/etc/systemd/system/other.service\nDescription=Other project\n'):
   with self.assertRaises(RuntimeError):m.owned_service()
 def test_legacy_rollback_stops_api_instead_of_restoring_demo(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(m,'ROOT',pathlib.Path(tmp).resolve()):
   root=m.ROOT;old=root/'releases'/('a'*12+'-1');new=root/'releases'/('b'*12+'-2')
   for p in [old,new]:p.mkdir(parents=True);(p/'ready.json').write_text('{"providerIsolation":true}' if p==new else '{}')
   (root/'current').symlink_to(old)
   with patch.object(m,'owned_service'),patch.object(m,'run') as run,patch.object(m,'healthy',side_effect=RuntimeError('synthetic')),patch.object(m.time,'sleep'):
    with self.assertRaises(RuntimeError):m.activate(new)
    self.assertIn(unittest.mock.call(['systemctl','stop',m.UNIT]),run.call_args_list)
 def test_health_rejects_demo_and_requires_restricted_status(self):
  from io import StringIO
  class Reply(StringIO):
   def __init__(self,body,mode):super().__init__(body);self.headers={'X-NAVI-AI-Mode':mode}
  with patch.object(m.urllib.request,'urlopen',return_value=Reply('{"status":"ok","aiProviderConfigured":false}','demo')):
   with self.assertRaises(RuntimeError):m.healthy()
  with patch.object(m.urllib.request,'urlopen',side_effect=[Reply('{"status":"ok","aiProviderConfigured":true}','live'),Reply('{"mode":"live","available":true,"syntheticOnly":true}','live')]):m.healthy()
 def test_explicit_legacy_activation_is_rejected_before_start(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(m,'ROOT',pathlib.Path(tmp).resolve()):
   p=m.ROOT/'releases'/('a'*12+'-1');p.mkdir(parents=True);(p/'ready.json').write_text('{}')
   with patch.object(m,'run') as run:
    with self.assertRaises(RuntimeError):m.activate(p)
    run.assert_not_called()
if __name__=='__main__':unittest.main()

class EnvironmentTests(unittest.TestCase):
 def test_failed_activation_restores_environment_before_restart(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(m,'ROOT',pathlib.Path(tmp).resolve()):
   root=m.ROOT;config=root/'config';config.mkdir();env=config/'api.env';env.write_bytes(b'OLD=private\n');env.chmod(0o600)
   candidate=config/'candidate.env';candidate.write_bytes(b'NEW=private\n');candidate.chmod(0o600)
   old=root/'releases'/('c'*12+'-1');new=root/'releases'/('d'*12+'-2')
   for p in [old,new]:p.mkdir(parents=True);(p/'ready.json').write_text('{"providerIsolation":true}')
   (root/'current').symlink_to(old)
   observed=[]
   def run(args,**kw):
    if args==['systemctl','restart',m.UNIT]:observed.append(env.read_bytes())
   with patch.object(m,'owned_service'),patch.object(m,'run',side_effect=run),patch.object(m,'healthy',side_effect=RuntimeError('synthetic')),patch.object(m.time,'sleep'):
    with self.assertRaises(RuntimeError):m.activate(new,candidate)
   self.assertEqual(observed,[b'NEW=private\n',b'OLD=private\n']);self.assertEqual((root/'current').resolve(),old)
 def test_environment_rejects_external_paths_and_symlinks(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(m,'ROOT',pathlib.Path(tmp).resolve()):
   (m.ROOT/'config').mkdir();outside=m.ROOT/'outside';outside.write_text('private');outside.chmod(0o600)
   with self.assertRaises(RuntimeError):m.private_environment(outside)
   path=m.ROOT/'config/candidate.env';path.symlink_to(outside)
   with self.assertRaises(RuntimeError):m.private_environment(path)


class ProductReadinessTests(unittest.TestCase):
 def test_product_activation_requires_database_readiness(self):
  from io import StringIO
  class Reply(StringIO):
   def __init__(self,body):super().__init__(body);self.headers={'X-NAVI-AI-Mode':'live'}
  replies=['{"status":"ok","aiProviderConfigured":true}','{"mode":"live","available":true,"syntheticOnly":true,"product":{"enabled":true}}']
  with patch.object(m.urllib.request,'urlopen',side_effect=[Reply(v) for v in replies+['{"status":"ready","storage":"mongodb_encrypted"}']]) as call:
   m.healthy();self.assertEqual(call.call_count,3)
  with patch.object(m.urllib.request,'urlopen',side_effect=[Reply(v) for v in replies+['{"status":"ready","storage":"memory"}']]):
   with self.assertRaises(RuntimeError):m.healthy()
