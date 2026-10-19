#!/usr/bin/env python3
"""Verify an artifact, install Linux-only API deps under limits, then seal a release."""
import importlib.util, pathlib, json, hashlib, re, tarfile, time, os, subprocess, sys
spec=importlib.util.spec_from_file_location('manager',pathlib.Path(__file__).with_name('manage-navi.py'));manager=importlib.util.module_from_spec(spec);spec.loader.exec_module(manager)
ROOT=manager.ROOT

def install(artifact,checksum):
    m=manager.load();manager.resources_ok();manager.setup(m)
    artifact=manager.inside(artifact)
    if artifact.parent!=ROOT/'runtime/incoming' or not re.fullmatch(r'[a-f0-9]{64}',checksum):raise RuntimeError('Use a checksum-verified NAVI incoming artifact')
    if hashlib.sha256(artifact.read_bytes()).hexdigest()!=checksum:raise RuntimeError('Artifact checksum mismatch')
    if manager.output([str(manager.NODE),'--version'])!=m['nodeVersion']:raise RuntimeError('Unexpected private Node version')
    with tarfile.open(artifact) as archive:
        members=archive.getmembers();names=set()
        for item in members:
            name=pathlib.PurePosixPath(item.name)
            if name.is_absolute() or '..' in name.parts or item.name in names or not (item.isfile() or item.isdir()):raise RuntimeError('Unsafe archive member')
            names.add(item.name)
        metadata=json.loads(archive.extractfile('release.json').read())
        sha=metadata['sourceCommit']
        if not re.fullmatch('[a-f0-9]{40}',sha):raise RuntimeError('Invalid artifact revision')
        target=ROOT/'releases'/f'{sha[:12]}-{int(time.time())}';target.mkdir(mode=0o750)
        # Ubuntu Python 3.10 lacks tarfile's data filter; every member was checked above.
        archive.extractall(target)
    m.setdefault('releases',[]).append(str(target));manager.save(m)
    for parent,dirs,files in os.walk(target):
        for p in [pathlib.Path(parent)]+[pathlib.Path(parent)/f for f in dirs+files]:
            os.chown(p,m['account']['uid'],m['account']['gid']);os.chmod(p,0o750 if p.is_dir() else 0o640)
    command=['systemd-run','--quiet','--wait','--pipe','--collect','--unit',manager.UNITS['install'],'-p',f"Description={manager.description(m,'install')}",'-p',f'Slice={manager.SLICE}',
        '-p','User=navi-hackathon','-p','Group=navi-hackathon','-p','NoNewPrivileges=yes','-p','MemoryMax=160M','-p','MemorySwapMax=0','-p','Nice=15','-p',f'WorkingDirectory={target}',
        '--setenv=PATH='+str(ROOT/'runtime/node/bin')+':/usr/bin:/bin','--setenv=HOME='+str(ROOT/'run/tmp'),'--setenv=TMPDIR='+str(ROOT/'run/tmp'),'--setenv=NPM_CONFIG_CACHE='+str(ROOT/'run/npm-cache'),
        str(manager.NODE),'--max-old-space-size=64',str(ROOT/'runtime/node/lib/node_modules/npm/bin/npm-cli.js'),'ci','--workspace','@navi/api','--include-workspace-root','--omit=dev','--ignore-scripts','--no-audit','--no-fund']
    if 'install' not in m['units']:m['units'].append('install');manager.save(m)
    with (ROOT/'logs/install.log').open('a') as log:
        process=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT)
        try:
            while process.poll() is None:manager.resources_ok();time.sleep(1)
            if process.returncode:raise RuntimeError('API dependency installation failed; see NAVI install log')
            manager.resources_ok()
        except BaseException:
            manager.stop(m,('install',));raise
    if list(target.rglob('*.node')) or (target/'node_modules/next').exists():raise RuntimeError('Unexpected native or Next runtime dependency')
    for parent,dirs,files in os.walk(target,followlinks=False):
        for p in [pathlib.Path(parent)]+[pathlib.Path(parent)/f for f in dirs+files]:
            if p.is_symlink():manager.inside(p);continue
            os.chown(p,0,m['account']['gid']);os.chmod(p,0o750 if p.is_dir() else 0o640)
    manager.write_json(target/'release-ready.json',{'sourceCommit':sha,'artifactSha256':checksum,'nodeVersion':m['nodeVersion'],'apiDependencies':'npm ci on Ubuntu x64; no native modules'})
    if not (ROOT/'current').exists():(ROOT/'current').symlink_to(target)
    m['state']='release-ready';m['lastRelease']=str(target);manager.save(m)
    print(json.dumps({'release':str(target),'sourceCommit':sha,'artifactSha256':checksum}))
if __name__=='__main__':
    if len(sys.argv)!=3:raise SystemExit('Usage: deploy-navi.sh /opt/navi-hackathon/runtime/incoming/ARTIFACT SHA256')
    install(sys.argv[1],sys.argv[2])
