"""Bounded, offline image decoding. Never emits image content or metadata."""
import io, sys, warnings
try:
    if sys.platform == 'linux':
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (384*1024**2,384*1024**2))
        resource.setrlimit(resource.RLIMIT_CPU, (3,3))
    from PIL import Image
    Image.MAX_IMAGE_PIXELS=16000000
    warnings.simplefilter('error',Image.DecompressionBombWarning)
    data=sys.stdin.buffer.read(10*1024**2+1)
    if len(data)>10*1024**2: raise ValueError()
    image=Image.open(io.BytesIO(data))
    if image.format not in {'image/png':'PNG','image/jpeg':'JPEG','image/webp':'WEBP'}[sys.argv[1:][0]].split(): raise ValueError()
    if getattr(image,'n_frames',1)!=1: raise ValueError()
    image.verify()
    image=Image.open(io.BytesIO(data));image.load();image.close()
except Exception:
    sys.exit(1)
print('ok')
