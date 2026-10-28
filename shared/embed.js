import { z } from 'zod';
import { NavigationTargetSchema } from './journey.js';

// postMessage protocol between the host website (mock-site) and NAVI running in an iframe.
// Both sides must check event.origin against an explicit allow-list AND event.source against
// the expected window before trusting a message. Allowed origins come from environment variables.

export const EMBED_PROTOCOL_VERSION = 1;

const NavigationId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const HostMessageSchema = z.discriminatedUnion('type', [
  z.object({ source: z.literal('navi-host'), version: z.literal(EMBED_PROTOCOL_VERSION), type: z.literal('host:hello') }).strict(),
  // The host's answer to navi:navigate with the same id: whether the place was found and marked on the page.
  z.object({ source: z.literal('navi-host'), version: z.literal(EMBED_PROTOCOL_VERSION), type: z.literal('host:navigated'), id: NavigationId, status: z.enum(['found', 'missing']) }).strict(),
]);

export const NaviMessageSchema = z.discriminatedUnion('type', [
  z.object({ source: z.literal('navi'), version: z.literal(EMBED_PROTOCOL_VERSION), type: z.literal('navi:ready') }).strict(),
  z.object({ source: z.literal('navi'), version: z.literal(EMBED_PROTOCOL_VERSION), type: z.literal('navi:close') }).strict(),
  z.object({ source: z.literal('navi'), version: z.literal(EMBED_PROTOCOL_VERSION), type: z.literal('navi:navigate'), destination: NavigationTargetSchema, id: NavigationId.optional() }).strict(),
]);

/** "https://a.example, http://127.0.0.1:3000" → normalised origins; invalid entries are dropped. */
export function parseAllowedOrigins(value) {
  return String(value ?? '').split(',').map(entry => entry.trim()).filter(Boolean).flatMap(entry => {
    try {
      const url = new URL(entry);
      return ['http:', 'https:'].includes(url.protocol) && url.origin === entry.replace(/\/$/, '') ? [url.origin] : [];
    } catch { return []; }
  });
}

export function originOf(url) {
  try { const { origin } = new URL(url); return origin === 'null' ? null : origin; } catch { return null; }
}

/** Exact match only — no wildcards, no "null" origin. */
export function isAllowedOrigin(origin, allowed) {
  return typeof origin === 'string' && origin !== 'null' && allowed.includes(origin);
}

/** Validate an incoming MessageEvent. Returns the parsed message or null. */
export function readMessage(event, { allowedOrigins, expectedSource, schema }) {
  if (!isAllowedOrigin(event.origin, allowedOrigins)) return null;
  if (!expectedSource || event.source !== expectedSource) return null;
  const result = schema.safeParse(event.data);
  return result.success ? result.data : null;
}

export const naviMessage = (type, extra = {}) => ({ source: 'navi', version: EMBED_PROTOCOL_VERSION, type, ...extra });
export const hostMessage = (type, extra = {}) => ({ source: 'navi-host', version: EMBED_PROTOCOL_VERSION, type, ...extra });
