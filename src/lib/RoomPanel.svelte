<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import SoftKeys, { type SoftKey } from './device/SoftKeys.svelte'
  import { bars, lobby, type ServerState } from './net/lobby.svelte'
  import { ERROR_TEXT } from './net/protocol'
  import type { Room, RoomInfo } from './net/room.svelte'
  import { isNative, platform, type NearbyHost } from './platform'
  import type { Player } from './player.svelte'
  import Button from './ui/Button.svelte'
  import Icon from './ui/Icon.svelte'
  import Qr from './ui/Qr.svelte'
  import Select, { type Option } from './ui/Select.svelte'
  import { focusOnMount } from './ui/focus'

  /**
   * Playing together, in words a child can follow. Three screens before joining:
   *   Lobby   — "Got a code?" and every open room on every server, one tap to join.
   *   New     — a room name and "who can join"; everything else is tucked away.
   *   Servers — the list (like a game's server list): tap to use, × to remove, paste an address to add.
   * Inside a room: the code big enough to read aloud, the invite, and who's playing.
   */
  let { room, player, initialCode = '' }: { room: Room; player: Player; initialCode?: string } = $props()

  type View = 'lobby' | 'new' | 'servers'
  const PAGE = ''
  const CODE_LENGTH = 5
  const SPECTATOR = ''
  const COPIED_MS = 1500
  const UNKNOWN_PING = 1e9
  const FROM = { site: 'this site', device: 'this device', nearby: 'nearby', mine: '' }
  const field = 'h-11 w-full rounded-xl bg-raised px-3 text-base outline-none focus:ring-2 focus:ring-accent'

  let view = $state<View>('lobby')
  let code = $state(untrack(() => initialCode.toUpperCase()))
  let invited = $state(untrack(() => !!initialCode))
  let pin = $state('')
  let pinFor = $state<{ code: string; server: string } | null>(null)
  /** Rooms a typed code matched, shown before joining: one to confirm, or several to pick from. */
  let matches = $state.raw<{ server: string; info: RoomInfo }[] | null>(null)
  let searching = $state(false)
  /** Why a typed code went nowhere. */
  let notice = $state('')
  let naming = $state(false)
  let address = $state('')
  let added = $state('')
  let removing = $state<string | null>(null)
  let nearby = $state.raw<NearbyHost[]>([])
  let hostError = $state('')
  let copied = $state(false)
  let options = $state({ name: '', public: true, pin: '', maxPlayers: '', more: false })

  const connected = $derived(room.status === 'connected' || room.status === 'reconnecting')
  const busy = $derived(room.status === 'connecting')
  const hostingAddress = $derived(room.hosting ? `127.0.0.1:${room.hosting.port}` : null)

  /** Every server this player can reach, with where it came from (only their own can be removed). */
  const known = $derived.by(() => {
    const entries: { server: string; from: keyof typeof FROM }[] = [
      ...(isNative || room.configured.length ? [] : [{ server: PAGE, from: 'site' as const }]),
      ...room.configured.map((server) => ({ server, from: 'site' as const })),
      ...(hostingAddress ? [{ server: hostingAddress, from: 'device' as const }] : []),
      ...room.servers.map((server) => ({ server, from: 'mine' as const })),
      ...nearby.map((host) => ({ server: host.url, from: 'nearby' as const })),
    ]
    const seen = new Set<string>()
    return entries.filter(({ server }) => !seen.has(server) && !!seen.add(server))
  })
  const statusOf = (server: string): ServerState | undefined => lobby.servers.get(server)
  const ping = (server: string) => statusOf(server)?.ping ?? UNKNOWN_PING
  const online = $derived(known.filter(({ server }) => statusOf(server)?.status === 'online'))
  /** Where new rooms go: the chosen server if it answers, else the fastest one that does. */
  const home = $derived(
    online.some(({ server }) => server === room.server) ? room.server : ([...online].sort((a, b) => ping(a.server) - ping(b.server))[0]?.server ?? room.server),
  )
  const rooms = $derived(
    online
      .flatMap(({ server }) => (statusOf(server)?.rooms ?? []).map((info) => ({ server, info })))
      // A room everyone left lingers a minute on the server for reconnects; nobody to play with, so skip it.
      .filter(({ info }) => info.players + info.spectators > 0)
      .sort((a, b) => b.info.players + b.info.spectators - a.info.players - a.info.spectators || ping(a.server) - ping(b.server)),
  )

  const where = (server: string) => (server === PAGE ? location.host : server === hostingAddress ? 'this device' : server.replace(/^[a-z]+:\/\//i, ''))
  const nameOf = (server: string) => statusOf(server)?.info?.name ?? where(server)

  onMount(() => {
    const stopWatching = lobby.watch(() => known.map((k) => k.server))
    let stopDiscovery: (() => void) | undefined
    void platform.discover?.((hosts) => (nearby = hosts)).then((stop) => (stopDiscovery = stop))
    return () => {
      stopWatching()
      stopDiscovery?.()
    }
  })

  /** A new or removed server shows up (or goes) right away instead of at the next refresh. */
  $effect(() => lobby.refresh(known.map((k) => k.server)))

  /**
   * Asks every known server whether the code is theirs, all at once, before joining anything. Codes are only
   * unique per server, so with many servers two rooms can share one: the player then picks by name. A single
   * match is shown too ("Found it"), so nobody lands in a stranger's room by a typo.
   */
  async function findCode() {
    const wanted = code.trim().toUpperCase()
    if (!wanted || busy || searching) return
    notice = ''
    room.error = ''
    searching = true
    const results = await lobby.find(wanted, known.map((k) => k.server))
    searching = false
    if (code.trim().toUpperCase() !== wanted) return
    const found = results.flatMap((r) => (r.room ? [{ server: r.server, info: r.room }] : []))
    if (found.length) return void (matches = found)
    // Servers too old to answer `find` can still be tried by joining, one after another.
    const older = results.filter((r) => r.problem === 'unsupported').map((r) => r.server)
    if (older.length) return void room.join(wanted, pin, older)
    notice = results.some((r) => r.problem === 'too_many')
      ? ERROR_TEXT.too_many
      : results.every((r) => r.problem === 'offline')
        ? 'No server answers right now. Check your connection, or open Servers.'
        : ERROR_TEXT.not_found
  }

  /** An invite names its server (or comes from this page's), so it joins there directly. */
  function joinInvite() {
    invited = false
    void room.join(code)
  }

  function joinListed(server: string, info: RoomInfo) {
    matches = null
    room.useServer(server)
    if (info.locked) {
      pin = ''
      pinFor = { code: info.code, server }
      return
    }
    void room.join(info.code)
  }

  function joinWithPin() {
    if (!pinFor) return void room.join(code, pin)
    room.useServer(pinFor.server)
    void room.join(pinFor.code, pin)
  }

  /** A typed code joins as soon as it's complete; codes are always five letters. */
  function typed(input: HTMLInputElement) {
    code = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH)
    input.value = code
    matches = null
    notice = ''
    if (code.length === CODE_LENGTH) void findCode()
  }

  function start() {
    room.useServer(home)
    void room.create({
      name: options.name.trim() || `${room.name}'s room`,
      public: options.public,
      pin: options.pin.trim(),
      maxPlayers: options.maxPlayers ? Number(options.maxPlayers) : null,
    })
    view = 'lobby'
  }

  function addServer() {
    const server = room.addServer(address)
    if (!server) return
    address = ''
    added = server
  }

  async function toggleHosting() {
    hostError = ''
    try {
      if (room.hosting) await room.stopHosting()
      else await room.startHosting()
    } catch (error) {
      hostError = String(error)
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text)
    copied = true
    setTimeout(() => (copied = false), COPIED_MS)
  }

  function dismissPin() {
    pinFor = null
    room.errorCode = null
    room.error = ''
  }

  /** Song parts become seats; "Just listen" watches without playing. */
  const seatOptions = $derived<Option[]>([{ value: SPECTATOR, label: 'Just listen' }, ...player.song.parts.map((part, i) => ({ value: String(i), label: `Play ${part}` }))])
  const seatName = (seat: number | null | undefined) => (seat == null ? 'listening' : (player.song.parts[seat] ?? `part ${seat + 1}`))

  const softKeys = $derived.by((): SoftKey[] => {
    if (connected)
      return [
        { label: copied ? 'Copied' : 'Copy invite', onclick: () => copy(room.invite), title: 'Copy the invite link' },
        { label: 'Leave', onclick: () => room.leave() },
      ]
    if (view === 'new') return [{ label: 'Start', onclick: start, disabled: busy || !online.length }, { label: 'Back', onclick: () => (view = 'lobby') }]
    if (view === 'servers') return [{ label: 'Back', onclick: () => (view = 'lobby') }]
    return [
      { label: 'Start a room', onclick: () => ((options.name = ''), (view = 'new')), disabled: !online.length, title: online.length ? 'Make your own room' : 'No server answers yet' },
      { label: `Servers · ${known.length}`, onclick: () => ((added = ''), (removing = null), (view = 'servers')) },
    ]
  })
</script>

{#snippet signal(server: string)}
  {@const level = bars(statusOf(server))}
  {@const status = statusOf(server)?.status ?? 'checking'}
  <span
    class="flex shrink-0 items-end gap-0.5"
    title={status === 'online' ? `${statusOf(server)?.ping} ms` : status === 'checking' ? 'Checking…' : "Can't reach it"}
    role="img"
    aria-label={status === 'online' ? `Signal ${level} of 3` : status === 'checking' ? 'Checking' : 'Offline'}
  >
    {#each [1, 2, 3] as bar (bar)}
      <span
        class={['w-1 rounded-sm', bar <= level ? (level === 3 ? 'bg-mint' : level === 2 ? 'bg-accent' : 'bg-danger') : 'bg-fg/15', status === 'checking' && 'animate-pulse']}
        style:height="{bar * 4 + 2}px"
      ></span>
    {/each}
  </span>
{/snippet}

{#snippet roomCard(server: string, info: RoomInfo, address = false)}
  {@const full = !!info.maxPlayers && info.players >= info.maxPlayers}
  {@const people = info.players + info.spectators}
  <button
    type="button"
    class="flex cursor-pointer items-center gap-3 rounded-xl bg-raised/60 px-3 py-3 text-left hover:bg-hover disabled:opacity-50"
    disabled={busy}
    onclick={() => joinListed(server, info)}
  >
    <span class="min-w-0 flex-1">
      <span class="block truncate text-lg font-medium">{info.name || info.code}{info.locked ? ' 🔒' : ''}</span>
      <span class="flex flex-wrap items-center gap-x-2 text-sm text-muted">
        {@render dots(people, info.maxPlayers)}
        <span>{people} {people === 1 ? 'person' : 'people'} here{full ? ' · seats full, you can listen' : ''}{info.song ? ` · ${info.song}` : ''}</span>
      </span>
      <span class="flex items-center gap-1.5 text-xs text-muted">{@render signal(server)} {nameOf(server)}{address ? ` · ${where(server)}` : ''}</span>
    </span>
    <span class="rounded-lg bg-accent px-3 py-1.5 font-medium text-bg">Join</span>
  </button>
{/snippet}

{#snippet dots(count: number, max: number | null)}
  <span class="flex gap-0.5" aria-hidden="true">
    {#each { length: Math.min(8, Math.max(count, max ?? count)) } as _, i (i)}<span class={['size-2 rounded-full', i < count ? 'bg-fg' : 'bg-fg/20']}></span>{/each}
  </span>
{/snippet}

<div class="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
  <div class="grid min-h-0 content-start gap-5 overflow-y-auto p-4">
    {#if connected}
      {#if room.status === 'reconnecting'}<p class="rounded-xl bg-danger/15 px-3 py-2">Connection dropped. Getting you back in…</p>{/if}
      {#if room.error}<p class="text-danger">{room.error}</p>{/if}

      <div class="flex flex-wrap items-center gap-4">
        <div class="min-w-0 flex-1">
          <h2 class="truncate text-2xl font-medium">{room.details?.name || 'Your room'}</h2>
          <p class="text-muted">Friends join with this code{room.details?.locked ? ' and the PIN' : ''}:</p>
          <button type="button" class="mt-1 cursor-pointer font-mono text-4xl tracking-[0.3em]" onclick={() => copy(room.invite)} title="Copy the invite link" aria-label="Room code {room.code}, copy invite">{room.code}</button>
        </div>
        <div class="w-28 shrink-0"><Qr value={room.invite} label="Invite link" /></div>
      </div>
      {#if typeof navigator.share === 'function'}
        <Button class="h-11 justify-self-start" onclick={() => navigator.share({ title: 'Play piano with me', url: room.invite })}><Icon name="users" />Send invite</Button>
      {/if}

      <section class="grid gap-2">
        <div class="flex items-center justify-between">
          <h3 class="font-mono text-[11px] tracking-wider text-muted uppercase">In the room · {room.peers.size + 1}</h3>
          {#if room.ping !== null}<span class="text-xs text-muted tabular-nums">{room.ping} ms</span>{/if}
        </div>
        <ul class="grid gap-1.5" aria-label="Players">
          <li class="flex flex-wrap items-center gap-2.5 rounded-xl bg-raised/60 px-3 py-2">
            <span class="size-3 shrink-0 rounded-full bg-accent"></span>
            <span class="min-w-0 flex-1 truncate font-medium">{room.name} (you){room.isHost ? ' · host' : ''}</span>
            <div class="w-40">
              <Select bind:value={() => (room.seat === null ? SPECTATOR : String(room.seat)), (value) => room.setSeat(value === SPECTATOR ? null : Number(value))} options={seatOptions} />
            </div>
          </li>
          {#each [...room.peers.values()] as peer (peer.id)}
            <li class="flex items-center gap-2.5 rounded-xl bg-raised/60 px-3 py-2">
              <span class="size-3 shrink-0 rounded-full" style:background={peer.color}></span>
              <span class="min-w-0 flex-1 truncate">{peer.profile?.name ?? '…'}{peer.id === room.host ? ' · host' : ''}</span>
              <span class="text-sm text-muted">{seatName(peer.profile?.seat)}</span>
              {#if room.isHost}
                <Button variant="ghost" shape="square" onclick={() => room.kick(peer.id)} title="Remove from room" aria-label="Remove {peer.profile?.name ?? 'player'}"><Icon name="close" class="size-4" /></Button>
              {/if}
            </li>
          {/each}
        </ul>
        {#if !room.isHost}<p class="text-sm text-muted">The host picks the song.</p>{/if}
      </section>
    {:else if view === 'new'}
      <h2 class="text-2xl font-medium">Start a room</h2>
      <label class="grid gap-1.5">
        <span class="text-muted">Name</span>
        <input class={field} bind:value={options.name} placeholder="{room.name}'s room" maxlength="40" />
      </label>
      <div class="grid gap-1.5" role="radiogroup" aria-label="Who can join">
        <span class="text-muted">Who can join?</span>
        <div class="grid gap-2 sm:grid-cols-2">
          {#each [{ value: true, title: 'Everyone', text: 'Your room shows up in the list.' }, { value: false, title: 'Only with the code', text: 'Hidden. Share the code with friends.' }] as choice (choice.title)}
            <button
              type="button"
              role="radio"
              aria-checked={options.public === choice.value}
              class={['cursor-pointer rounded-xl px-3 py-2.5 text-left', options.public === choice.value ? 'bg-fg text-bg' : 'bg-raised hover:bg-hover']}
              onclick={() => (options.public = choice.value)}
            >
              <span class="block font-medium">{choice.title}</span>
              <span class="block text-sm opacity-70">{choice.text}</span>
            </button>
          {/each}
        </div>
      </div>
      {#if options.more}
        <div class="grid grid-cols-2 gap-3">
          <label class="grid gap-1.5"><span class="text-muted">PIN</span><input class={[field, 'font-mono']} bind:value={options.pin} inputmode="numeric" maxlength="12" placeholder="none" /></label>
          <label class="grid gap-1.5"><span class="text-muted">Most players</span><input class={field} bind:value={options.maxPlayers} type="number" min="1" placeholder="no limit" /></label>
        </div>
        {#if online.length > 1}
          <label class="grid gap-1.5">
            <span class="text-muted">Server</span>
            <Select bind:value={() => home, (value) => room.useServer(value)} options={online.map(({ server }) => ({ value: server, label: `${nameOf(server)} · ${statusOf(server)?.ping} ms` }))} />
          </label>
        {/if}
      {:else}
        <button type="button" class="cursor-pointer justify-self-start text-sm text-muted underline underline-offset-4" onclick={() => (options.more = true)}>More options: PIN, player limit, server</button>
      {/if}
      <Button variant="accent" class="h-12 text-base" disabled={busy || !online.length} onclick={start}>Start room{online.length > 1 ? ` on ${nameOf(home)}` : ''}</Button>
      {#if room.error}<p class="text-danger">{room.error}</p>{/if}
    {:else if view === 'servers'}
      <div>
        <h2 class="text-2xl font-medium">Servers</h2>
        <p class="text-muted">Rooms live on servers. Tap one to start new rooms there.</p>
      </div>
      <ul class="grid gap-1.5" aria-label="Servers">
        {#each known as { server, from } (server)}
          {@const info = statusOf(server)}
          {@const chosen = server === home}
          <li class={['flex items-center gap-3 rounded-xl px-3 py-2.5', chosen ? 'bg-fg text-bg' : 'bg-raised/60']}>
            <button type="button" class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left" onclick={() => room.useServer(server)} aria-current={chosen}>
              {@render signal(server)}
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{nameOf(server)}</span>
                <span class="block truncate text-sm opacity-70">
                  {#if info?.status === 'offline'}{info.problem}{:else}{where(server)}{FROM[from] ? ` · ${FROM[from]}` : ''}{info?.status === 'online' ? ` · ${info.rooms.length} room${info.rooms.length === 1 ? '' : 's'}` : ''}{chosen ? ' · new rooms go here' : ''}{/if}
                </span>
              </span>
            </button>
            {#if from === 'mine'}
              {#if removing === server}
                <Button variant="danger" onclick={() => ((removing = null), room.removeServer(server))}>Remove</Button>
              {:else}
                <Button variant="ghost" shape="square" onclick={() => (removing = server)} title="Remove this server" aria-label="Remove {nameOf(server)}"><Icon name="close" class="size-4" /></Button>
              {/if}
            {/if}
          </li>
        {:else}
          <li class="text-muted">No servers yet. Add one below.</li>
        {/each}
      </ul>
      <form class="grid gap-1.5" onsubmit={(e) => (e.preventDefault(), addServer())}>
        <span class="text-muted">Add a server</span>
        <div class="flex gap-2">
          <input class={[field, 'flex-1']} bind:value={address} placeholder="Address or invite link" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" aria-label="Server address" />
          <Button type="submit" variant="accent" class="h-11" disabled={!address.trim()}>Add</Button>
        </div>
        {#if added}
          {@const info = statusOf(added)}
          <p class={info?.status === 'offline' ? 'text-danger' : 'text-muted'} role="status">
            {info?.status === 'online' ? `Added ${nameOf(added)}. Its rooms are in the list now.` : info?.status === 'offline' ? info.problem : 'Checking…'}
          </p>
        {/if}
      </form>
      {#if platform.host}
        <section class="grid gap-2 rounded-xl bg-raised/60 p-3">
          <div class="flex items-center justify-between gap-3">
            <span class="font-medium">Be a server for your Wi-Fi</span>
            <Button variant={room.hosting ? 'danger' : 'accent'} onclick={toggleHosting}>{room.hosting ? 'Stop' : 'Start'}</Button>
          </div>
          {#if room.hosting}
            <p class="text-sm text-muted">People on your Wi-Fi scan this or open <span class="text-fg">{room.hosting.urls[0] ?? `port ${room.hosting.port}`}</span>.</p>
            {#if room.hosting.urls[0]}<div class="w-28"><Qr value={room.hosting.urls[0]} label="Server address" /></div>{/if}
          {:else}
            <p class="text-sm text-muted">This device hosts one room. Phones and browsers join with nothing to install.</p>
          {/if}
          {#if hostError}<p class="text-sm text-danger">{hostError}</p>{/if}
        </section>
      {/if}
    {:else}
      <div class="flex items-center gap-2 text-lg">
        {#if naming}
          <span class="text-muted">I'm</span>
          <input
            class={[field, 'h-9 max-w-56']}
            bind:value={room.name}
            maxlength="24"
            autocomplete="nickname"
            aria-label="Your name"
            use:focusOnMount
            onblur={() => (naming = false)}
            onkeydown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (naming = false)}
          />
        {:else}
          <span class="text-muted">Hi,</span>
          <button type="button" class="cursor-pointer rounded-lg px-1 font-medium underline decoration-fg/30 decoration-dotted underline-offset-4 hover:bg-raised" onclick={() => (naming = true)} title="Change your name">{room.name}</button>
        {/if}
      </div>

      {#if invited && code}
        <section class="grid gap-3 rounded-xl bg-raised/60 p-4">
          <p class="text-lg">You're invited to room <span class="font-mono tracking-widest">{code}</span>.</p>
          <Button variant="accent" class="h-12 text-base" disabled={busy} onclick={joinInvite}>{busy ? 'Joining…' : `Join as ${room.name}`}</Button>
        </section>
      {:else}
        <label class="grid gap-1.5">
          <span class="text-muted">Got a code?</span>
          <input
            class={[field, 'h-14 max-w-72 text-center font-mono text-3xl tracking-[0.4em] uppercase']}
            value={code}
            oninput={(e) => typed(e.currentTarget)}
            onkeydown={(e) => e.key === 'Enter' && findCode()}
            placeholder="•••••"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck="false"
            aria-label="Room code"
            disabled={busy}
          />
        </label>
      {/if}
      {#if busy || searching}<p class="text-muted" role="status">{searching ? 'Looking for that room…' : 'Joining…'}</p>{/if}
      {#if matches}
        <section class="grid gap-2 rounded-xl bg-raised/40 p-3" aria-label="Rooms with this code">
          <p class="text-lg">{matches.length === 1 ? 'Found it! Is this the room?' : `Code ${code} is in ${matches.length} places. Which one is it?`}</p>
          {#each matches as { server, info } (server)}
            <!-- Servers often keep the default name; the address tells same-named ones apart. -->
            {@render roomCard(server, info, matches.some((m) => m.server !== server && nameOf(m.server) === nameOf(server)))}
          {/each}
          <Button variant="ghost" class="h-10 justify-self-start" onclick={() => (matches = null)}>Not this one</Button>
        </section>
      {/if}

      {#if pinFor || room.errorCode === 'pin'}
        <form class="grid gap-2 rounded-xl bg-raised/60 p-4" onsubmit={(e) => (e.preventDefault(), joinWithPin())}>
          <span class="text-lg">This room has a PIN. Ask the host for it.</span>
          <div class="flex gap-2">
            <input class={[field, 'w-40 font-mono text-xl tracking-widest']} bind:value={pin} inputmode="numeric" aria-label="PIN" use:focusOnMount />
            <Button type="submit" variant="accent" class="h-11" disabled={!pin.trim() || busy}>Join</Button>
            <Button variant="ghost" class="h-11" onclick={dismissPin}>Cancel</Button>
          </div>
        </form>
      {:else if room.error || notice}
        <p class="text-danger" role="alert">{room.error || notice}</p>
      {/if}

      <section class="grid gap-2">
        <h3 class="font-mono text-[11px] tracking-wider text-muted uppercase">Rooms to join</h3>
        {#each rooms as { server, info } (server + info.code)}
          {@render roomCard(server, info)}
        {:else}
          <p class="text-muted">
            {#if !known.length || known.every(({ server }) => statusOf(server)?.status === 'offline')}
              No server answers right now. Open Servers to add one{platform.host ? ' or be one' : ''}.
            {:else if known.some(({ server }) => statusOf(server)?.status !== 'offline' && statusOf(server)?.status !== 'online')}
              Looking for rooms…
            {:else}
              No rooms open right now. Start one and invite your friends!
            {/if}
          </p>
        {/each}
      </section>
    {/if}
  </div>
  <SoftKeys keys={softKeys} />
</div>
