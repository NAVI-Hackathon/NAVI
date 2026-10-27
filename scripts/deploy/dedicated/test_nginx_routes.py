import pathlib, unittest

class PublicRoutes(unittest.TestCase):
    def setUp(self):
        text = pathlib.Path(__file__).with_name('nginx-domains.conf').read_text()
        self.mock = text.split('server_name navitw.com;', 1)[1].split('\nserver {', 1)[0]
        self.app = text.split('server_name app.navitw.com;', 1)[1]
    def test_mock_demo_has_fixed_same_site_destination(self):
        for path in ('/demo', '/demo/'):
            self.assertIn(f'location = {path} {{ expires -1; return 308 https://navitw.com/?navi=demo; }}', self.mock)
        self.assertNotIn('$arg_', self.mock)
    def test_app_demo_still_serves_the_spa_and_assets_do_not_fall_back(self):
        self.assertIn('location = /demo { expires -1; try_files /index.html =404; }', self.app)
        assets = self.app.split('location /assets/ {', 1)[1].split('}', 1)[0]
        self.assertIn('try_files $uri =404; expires 1y;', assets)
        self.assertIn('location / { try_files $uri =404; }', self.app)
    def test_trailing_slashes_remain_inside_the_app(self):
        for path in ('demo', 'embed'):
            self.assertIn(f'location = /{path}/ {{ expires -1; return 308 /{path}$is_args$args; }}', self.app)
    def test_text_compression_is_scoped_to_public_static_assets(self):
        for text, location in [(self.app, 'location /assets/ {'), (self.mock, 'location ~ ^/_next/static/ {')]:
            assets = text.split(location, 1)[1].split('}', 1)[0]
            self.assertIn('gzip on;', assets)
            self.assertIn('gzip_vary on;', assets)
            self.assertIn('gzip_types application/javascript text/css image/svg+xml;', assets)
            self.assertIn('try_files $uri =404; expires 1y;', assets)
        self.assertNotIn('gzip', self.app.split('location /api/ {', 1)[1])

if __name__ == '__main__': unittest.main()
