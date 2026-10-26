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
        self.assertIn('location /assets/ { try_files $uri =404; expires 1y; }', self.app)
        self.assertIn('location / { try_files $uri =404; }', self.app)
    def test_trailing_slashes_remain_inside_the_app(self):
        for path in ('demo', 'embed'):
            self.assertIn(f'location = /{path}/ {{ expires -1; return 308 /{path}$is_args$args; }}', self.app)

if __name__ == '__main__': unittest.main()
