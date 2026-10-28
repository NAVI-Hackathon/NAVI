"""Actual local Node/Express/Mongo processes; systemctl/nginx are explicitly simulated."""
import importlib.util,json,os,pathlib,secrets,socket,subprocess,tempfile,time,unittest,urllib.request
from unittest.mock import patch
HERE=pathlib.Path(__file__).parent
spec=importlib.util.spec_from_file_location('local_manager',HERE/'manage.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
REPO=HERE.resolve().parents[2]
@unittest.skipUnless(os.environ.get('MONGODB_TEST_URI'),'Use scripts/test-mongodb.js; no Atlas')
class Recovery(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=pathlib.Path(self.temp.name).resolve();self.process=None;self.offset=0;self.starts=0;self.checked_old=False
  s=socket.socket();s.bind(('127.0.0.1',0));self.port=s.getsockname()[1];s.close()
  self.old=self.root/'releases'/('a'*12+'-1');self.new=self.root/'releases'/('b'*12+'-2')
  for p in [self.old,self.new]:p.mkdir(parents=True);(p/'ready.json').write_text('{"providerIsolation":true}')
  (self.root/'current').symlink_to(self.old);(self.root/'api-current').symlink_to(self.old);(self.root/'config').mkdir(mode=0o700);self.env=self.root/'config/api.env';self.env.write_text('NAVI_PRODUCT_MODE=true\n');self.env.chmod(0o600)
  self.candidate=self.root/'config/candidate.env';self.candidate.write_text('NAVI_PRODUCT_MODE=true\n');self.candidate.chmod(0o600);(self.root/'state').mkdir(mode=0o700)
  self.childenv={**os.environ,'NAVI_LOCAL_DB':'navi_test_deploy_'+secrets.token_hex(8),'NAVI_LOCAL_KEY':__import__('base64').b64encode(secrets.token_bytes(32)).decode(),'NAVI_LOCAL_ENV':str(self.env),'NAVI_LOCAL_STATE':str(self.root/'state'),'NAVI_LOCAL_PORT':str(self.port)}
  clock=time.time
  for p in [patch.object(m,'ROOT',self.root),patch.object(m,'API_PORT',self.port),patch.object(m,'owned_service'),patch.object(m,'host_uptime',return_value=1000000),patch.object(m,'process_release',side_effect=self.process_release),patch.object(m,'run',side_effect=self.run_command),patch.object(m,'service_state',side_effect=self.state),patch.object(m.time,'time',side_effect=lambda:clock()+self.offset)]:p.start();self.addCleanup(p.stop)
  self.addCleanup(self.stop);self.start();self.await_ready(self.old)
 def process_release(self,pid):
  with urllib.request.urlopen('http://127.0.0.1:'+str(self.port)+'/probe') as r:return pathlib.Path(json.load(r)['cwd'])
 def stop(self):
  if self.process and self.process.poll() is None:self.process.terminate();self.process.wait(timeout=10)
  if self.process:
   self.process.stdout.close();self.process=None
 def start(self):
  self.starts+=1;self.process=subprocess.Popen(['node',str(REPO/'tests/deployment/worker.mjs')],cwd=(self.root/'api-current').resolve(),env=self.childenv,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 def state(self):
  running=self.process and self.process.poll() is None
  return {'ActiveState':'active' if running else 'failed','SubState':'running' if running else 'dead','MainPID':str(self.process.pid if self.process else 0),'ExecMainStartTimestampMonotonic':'1','StartLimitIntervalUSec':'5min','StartLimitBurst':'3','WorkingDirectory':str(self.root/'api-current'),'ExecStart':str(self.root/'api-current/apps/api/src/server.js')}
 def run_command(self,args,**kw):
  if args[0]=='nginx':return
  if args[:2]==['systemctl','reload']:return
  if args[:2] in (['systemctl','restart'],['systemctl','stop']):self.stop()
  if args[:2] in (['systemctl','restart'],['systemctl','start']):self.start()
 def await_ready(self,target):
  end=time.monotonic()+7
  while True:
   try:m.healthy(target,True);return
   except Exception:
    if time.monotonic()>end:
     for endpoint in ['/api/health','/api/ready']:
      try:print(endpoint,urllib.request.urlopen('http://127.0.0.1:'+str(self.port)+endpoint).read())
      except Exception as e:print('probe failure',endpoint,str(e))
     if self.process:
      os.set_blocking(self.process.stdout.fileno(),False);print('worker',self.process.stdout.read())
     raise
    time.sleep(.05)
 def record(self,name,started):
  out=REPO/'artifacts';out.mkdir(exist_ok=True);(out/('local-recovery-'+name+'-'+str(time.time_ns())+'.json')).write_text(json.dumps({'gitSha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip(),'workingTreeDirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=REPO,text=True).strip()),'testSha256':__import__('hashlib').sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'case':name,'at':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),'elapsedMs':(time.perf_counter()-started)*1000,'passed':True,'mongo':'isolated_real_replica_set','http':'actual_Express','serviceController':'simulated_systemd_nginx','geminiRequests':0}))
 def test_success_and_explicit_rollback_with_data_persisted(self):
  # The database is shared across both actual processes, without model calls.
  started=time.perf_counter();original=m.healthy
  def marker():
   with urllib.request.urlopen('http://127.0.0.1:'+str(self.port)+'/probe') as r:return json.load(r)['marker']
  before=marker()
  def check(target=None,product=False):
   if target==self.new:self.assertEqual((self.root/'current').resolve(),self.old);self.checked_old=True
   return original(target,product)
  with patch.object(m,'healthy',side_effect=check):m.activate(self.new,self.candidate)
  self.assertTrue(self.checked_old);self.assertEqual((self.root/'current').resolve(),self.new)
  self.offset+=301;m.activate(self.root/'previous');self.assertEqual((self.root/'current').resolve(),self.old);self.await_ready(self.old);self.assertEqual(marker(),before);self.record('success-rollback',started)
 def test_failed_start_restores_old_api_and_static_pointer(self):
  self.candidate.write_text('NAVI_PRODUCT_MODE=true\nFAIL_START=true\n');started=time.perf_counter()
  with self.assertRaises(RuntimeError):m.activate(self.new,self.candidate)
  self.assertEqual((self.root/'current').resolve(),self.old);self.assertEqual((self.root/'api-current').resolve(),self.old);self.await_ready(self.old);self.assertEqual(self.starts,3);self.assertTrue(list((self.root/'config').glob('deployment-failed-*.json')));self.record('failed-start-recovered',started)
 def test_failed_readiness_does_not_switch_static_and_recovers(self):
  self.candidate.write_text('NAVI_PRODUCT_MODE=true\nFAIL_READY=true\n');started=time.perf_counter();original=m.wait_healthy
  def check(target,product=False):
   if target==self.new:
    time.sleep(1);self.assertEqual((self.root/'current').resolve(),self.old);m.healthy(target,True)
   else:original(target,product)
  with patch.object(m,'wait_healthy',side_effect=check),self.assertRaises(Exception):m.activate(self.new,self.candidate)
  self.await_ready(self.old);self.assertEqual((self.root/'current').resolve(),self.old);self.record('failed-ready-recovered',started)
 def test_repeat_activation_is_rejected_before_restart(self):
  m.activate(self.new,self.candidate);starts=self.starts
  with self.assertRaisesRegex(RuntimeError,'300-second'):m.activate(self.old)
  self.assertEqual(self.starts,starts);self.assertEqual((self.root/'current').resolve(),self.new)
if __name__=='__main__':unittest.main()
