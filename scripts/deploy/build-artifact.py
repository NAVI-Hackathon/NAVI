#!/usr/bin/env python3
"""Build platform-independent UI assets off-VPS; never package local node_modules."""
import argparse, hashlib, json, os, pathlib, platform, re, shutil, subprocess, tarfile
from urllib.parse import urlsplit

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent

def run(args, cwd, env):
    subprocess.run(args, cwd=cwd, env=env, check=True)

def origin(value):
    url = urlsplit(value)
    if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.path or url.query or url.fragment:
        raise ValueError('Use an exact HTTP(S) origin without credentials or path')
    return value

def build(revision, output, web_origin='http://127.0.0.1:18171', mock_origin='http://127.0.0.1:18173'):
    web_origin, mock_origin = origin(web_origin), origin(mock_origin)
    sha = subprocess.check_output(['git', 'rev-parse', revision + '^{commit}'], cwd=REPO, text=True).strip()
    if not re.fullmatch(r'[a-f0-9]{40}', sha): raise ValueError('Invalid revision')
    output = pathlib.Path(output).resolve()
    if output.exists(): raise ValueError('Output directory must not exist')
    output.mkdir(parents=True, mode=0o700)
    archive = output / 'source.tar'
    with archive.open('wb') as f: subprocess.run(['git', 'archive', sha], cwd=REPO, stdout=f, check=True)
    source = output / 'source'; source.mkdir()
    with tarfile.open(archive) as f: f.extractall(source, filter='data')
    config = source / 'apps/mock-site/next.config.ts'
    text = config.read_text()
    needle = 'const nextConfig: NextConfig = {'
    if text.count(needle) != 1: raise ValueError('Review new Next config before applying export overlay')
    config.write_text(text.replace(needle, needle + '\n  output: "export",'))
    env = {k:v for k,v in os.environ.items() if not k.startswith(('GEMINI_', 'OPENAI_', 'VITE_', 'NEXT_PUBLIC_'))}
    env.update({'CI':'true', 'NEXT_TELEMETRY_DISABLED':'1', 'AI_MODE':'demo', 'ALLOW_PAID_AI':'false',
        'VITE_API_BASE_URL':'', 'VITE_EMBED_ALLOWED_ORIGINS':mock_origin,
        'VITE_MOCK_SITE_URL':mock_origin, 'NEXT_PUBLIC_NAVI_EMBED_URL':web_origin+'/embed'})
    run(['npm','ci','--no-audit','--no-fund'], source, env)
    run(['npm','run','build:all'], source, env)
    run(['node','scripts/security/public-artifacts.js','apps/web/dist','apps/mock-site/out'], source, env)
    payload = output / 'payload'; payload.mkdir()
    for name, source_path in [('web','apps/web/dist'), ('mock','apps/mock-site/out')]: shutil.copytree(source/source_path, payload/name)
    if not (payload/'mock/services/claims.html').is_file(): raise ValueError('Missing exported claims page')
    for name in ['shared','knowledge','apps/api/src']:
        shutil.copytree(source/name, payload/name)
    (payload/'data').mkdir()
    for data_file in ['cardif_seed_data.json', 'cardif_public_data.json']:
        shutil.copy2(source/'data'/data_file, payload/'data'/data_file)
    for name in ['package.json','package-lock.json','apps/api/package.json','apps/web/package.json','apps/mock-site/package.json']:
        target=payload/name; target.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(source/name,target)
    run(['node', 'scripts/evidence/navigation-audit.js', 'apps/mock-site/out', str(payload/'data/navigation-targets.json')], source, env)
    shutil.copy2(HERE/'runtime-server.mjs',payload/'runtime-server.mjs')
    metadata={'providerIsolation': (source/'apps/api/src/middleware/testSession.js').is_file(), 'schema':1,'sourceCommit':sha,'buildNode':subprocess.check_output(['node','--version'],text=True).strip(),'buildPlatform':platform.system()+'-'+platform.machine(),'buildOverlay':'next.config.ts output=export; source repo unchanged',
        'staticArtifacts':'HTML/CSS/browser JS; no native runtime modules', 'apiDependencies':'Installed on Ubuntu from root lockfile, API workspace only',
        'origins':{'web':web_origin,'mock':mock_origin},
        'toolHashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in HERE.iterdir() if p.is_file() and p.suffix in ['.py','.mjs','.sh']}}
    (payload/'release.json').write_text(json.dumps(metadata,indent=2)+'\n')
    assert not list(payload.rglob('node_modules')), 'Never ship macOS node_modules'
    artifact=output/f'navi-{sha[:12]}.tar.gz'
    with tarfile.open(artifact,'w:gz') as f:
        for p in payload.iterdir(): f.add(p,arcname=p.name)
    digest=hashlib.sha256(artifact.read_bytes()).hexdigest()
    artifact.with_suffix(artifact.suffix+'.sha256').write_text(digest+'  '+artifact.name+'\n')
    print(json.dumps({'artifact':str(artifact),'sha256':digest,'sourceCommit':sha}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--revision',required=True);p.add_argument('--output',required=True)
    p.add_argument('--web-origin',default='http://127.0.0.1:18171');p.add_argument('--mock-origin',default='http://127.0.0.1:18173')
    args=p.parse_args();build(args.revision,args.output,args.web_origin,args.mock_origin)
