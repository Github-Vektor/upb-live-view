// Same-origin: the Vite dev server proxies these paths to the HTTP localisation
// server (see vite.config.ts), which keeps everything on HTTPS in the browser.
const SERVER = ''

/**
 * URL for a test clip cut from the `segment`-th 10% window of the recording
 * (segment 0 = first 10%, 1 = next 10%, …). Cache-busted so each call re-fetches.
 */
export function testClipUrl(segment: number): string {
  return `${SERVER}/test-clip?segment=${segment}&t=${Date.now()}`
}

export interface LocalisationResult {
  node_id:      string | null
  confidence:   number
  inference_ms: number
}

export async function queryFrame(jpeg: Blob): Promise<LocalisationResult> {
  const form = new FormData()
  form.append('frame', jpeg, 'frame.jpg')
  const res = await fetch(`${SERVER}/localise`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Server error ${res.status}`)
  return res.json()
}

export async function checkServerStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER}/status`, { signal: AbortSignal.timeout(2000) })
    const data = await res.json()
    return data.ready === true
  } catch {
    return false
  }
}
