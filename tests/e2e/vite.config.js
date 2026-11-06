import { mergeConfig } from 'vite';
import webConfig from '../../apps/web/vite.config.js';

const browserCookie = 'navi-loopback-test';
const apiCookie = '__Host-navi-test';

// This HTTP-only loopback fixture forwards multipart bytes intact. Production cookies remain Secure.
export default mergeConfig(webConfig, { server: { proxy: { '/api': {
  target: 'http://127.0.0.1:4188',
  configure(proxy) {
    proxy.on('proxyRes', response => {
      const cookies = response.headers['set-cookie'];
      if (cookies) response.headers['set-cookie'] = cookies.map(value => value.startsWith(apiCookie + '=')
        ? value.replace(apiCookie + '=', browserCookie + '=').replace(/;\s*Secure(?=;|$)/i, '') : value);
    });
    proxy.on('proxyReq', (request, incoming) => {
      if (incoming.headers.cookie) request.setHeader('Cookie', incoming.headers.cookie
        .split(';').map(part => part.trim().replace(new RegExp('^' + browserCookie + '='), apiCookie + '=')).join('; '));
    });
  },
} } } });
