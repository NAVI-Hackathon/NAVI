import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('builder',pathlib.Path(__file__).with_name('build-artifact.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class OriginTests(unittest.TestCase):
 def test_exact_origins_only(self):
  for value in ['http://207.148.113.119:8080','https://navi.example.com']:self.assertEqual(m.origin(value),value)
  for value in ['javascript:alert(1)','https://name:secret@example.com','https://example.com/path','https://example.com?q=1','https://example.com#x','http://']:
   with self.assertRaises(ValueError):m.origin(value)
if __name__=='__main__':unittest.main()
