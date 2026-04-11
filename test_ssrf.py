from urllib.parse import urlparse

def test_url(url):
    try:
        parsed_url = urlparse(url)
        if parsed_url.hostname not in ['firebasestorage.googleapis.com', 'storage.googleapis.com']:
            return 'Invalid'
        return 'Valid'
    except Exception:
        return 'Invalid'

print("Test 1:", test_url('https://firebasestorage.googleapis.com/v0/b/test/pdf'))
print("Test 2:", test_url('http://192.168.1.1?q=firebasestorage.googleapis.com'))
print("Test 3:", test_url('https://my-malware.com/payload?firebasestorage.googleapis.com'))
