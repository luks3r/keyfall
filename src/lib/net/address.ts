/** Room server addresses: what people type or paste, and what browsers will connect to. Pure, so tests can reach it. */

export const DEFAULT_PORT = 7777

/**
 * Accepts `host`, `host:port`, `http(s)://…` or `ws(s)://…` and returns the socket URL. A bare host from a page
 * served over HTTPS is taken to sit behind TLS too (browsers refuse plain `ws:` there).
 */
export function socketUrl(server: string, secure = typeof location !== 'undefined' && location.protocol === 'https:') {
  const trimmed = server.trim().replace(/\/+$/, '')
  const bare = secure ? `https://${trimmed}` : `http://${trimmed.includes(':') ? trimmed : `${trimmed}:${DEFAULT_PORT}`}`
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : bare
  const url = new URL(withScheme)
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:'
  url.pathname = '/ws'
  return url.toString()
}

/**
 * What people paste as a server: a bare host, a URL, or a whole invite link. An invite gives its `?server=`,
 * other URLs their scheme and host; anything else is kept, minus spaces and trailing slashes.
 */
export function cleanAddress(address: string) {
  const trimmed = address.trim()
  try {
    const url = new URL(trimmed)
    const linked = url.searchParams.get('server')
    if (linked) return linked
    if (/^(https?|wss?):$/.test(url.protocol)) return `${url.protocol}//${url.host}`
  } catch {}
  return trimmed.replace(/\/+$/, '')
}

/** Why `server` can't be used from a page loaded over `pageProtocol`, in words a player understands. */
export function serverProblem(server: string, pageProtocol: string, wrongVersion = false) {
  if (pageProtocol === 'https:' && /^(ws|http):\/\//i.test(server.trim()))
    return 'This page is secure, so the server needs a secure address (starting with wss:// or https://).'
  if (wrongVersion) return 'This server runs a different version of Keyfall.'
  return "Can't reach it. Check the address, or the server may be off."
}
