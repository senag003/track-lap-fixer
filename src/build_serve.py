"""Build Track Lap Fixer.
usage: build_serve.py <artifact.html> [--pwa <dir>] [--serve <port> <root>]
The artifact build is one self-contained page. The PWA build writes index.html, manifest, service worker
(icons are made separately) into <dir>, plus the sources in <dir>/src."""
import sys, os, http.server, shutil, datetime
s = os.path.dirname(os.path.abspath(__file__))
rd = lambda n: open(os.path.join(s, n), encoding='utf-8').read()
args = sys.argv[1:]

def page(pwa):
    html = rd('template.html')
    html = html.replace('/*I18N*/', rd('i18n.js')).replace('/*ENGINE*/', rd('engine.js')).replace('/*APP*/', rd('app.js'))
    html = html.replace('__SAMPLE_B64__', open(os.path.join(s, 'sample.b64')).read().strip())
    html = html.replace('__BUILD__', datetime.datetime.now().strftime('%Y-%m-%d %H:%M'))
    head = ('<link rel="manifest" href="manifest.webmanifest">\n<meta name="theme-color" content="#0f1b36">\n'
            '<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n'
            '<meta name="apple-mobile-web-app-status-bar-style" content="black">\n<meta name="apple-mobile-web-app-title" content="Lap Fixer">\n'
            '<link rel="apple-touch-icon" href="icon-180.png">\n') if pwa else ''
    html = html.replace('<!--PWA_HEAD-->', head)
    if pwa:
        html = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n'
                '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
                '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
                'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>\n'
                '</head><body>\n' + html + '\n</body></html>\n')
    return html

dest = args[0]
open(dest, 'w', encoding='utf-8', newline='\n').write(page(False))
print('built', dest)
if '--pwa' in args:
    d = args[args.index('--pwa') + 1]
    os.makedirs(os.path.join(d, 'src'), exist_ok=True)
    open(os.path.join(d, 'index.html'), 'w', encoding='utf-8', newline='\n').write(page(True))
    for f in ('manifest.webmanifest', 'sw.js'):
        shutil.copy(os.path.join(s, 'pwa', f), os.path.join(d, f))
    for f in ('template.html', 'i18n.js', 'engine.js', 'app.js', 'sample.b64', 'build_serve.py'):
        shutil.copy(os.path.join(s, f), os.path.join(d, 'src', f))
    print('pwa', d)
if '--serve' in args:
    i = args.index('--serve'); port = int(args[i + 1]); root = os.path.abspath(args[i + 2])
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=root, **k)
        def do_PUT(self):
            n = int(self.headers['Content-Length']); name = os.path.basename(self.path) or 'out.bin'
            open(os.path.join(root, name), 'wb').write(self.rfile.read(n))
            self.send_response(200); self.end_headers()
    http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
