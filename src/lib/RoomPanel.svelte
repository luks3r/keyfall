<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { probe, type Listing, type Room, type RoomInfo } from './net/room.svelte'
  import { isNative, platform, type NearbyHost } from './platform'
  import type { Player } from './player.svelte'
  import Button from './ui/Button.svelte'
  import Field from './ui/Field.svelte'
  import Icon from './ui/Icon.svelte'
  import Panel from './ui/Panel.svelte'
  import Qr from './ui/Qr.svelte'
  import Section from './ui/Section.svelte'
  import Select, { type Option } from './ui/Select.svelte'
  import Toggle from './ui/Toggle.svelte'

  let { room, player, initialCode = '', onclose }: { room: Room; player: Player; initialCode?: string; onclose: () => void } = $props()

  const SPECTATOR = ''
  const POLL_MS = 3000
  const COPIED_MS = 1500
  const PAGE = ''
  const input = 'h-9 w-full rounded-lg bg-raised px-2.5 outline-none focus:ring-1 focus:ring-accent'

  let code = $state(untrack(() => initialCode))
  let pin = $state('')
  let listings = $state.raw<Record<string, Listing | null>>({})
  let nearby = $state.raw<NearbyHost[]>([])
  let hostError = $state('')
  let copied = $state(false)
  let addingServer = $state(false)
  let creating = $state(false)
  let options = $state({ name: '', public: true, pin: '', maxPlayers: '' })

  const connected = $derived(room.status === 'connected' || room.status === 'reconnecting')
  const busy = $derived(room.status === 'connecting')
  const hostingAddress = $derived(room.hosting ? `127.0.0.1:${room.hosting.port}` : null)

  const servers = $derived.by(() => {
    const list = [
      ...(isNative ? [] : [PAGE]),
      ...(hostingAddress ? [hostingAddress] : []),
      ...(room.server ? [room.server] : []),
      ...nearby.map((host) => host.url),
      ...room.recent,
    ]
    return [...new Set(list)]
  })

  const label = (server: string) =>
    server === PAGE ? location.host : server === hostingAddress ? 'This device' : server.replace(/^[a-z]+:\/\//i, '')

  const rooms = $derived(
    servers
      .flatMap((server) => listings[server]?.rooms.map((info) => ({ server, info, listing: listings[server]! })) ?? [])
      .sort((a, b) => a.listing.ping - b.listing.ping),
  )
  const target = $derived(listings[room.server] ?? null)

  const seatOptions = $derived<Option[]>([
    { value: SPECTATOR, label: 'Spectator' },
    ...player.song.parts.map((part, i) => ({ value: String(i), label: part })),
  ])
  const seatName = (seat: number | null | undefined) =>
    seat == null ? 'spectating' : (player.song.parts[seat] ?? `part ${seat + 1}`)
  const pingTone = (ping: number) => (ping < 40 ? 'text-mint' : ping < 100 ? 'text-accent' : 'text-danger')

  async function refresh() {
    if (connected) return
    const results = await Promise.all(servers.map((server) => probe(server).then((listing) => [server, listing] as const, () => [server, null] as const)))
    listings = Object.fromEntries(results)
  }

  function useServer(server: string) {
    room.server = server
    addingServer = false
    void refresh()
  }

  function joinListed(server: string, info: RoomInfo) {
    room.server = server
    if (info.locked) {
      code = info.code
      pin = ''
      room.errorCode = 'pin'
      room.error = 'This room needs a PIN.'
      return
    }
    void room.join(info.code)
  }

  function create() {
    creating = false
    void room.create({
      name: options.name.trim() || `${room.name}'s room`,
      public: options.public,
      pin: options.pin.trim(),
      maxPlayers: options.maxPlayers ? Number(options.maxPlayers) : null,
    })
  }

  async function toggleHosting() {
    hostError = ''
    try {
      if (room.hosting) await room.stopHosting()
      else await room.startHosting()
      void refresh()
    } catch (error) {
      hostError = String(error)
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text)
    copied = true
    setTimeout(() => (copied = false), COPIED_MS)
  }

  onMount(() => {
    void refresh()
    const poll = setInterval(refresh, POLL_MS)
    let stopDiscovery: (() => void) | undefined
    void platform.discover?.((hosts) => (nearby = hosts)).then((stop) => (stopDiscovery = stop))
    return () => {
      clearInterval(poll)
      stopDiscovery?.()
    }
  })
</script>

{#snippet person(color: string, name: string, tag: string, seat: number | null | undefined, host: boolean, kickable: number | null)}
  <li class="flex items-center gap-2.5 rounded-lg bg-bg/60 px-3 py-2">
    <span class="size-2.5 shrink-0 rounded-full" style:background={color}></span>
    <span class="min-w-0 flex-1 truncate">{name}<span class="text-xs text-muted"> #{tag}</span></span>
    <span class="text-xs text-muted">{seatName(seat)}</span>
    {#if host}<span class="text-[10px] font-semibold text-accent uppercase">host</span>{/if}
    {#if kickable !== null}
      <Button variant="ghost" shape="square" class="size-6" onclick={() => room.kick(kickable)} title="Remove from room" aria-label="Remove {name}">
        <Icon name="close" class="size-3.5" />
      </Button>
    {/if}
  </li>
{/snippet}

<Panel title={connected ? room.details?.name || `Room ${room.code}` : 'Play together'} {onclose}>
  {#if !connected}
    <Field label="Your name">
      <input class={input} bind:value={room.name} maxlength="24" autocomplete="nickname" />
    </Field>

    <Section title="Rooms">
      {#snippet aside()}
        <Button variant="ghost" shape="square" class="size-6" onclick={refresh} aria-label="Refresh rooms"><Icon name="refresh" class="size-3.5" /></Button>
      {/snippet}
      {#if rooms.length}
        <ul class="grid gap-1.5">
          {#each rooms as { server, info, listing } (server + info.code)}
            <li class="flex items-center gap-3 rounded-lg bg-bg/60 px-3 py-2">
              <div class="min-w-0 flex-1">
                <p class="truncate">{info.name || info.code}{#if info.locked}<span class="text-muted"> · PIN</span>{/if}</p>
                <p class="truncate text-xs text-muted">
                  {info.host || 'host'} · {info.players}{info.maxPlayers ? `/${info.maxPlayers}` : ''} playing{info.spectators ? ` · ${info.spectators} watching` : ''}{info.song ? ` · ${info.song}` : ''}
                </p>
                <p class="truncate text-[11px] text-muted">{listing.info.name} · {label(server)} · <span class={pingTone(listing.ping)}>{listing.ping} ms</span></p>
              </div>
              <Button variant="accent" disabled={busy} onclick={() => joinListed(server, info)}>Join</Button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-xs text-muted">No public rooms on known servers. Create one, or join by code.</p>
      {/if}
      <div class="flex gap-2">
        <input
          class={[input, 'flex-1 font-mono tracking-widest uppercase']}
          bind:value={code}
          placeholder="Code"
          maxlength="12"
          autocapitalize="characters"
          onkeydown={(e) => e.key === 'Enter' && code.trim() && room.join(code, pin)}
        />
        {#if room.errorCode === 'pin'}
          <input class={[input, 'w-20 font-mono']} bind:value={pin} placeholder="PIN" inputmode="numeric" />
        {/if}
        <Button disabled={!code.trim() || busy} onclick={() => room.join(code, pin)}>Join</Button>
      </div>
      {#if room.error}<p class="text-xs text-danger">{room.error}</p>{/if}
    </Section>

    <Section title="New room">
      {#snippet aside()}
        {#if target}<span class="truncate text-xs text-muted">on {target.info.name}</span>{/if}
      {/snippet}
      {#if creating}
        <Field label="Room name">
          <input class={input} bind:value={options.name} placeholder="{room.name}'s room" maxlength="40" />
        </Field>
        <div class="grid grid-cols-2 gap-3">
          <Field label="PIN (optional)">
            <input class={[input, 'font-mono']} bind:value={options.pin} inputmode="numeric" maxlength="12" />
          </Field>
          <Field label="Max players">
            <input class={input} bind:value={options.maxPlayers} type="number" min="1" placeholder="∞" />
          </Field>
        </div>
        <Toggle label="Show in room lists" bind:checked={options.public} />
        <div class="flex gap-2">
          <Button class="flex-1" onclick={() => (creating = false)}>Cancel</Button>
          <Button class="flex-1" variant="accent" disabled={busy} onclick={create}>Create</Button>
        </div>
      {:else}
        <Button variant="accent" disabled={busy} onclick={() => (creating = true)}><Icon name="plus" />Create room</Button>
      {/if}
    </Section>

    <Section title="Servers">
      {#snippet aside()}
        <Button variant="ghost" class="h-6 px-2 text-xs" onclick={() => (addingServer = !addingServer)}>{addingServer ? 'Done' : 'Add'}</Button>
      {/snippet}
      {#if addingServer}
        <input
          class={input}
          placeholder="host:7777 or https://server"
          inputmode="url"
          autocapitalize="off"
          onchange={(e) => useServer(e.currentTarget.value.trim())}
        />
      {/if}
      <ul class="grid gap-1">
        {#each servers as server (server)}
          {@const listing = listings[server]}
          <li>
            <button
              type="button"
              class={[
                'flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition-colors',
                server === room.server ? 'bg-accent/15 text-fg' : 'hover:bg-raised',
              ]}
              onclick={() => useServer(server)}
            >
              <span class={['size-1.5 shrink-0 rounded-full', listing ? 'bg-mint' : listing === null ? 'bg-danger' : 'bg-muted']}></span>
              <span class="min-w-0 flex-1 truncate">{listing?.info.name ?? label(server)}<span class="text-muted"> · {label(server)}</span></span>
              {#if listing}<span class={['tabular-nums', pingTone(listing.ping)]}>{listing.ping} ms</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
      <p class="text-[11px] text-muted">New rooms are created on the highlighted server.</p>
    </Section>

    {#if platform.host}
      <Section title="Host on this network">
        {#snippet aside()}
          <Button variant={room.hosting ? 'danger' : 'accent'} class="h-7 text-xs" onclick={toggleHosting}>{room.hosting ? 'Stop' : 'Start'}</Button>
        {/snippet}
        {#if room.hosting}
          <p class="text-xs leading-relaxed text-muted">One room on this device. Others on your Wi-Fi scan this or open <span class="text-fg">{room.hosting.urls[0] ?? `port ${room.hosting.port}`}</span>.</p>
          {#if room.hosting.urls[0]}<Qr value={room.hosting.urls[0]} label="Server address" />{/if}
        {:else}
          <p class="text-xs leading-relaxed text-muted">Turns this device into a one-room server for your Wi-Fi. Phones and browsers join with no install.</p>
        {/if}
        {#if hostError}<p class="text-xs text-danger">{hostError}</p>{/if}
      </Section>
    {/if}
  {:else}
    {#if room.status === 'reconnecting'}
      <p class="rounded-lg bg-danger/15 px-3 py-2 text-xs">Connection dropped. Reconnecting…</p>
    {/if}
    {#if room.error}<p class="text-xs text-danger">{room.error}</p>{/if}

    <Section title="You">
      {#snippet aside()}
        <Button variant="danger" class="h-7 text-xs" onclick={() => room.leave()}>Leave</Button>
      {/snippet}
      <Field label="Seat">
        <Select
          bind:value={() => (room.seat === null ? SPECTATOR : String(room.seat)), (value) => room.setSeat(value === SPECTATOR ? null : Number(value))}
          options={seatOptions}
        />
      </Field>
    </Section>

    <Section title="Players · {room.peers.size + 1}">
      {#snippet aside()}
        {#if room.ping !== null}
          <span class={['text-xs tabular-nums', pingTone(room.ping)]} title="Round trip to the room server">ping {room.ping} ms</span>
        {/if}
      {/snippet}
      <ul class="grid gap-1.5">
        {@render person('#f6b94c', `${room.name} (you)`, room.tag, room.seat, room.isHost, null)}
        {#each [...room.peers.values()] as peer (peer.id)}
          {@render person(peer.color, peer.profile?.name ?? '…', peer.tag, peer.profile?.seat, peer.id === room.host, room.isHost ? peer.id : null)}
        {/each}
      </ul>
      {#if !room.isHost}<p class="text-xs text-muted">The host picks the song, mode and tempo.</p>{/if}
    </Section>

    <Section title="Invite · {room.code}{room.details?.locked ? ' · PIN' : ''}">
      <Qr value={room.invite} label="Invite link" />
      <div class="flex gap-2">
        <Button class="flex-1" onclick={() => copy(room.invite)}>{copied ? 'Copied' : 'Copy link'}</Button>
        {#if typeof navigator.share === 'function'}
          <Button class="flex-1" onclick={() => navigator.share({ title: 'Keyfall room', url: room.invite })}>Share</Button>
        {/if}
      </div>
      <p class="truncate text-center font-mono text-xs text-muted">{room.invite}</p>
    </Section>
  {/if}
</Panel>
