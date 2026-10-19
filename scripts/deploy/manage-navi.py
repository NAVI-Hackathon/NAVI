#!/usr/bin/env python3
"""Root-only management of this deployment. Never manage unrelated units or paths."""
import argparse, hashlib, json, os, pathlib, pwd, grp, re, shutil, subprocess, sys, time
ROOT=pathlib.Path('/opt/navi-hackathon')
SLICE='navihackathon.slice'
ROLES=('api','web','mock','guard','bootstrap','install')
UNITS={r:f'navi-hackathon-{r}.service' for r in ROLES}
NODE=ROOT/'runtime/node/bin/node'

def run(args, **kw): return subprocess.run(args,check=True,text=True,**kw)
def output(args): return subprocess.check_output(args,text=True).strip()
def write_json(path,value):
    tmp=path.with_name(path.name+'.new');tmp.write_text(json.dumps(value,indent=2)+'\n');os.chmod(tmp,0o600);tmp.replace(path)
def inside(path):
    resolved=pathlib.Path(path).resolve()
    if not resolved.is_relative_to(ROOT) or resolved==ROOT: raise RuntimeError('NAVI path escape')
    return resolved

def load():
    if os.geteuid()!=0: raise RuntimeError('Run the NAVI manager as root')
    if ROOT.is_symlink() or ROOT.resolve()!=ROOT or ROOT.parent.resolve()!=ROOT.parent: raise RuntimeError('Unsafe deployment root')
    marker=ROOT/'.navi-deployment-marker'
    if marker.is_symlink() or marker.stat().st_uid!=0 or marker.stat().st_mode & 0o077: raise RuntimeError('Unsafe marker owner or mode')
    value=json.loads(marker.read_text()); m=json.loads((ROOT/'deployment-manifest.json').read_text())
    if value.get('project')!='navi-hackathon' or value.get('root')!=str(ROOT) or m.get('id')!=value.get('id'): raise RuntimeError('Invalid NAVI marker')
    if pathlib.Path(__file__).resolve()!=ROOT/'scripts/manage-navi.py': raise RuntimeError('Use the installed NAVI manager')
    return m

def save(m):write_json(ROOT/'deployment-manifest.json',m)
def props(unit):
    result=subprocess.run(['systemctl','show',unit,'-p','LoadState','-p','Description','-p','MainPID','-p','ActiveState','-p','ControlGroup'],text=True,capture_output=True)
    values=dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
    if result.returncode and values.get('LoadState')!='not-found':raise RuntimeError('Cannot inspect unit safely')
    return values
def description(m,role):return f"NAVI {m['id']} {role}"
def pid_owned(pid,m,role):
    p=pathlib.Path('/proc')/str(pid)
    uid=int(next(l for l in (p/'status').read_text().splitlines() if l.startswith('Uid:')).split()[1])
    args=(p/'cmdline').read_bytes().split(b'\0'); args=[a.decode() for a in args if a]
    if role=='guard':return uid==0 and len(args)>2 and args[1]==str(ROOT/'scripts/manage-navi.py') and args[2]=='guard'
    if role=='install':return uid==m['account']['uid'] and args and pathlib.Path(args[0]).resolve()==NODE.resolve() and str(ROOT/'runtime/node/lib/node_modules/npm/bin/npm-cli.js') in args
    if role not in ('api','web','mock'):return False
    if uid!=m['account']['uid'] or not args or pathlib.Path(args[0]).resolve()!=NODE.resolve():return False
    return any(a.startswith(str(ROOT/'releases')+'/') and a.endswith('/apps/api/src/server.js' if role=='api' else '/runtime-server.mjs') for a in args[1:])
def owned_unit(m,role):
    p=props(UNITS[role])
    if p['LoadState']=='not-found':return p
    if p['Description']!=description(m,role):raise RuntimeError(f'Refusing unowned unit {UNITS[role]}')
    pid=int(p.get('MainPID','0'))
    if pid and role in ('api','web','mock','guard','install') and not pid_owned(pid,m,role):raise RuntimeError(f'Refusing changed PID {pid}')
    return p

def service_map(text):
    return {v['Id']:v for block in text.strip().split('\n\n') if (v:=dict(l.split('=',1) for l in block.splitlines() if '=' in l)) and 'Id' in v}
def listener_map(text):
    entries=[]
    for line in text.splitlines():
        parts=line.split()
        if parts and parts[0]=='tcp' and parts[4].rsplit(':',1)[-1] in ['22','80','5000']:
            entries.append((parts[4],sorted(re.findall(r'pid=(\d+)',line))))
    return sorted(entries)

def resources_ok():
    baseline=json.loads((ROOT/'config/baseline.json').read_text())
    mem=int(next(l for l in pathlib.Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:')).split()[1])
    oom=int(next(l.split()[1] for l in pathlib.Path('/proc/vmstat').read_text().splitlines() if l.startswith('oom_kill ')))
    pressure={l.split()[0]:float(l.split()[1].split('=')[1]) for l in pathlib.Path('/proc/pressure/memory').read_text().splitlines()}
    current=service_map(output(['systemctl','show','nginx.service','pm2-root.service','ssh.service','-p','Id','-p','MainPID','-p','ActiveState']))
    if mem<250*1024 or oom>baseline['oomKills'] or pressure['full']>1 or pressure['some']>5:raise RuntimeError(f'Memory safety threshold: available={mem/1024:.1f}MiB, oomKills={oom}, PSI avg10={pressure}')
    if current!=service_map(baseline['services']) or listener_map(output(['ss','-lntup']))!=listener_map(baseline['listeners']):raise RuntimeError('Protected service/listener state/PID changed; stop NAVI')
    cg=pathlib.Path('/sys/fs/cgroup')/SLICE
    if (cg/'memory.events').exists():
        ev=dict(l.split() for l in (cg/'memory.events').read_text().splitlines())
        if any(int(ev.get(k,0)) for k in ('oom','oom_kill','max','high')):raise RuntimeError('NAVI cgroup memory pressure; stop NAVI')
    return {'memAvailableMiB':round(mem/1024,1),'oomKills':oom,'pressureAvg10':pressure,'protectedServicesUnchanged':True}

def unit(m,role,args,extra=()):
    p=owned_unit(m,role)
    if p['LoadState']!='not-found':raise RuntimeError(f'{role} already loaded; stop it first')
    command=['systemd-run','--quiet','--collect','--unit',UNITS[role],'-p',f'Description={description(m,role)}','-p',f'Slice={SLICE}']
    for prop in extra:command+=['-p',prop]
    run(command+list(args));time.sleep(.25)
    if role not in m['units']:m['units'].append(role)
    save(m)

def setup(m):
    slice_safe()
    if not m.get('sliceCreated'):
        state=dict(l.split('=',1) for l in output(['systemctl','show',SLICE,'-p','FragmentPath','-p','DropInPaths','-p','ActiveState','-p','ControlGroup']).splitlines())
        # systemd synthesizes inactive slice names on lookup; that alone is not an existing deployment.
        if state.get('FragmentPath') or state.get('DropInPaths') or state.get('ControlGroup') or state.get('ActiveState') not in ['inactive','failed']:raise RuntimeError('Slice already in use; refusing takeover')
    if props(UNITS['bootstrap'])['LoadState']=='not-found':
        unit(m,'bootstrap',['/usr/bin/true'],['RemainAfterExit=yes','User=navi-hackathon','Group=navi-hackathon','NoNewPrivileges=yes'])
    run(['systemctl','set-property','--runtime',SLICE,'MemoryMax=224M','MemoryHigh=192M','MemorySwapMax=0','CPUQuota=25%','CPUWeight=10','IOWeight=10','TasksMax=96'])
    m['sliceCreated']=True;m['runtimeSystemPaths']=[f'/run/systemd/transient/{u}' for u in UNITS.values()]+[f'/run/systemd/system.control/{SLICE}.d',f'/sys/fs/cgroup/{SLICE}'];save(m)
    cg=pathlib.Path('/sys/fs/cgroup')/SLICE
    if (cg/'memory.max').read_text().strip()!=str(224*1024**2) or (cg/'memory.swap.max').read_text().strip()!='0':raise RuntimeError('Memory cgroup limit not effective')
    quota,period=map(int,(cg/'cpu.max').read_text().split())
    if quota/period>.25:raise RuntimeError('CPU limit not effective')
    return cg

def stop(m,roles=('guard','mock','web','api','install','bootstrap')):
    for role in roles:
        p=owned_unit(m,role)
        if p['LoadState']!='not-found':run(['systemctl','stop',UNITS[role]])
    for role in roles:
        p=props(UNITS[role])
        if int(p.get('MainPID','0')):raise RuntimeError(f'{role} did not stop')
        (ROOT/'run'/f'{role}.pid.json').unlink(missing_ok=True)
    if set(roles)==set(ROLES):m['state']='stopped';save(m)

def release(path):
    path=inside(path)
    if path.parent!=ROOT/'releases' or not re.fullmatch(r'[a-f0-9]{12}-\d+',path.name) or not (path/'release-ready.json').is_file():raise RuntimeError('Unvalidated release')
    return path

def start(m,selected=None):
    if not NODE.is_file():raise RuntimeError('Private Node not installed')
    current=release(ROOT/'current')
    setup(m)
    if props(UNITS['guard'])['LoadState']=='not-found':
        unit(m,'guard',['/usr/bin/python3',str(ROOT/'scripts/manage-navi.py'),'guard'],['User=root','NoNewPrivileges=yes','MemoryMax=32M','CPUQuota=5%','OOMPolicy=stop','ProtectSystem=strict','ProtectHome=yes',f'ReadWritePaths={ROOT}/logs {ROOT}/run','StandardOutput=append:'+str(ROOT/'logs/guard.log'),'StandardError=append:'+str(ROOT/'logs/guard.log')])
    try:
        for role in ([selected] if selected else ['api','web','mock']):
            before=resources_ok();port=m['ports'][role]
            existing=owned_unit(m,role)
            if existing.get('ActiveState')=='active' and int(existing.get('MainPID','0')):
                print(json.dumps({'alreadyRunning':role,'pid':int(existing['MainPID'])}));continue
            # Do not take over any occupied port, even when a different process looks like NAVI.
            if any(l.split()[3].endswith(':'+str(port)) for l in output(['ss','-H','-ltn']).splitlines()):raise RuntimeError(f'Port {port} is occupied')
            args=[str(NODE),'--max-old-space-size='+('64' if role=='api' else '24')]
            if role=='api':args +=[str(current/'apps/api/src/server.js'),'--demo']
            else:args +=[str(current/'runtime-server.mjs'),role,str(current/role),str(port),str(m['ports']['api'])]
            extra=[f'BindsTo={UNITS["guard"]}',f'After={UNITS["guard"]}','User=navi-hackathon','Group=navi-hackathon','SupplementaryGroups=','NoNewPrivileges=yes','CapabilityBoundingSet=','ProtectSystem=strict','ProtectHome=yes','PrivateDevices=yes','ProtectKernelTunables=yes','ProtectKernelModules=yes','ProtectControlGroups=yes','RestrictSUIDSGID=yes','RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','IPAddressDeny=any','IPAddressAllow=localhost','InaccessiblePaths=/var/www /srv /opt/vultr',f'ReadWritePaths={ROOT}/run/tmp',f'WorkingDirectory={current}','MemoryMax='+('112M' if role=='api' else '64M'),'MemorySwapMax=0','OOMPolicy=stop','TasksMax=24','Nice=15','IOWeight=10','KillMode=control-group','TimeoutStopSec=8','Restart=no',f'EnvironmentFile={ROOT}/config/runtime.env','StandardOutput=append:'+str(ROOT/f'logs/{role}.log'),'StandardError=append:'+str(ROOT/f'logs/{role}.log')]
            if role=='api':extra +=[f'Environment=PORT={port}']
            unit(m,role,args,extra)
            import urllib.request
            health=f'http://127.0.0.1:{port}'+('/api/health' if role=='api' else '/__navi_health')
            for attempt in range(25):
                resources_ok()
                try:
                    with urllib.request.urlopen(health,timeout=2) as response:assert response.status==200
                    break
                except Exception:
                    if attempt==24:raise RuntimeError(f'{role} health failed')
                    time.sleep(.4)
            p=owned_unit(m,role);pid=int(p['MainPID'])
            write_json(ROOT/'run'/f'{role}.pid.json',{'pid':pid,'unit':UNITS[role],'deploymentId':m['id'],'startTime':pathlib.Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()[19]})
            print(json.dumps({'started':role,'pid':pid,'port':port,'before':before,'after':resources_ok()}))
        m['state']='running';save(m)
    except BaseException:
        stop(m);raise

def guard(m):
    try:
        while True:
            sample=resources_ok();sample['epoch']=int(time.time())
            path=ROOT/'logs/resources.jsonl'
            if path.exists() and path.stat().st_size>2*1024**2:path.replace(path.with_suffix('.previous.jsonl'))
            with path.open('a') as f:f.write(json.dumps(sample)+'\n')
            time.sleep(3)
    except BaseException as error:
        write_json(ROOT/'logs/safety-stop.json',{'epoch':int(time.time()),'reason':str(error)})
        print('NAVI safety stop: '+str(error),flush=True)
        stop(m,('mock','web','api','install'))
        raise

def tree_safe(m):
    expected={'.navi-deployment-marker','deployment-manifest.json','releases','runtime','config','logs','run','scripts','current','previous'}
    if any(p.name not in expected for p in ROOT.iterdir()):raise RuntimeError('Unexpected deployment-root files; refusing removal')
    for directory,dirs,files in os.walk(ROOT,followlinks=False):
        for name in dirs+files:
            p=pathlib.Path(directory)/name
            if p.is_symlink():inside(p)
            if p.lstat().st_uid not in [0,m['account']['uid']]:raise RuntimeError('Unexpected file owner; refusing removal')
    a=m['account']
    if not a.get('createdByNavi'):raise RuntimeError('Account was not created by NAVI')
    try:account=pwd.getpwnam(a['name'])
    except KeyError:
        if not m.get('removalStarted'):raise RuntimeError('Account missing before removal')
        account=None
        try:pwd.getpwuid(a['uid'])
        except KeyError:pass
        else:raise RuntimeError('UID reused; refusing removal')
    if account:
        if account.pw_uid!=a['uid'] or account.pw_gid!=a['gid'] or account.pw_dir!=str(ROOT) or account.pw_shell!='/usr/sbin/nologin':raise RuntimeError('Account identity changed')
        if os.getgrouplist(a['name'],a['gid'])!=[a['gid']]:raise RuntimeError('Account has other groups')
    try:group=grp.getgrgid(a['gid'])
    except KeyError:
        if not m.get('removalStarted'):raise RuntimeError('Group missing before removal')
        group=None
    if (group and (group.gr_name!=a['name'] or group.gr_mem)) or any(p.pw_gid==a['gid'] and p.pw_uid!=a['uid'] for p in pwd.getpwall()):raise RuntimeError('Other group dependencies')
    owned={int(props(UNITS[r]).get('MainPID','0')) for r in ('api','web','mock','install')}
    pids=output(['ps','-u',str(a['uid']),'-o','pid=']).split() if subprocess.run(['pgrep','-u',str(a['uid'])],stdout=subprocess.DEVNULL).returncode==0 else []
    if any(int(pid) not in owned for pid in pids):raise RuntimeError('Unexpected account process dependency')
    # Metadata-only scan on the root filesystem; never read other projects' contents.
    outside=output(['nice','-n','19','ionice','-c','3','find','/','-xdev','-path',str(ROOT),'-prune','-o','(','-uid',str(a['uid']),'-o','-gid',str(a['gid']),')','-print','-quit'])
    if outside:raise RuntimeError('Account has files outside NAVI: '+outside)

def slice_safe():
    state=dict(l.split('=',1) for l in output(['systemctl','show',SLICE,'-p','FragmentPath','-p','DropInPaths']).splitlines())
    if state.get('FragmentPath'):raise RuntimeError('Foreign slice configuration; refusing change')
    allowed=pathlib.Path('/run/systemd/system.control')/(SLICE+'.d')
    names={f'50-{name}.conf' for name in ['MemoryMax','MemoryHigh','MemorySwapMax','CPUQuota','CPUWeight','IOWeight','TasksMax']}
    if any(pathlib.Path(p).parent!=allowed or pathlib.Path(p).name not in names for p in state.get('DropInPaths','').split()):raise RuntimeError('Foreign slice drop-in; refusing change')

def remove(m,confirm):
    for r in m['units']:owned_unit(m,r)
    tree_safe(m);slice_safe()
    print(json.dumps({'dryRun':not confirm,'root':str(ROOT),'account':m['account'],'units':{r:props(UNITS[r]).get('MainPID') for r in m['units']},'runtimeSystemPaths':m['runtimeSystemPaths']}))
    if not confirm:return
    stop(m);tree_safe(m);slice_safe()
    # Remove only this slice's runtime resource configuration, never another unit's files.
    if m.get('sliceCreated'):
        run(['systemctl','stop',SLICE]);run(['systemctl','revert',SLICE])
    for port in m['ports'].values():
        if any(l.split()[3].endswith(':'+str(port)) for l in output(['ss','-H','-ltn']).splitlines()):raise RuntimeError('NAVI port not released; removal stopped')
    # Historical host health counters must not prevent reclaiming stopped NAVI resources.
    m['removalStarted']=True;save(m)
    try:pwd.getpwnam(m['account']['name'])
    except KeyError:pass
    else:run(['userdel',m['account']['name']])
    try:
        g=grp.getgrnam(m['account']['name'])
        if g.gr_gid!=m['account']['gid'] or g.gr_mem:raise RuntimeError('Group changed; removal stopped')
        run(['groupdel',g.gr_name])
    except KeyError:pass
    shutil.rmtree(ROOT)
    print('NAVI files and account removed. System audit journals are deliberately retained.')

def activate(m,target):
    target=release(target);old=release(ROOT/'current') if (ROOT/'current').exists() else None
    stop(m)
    if old:
        temp=ROOT/'previous.new';temp.symlink_to(old);temp.replace(ROOT/'previous')
    temp=ROOT/'current.new';temp.symlink_to(target);temp.replace(ROOT/'current')
    try:start(m)
    except BaseException:
        if old:
            temp=ROOT/'current.new';temp.symlink_to(old);temp.replace(ROOT/'current');start(m)
        raise

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['setup-limits','start','stop','status','guard','activate','rollback','remove']);parser.add_argument('target',nargs='?');parser.add_argument('--confirm',action='store_true');args=parser.parse_args()
    if not ROOT.exists() and args.action=='remove':print('NAVI root absent; no files or accounts touched.');return
    m=load()
    if args.action=='setup-limits':print(str(setup(m)))
    elif args.action=='start':start(m,args.target)
    elif args.action=='stop':stop(m)
    elif args.action=='guard':guard(m)
    elif args.action=='status':
        try:resources=resources_ok()
        except RuntimeError as error:resources={'safetyWarning':str(error)}
        print(json.dumps({'deploymentState':m['state'],'resources':resources,'services':{r:owned_unit(m,r) for r in ['api','web','mock','guard']},'slice':props(SLICE)},indent=2))
    elif args.action=='activate':activate(m,args.target)
    elif args.action=='rollback':activate(m,ROOT/'previous')
    elif args.action=='remove':remove(m,args.confirm)

if __name__=='__main__':
    try:main()
    except Exception as error:print('NAVI operation stopped safely: '+str(error),file=sys.stderr);sys.exit(1)
