import importlib.util,json,pathlib,tempfile,unittest
from types import SimpleNamespace
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('manager',pathlib.Path(__file__).with_name('manage-navi.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class SafetyTests(unittest.TestCase):
 def test_paths_and_symlink_escape(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(m,'ROOT',pathlib.Path(tmp).resolve()):
   self.assertEqual(m.inside(pathlib.Path(tmp).resolve()/'releases/new'),pathlib.Path(tmp).resolve()/'releases/new')
   with self.assertRaises(RuntimeError):m.inside(pathlib.Path(tmp)/'../other')
   (pathlib.Path(tmp)/'escape').symlink_to('/etc')
   with self.assertRaises(RuntimeError):m.inside(pathlib.Path(tmp)/'escape/passwd')
 def test_foreign_unit_and_reused_pid_are_never_stopped(self):
  manifest={'id':'synthetic-deployment','account':{'uid':998}}
  for prop in [{'LoadState':'loaded','Description':'Someone else','MainPID':'42'}, {'LoadState':'loaded','Description':m.description(manifest,'api'),'MainPID':'42'}]:
   with patch.object(m,'props',return_value=prop),patch.object(m,'pid_owned',return_value=False),patch.object(m,'run') as run:
    with self.assertRaises(RuntimeError):m.stop(manifest,('api',))
    run.assert_not_called()
 def test_remove_defaults_to_dry_run_without_stopping_or_deleting(self):
  manifest={'units':[],'account':{'name':'synthetic'},'runtimeSystemPaths':[]}
  with patch.object(m,'tree_safe'),patch.object(m,'slice_safe'),patch.object(m,'stop') as stop,patch.object(m.shutil,'rmtree') as delete,patch.object(m,'run') as run:
   m.remove(manifest,False);stop.assert_not_called();delete.assert_not_called();run.assert_not_called()
 def test_protected_listener_change_is_detected(self):
  old='tcp LISTEN 0 511 *:5000 *:* users:(("node",pid=42,fd=1))'
  new=old.replace('pid=42','pid=43')
  self.assertNotEqual(m.listener_map(old),m.listener_map(new))
 def test_confirmed_cleanup_is_not_blocked_by_historical_health_counters(self):
  manifest={'units':[],'ports':{},'account':{'name':'synthetic'},'runtimeSystemPaths':[]}
  with patch.object(m,'tree_safe'),patch.object(m,'slice_safe'),patch.object(m,'stop'),patch.object(m,'save'),patch.object(m,'resources_ok',side_effect=RuntimeError('old OOM')) as health,patch.object(m.pwd,'getpwnam',side_effect=KeyError),patch.object(m.grp,'getgrnam',side_effect=KeyError),patch.object(m.shutil,'rmtree') as delete:
   m.remove(manifest,True);health.assert_not_called();delete.assert_called_once_with(m.ROOT)
 def test_removal_resume_refuses_reused_account_identifiers(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(m,'ROOT',pathlib.Path(tmp).resolve()):
   manifest={'account':{'name':'navi-test','uid':998,'gid':998,'createdByNavi':True},'removalStarted':True}
   with patch.object(m.pwd,'getpwnam',side_effect=KeyError),patch.object(m.pwd,'getpwuid',return_value=SimpleNamespace(pw_name='other')):
    with self.assertRaisesRegex(RuntimeError,'UID reused'):m.tree_safe(manifest)
   with patch.object(m.pwd,'getpwnam',side_effect=KeyError),patch.object(m.pwd,'getpwuid',side_effect=KeyError),patch.object(m.grp,'getgrgid',return_value=SimpleNamespace(gr_name='other',gr_mem=[])):
    with self.assertRaisesRegex(RuntimeError,'group dependencies'):m.tree_safe(manifest)
   with patch.object(m.pwd,'getpwnam',side_effect=KeyError),patch.object(m.pwd,'getpwuid',side_effect=KeyError),patch.object(m.grp,'getgrgid',side_effect=KeyError),patch.object(m.pwd,'getpwall',return_value=[]),patch.object(m,'props',return_value={'MainPID':'0'}),patch.object(m.subprocess,'run',return_value=SimpleNamespace(returncode=1)),patch.object(m,'output',return_value=''):
    m.tree_safe(manifest)
 def test_foreign_slice_configuration_is_refused(self):
  for config in ['FragmentPath=/etc/systemd/system/navihackathon.slice\nDropInPaths=', 'FragmentPath=\nDropInPaths=/etc/systemd/system/navihackathon.slice.d/other.conf', 'FragmentPath=\nDropInPaths=/run/systemd/system.control/navihackathon.slice.d/foreign.conf']:
   with patch.object(m,'output',return_value=config):
    with self.assertRaises(RuntimeError):m.slice_safe()
 def test_resource_threshold_stops_before_serving(self):
  state='Id=nginx.service\nMainPID=42\nActiveState=active'
  original=pathlib.Path.read_text
  for available,oom,pressure in [(200000,0,0),(400000,1,0),(400000,0,2)]:
   def read(path,*a,**k):
    text=str(path)
    if text.endswith('baseline.json'):return json.dumps({'oomKills':0,'services':state,'listeners':''})
    if text=='/proc/meminfo':return f'MemAvailable: {available} kB\n'
    if text=='/proc/vmstat':return f'oom_kill {oom}\n'
    if text=='/proc/pressure/memory':return f'some avg10=0.00\nfull avg10={pressure}\n'
    return original(path,*a,**k)
   with patch.object(pathlib.Path,'read_text',read),patch.object(m,'output',return_value=state):
    with self.assertRaises(RuntimeError):m.resources_ok()

if __name__=='__main__':unittest.main()
