// Use as the existing Adrift Ollama provider's fetchImpl when its baseUrl is the shared broker.
// Adrift's public /v1 routes, client credentials, schemas and subject cancellation remain in its gateway.
const origin = 'http://127.0.0.1:11437';
const paths = new Set(['/api/version', '/api/show', '/api/ps', '/api/chat', '/api/generate']);

export function adriftBrokerFetch(token, send = fetch) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error('Invalid Adrift broker credential');
  return (value, options = {}) => {
    const url = new URL(value);
    if (url.origin !== origin || url.username || url.password || url.hash || url.search || !paths.has(url.pathname)) {
      throw new Error('Unexpected Adrift broker destination');
    }
    const headers = new Headers(options.headers);
    headers.set('Authorization', 'Bearer ' + token);
    return send(url, { ...options, headers, redirect: 'error' });
  };
}
