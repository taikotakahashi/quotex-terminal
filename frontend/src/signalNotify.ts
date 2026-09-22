/** Sound + browser notification when a live signal arrives. */

const ALERTS_KEY = 'qx_signal_alerts'

export function alertsEnabled(): boolean {
  try {
    const v = localStorage.getItem(ALERTS_KEY)
    if (v === null) return true
    return v === '1'
  } catch {
    return true
  }
}

export function setAlertsEnabled(on: boolean): void {
  try {
    localStorage.setItem(ALERTS_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

let audioCtx: AudioContext | null = null

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!audioCtx) audioCtx = new AC()
  return audioCtx
}

/** Call from a user gesture so later chimes are allowed to play. */
export async function unlockAudio(): Promise<void> {
  const ac = ctx()
  if (!ac) return
  try {
    if (ac.state === 'suspended') await ac.resume()
  } catch {
    /* ignore */
  }
}

/** Short two-tone chime (no external audio file). */
export async function playSignalSound(): Promise<void> {
  if (!alertsEnabled()) return
  const ac = ctx()
  if (!ac) return
  try {
    if (ac.state === 'suspended') await ac.resume()
  } catch {
    return
  }
  const now = ac.currentTime
  const tones: Array<[number, number, number]> = [
    [880, now, 0.12],
    [1174.7, now + 0.11, 0.16],
  ]
  for (const [freq, start, dur] of tones) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    osc.connect(gain)
    gain.connect(ac.destination)
    osc.start(start)
    osc.stop(start + dur + 0.02)
  }
}

export async function ensureNotifyPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission
  }
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

export function pushSignalNotification(title: string, body: string): void {
  if (!alertsEnabled()) return
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, {
      body,
      icon: '/quotex_logo.svg',
      badge: '/quotex_logo.svg',
      tag: 'qx-signal',
    })
    window.setTimeout(() => n.close(), 8000)
  } catch {
    /* ignore */
  }
}

export async function announceSignal(opts: {
  title: string
  body: string
}): Promise<void> {
  if (!alertsEnabled()) return
  await playSignalSound()
  // Request permission lazily on first signal (browsers require a prior gesture for
  // autoplay; sound may no-op until then, but Notification.request can still help).
  if ('Notification' in window && Notification.permission === 'default') {
    try {
      await Notification.requestPermission()
    } catch {
      /* ignore */
    }
  }
  pushSignalNotification(opts.title, opts.body)
}
