const SERVER = 'http://localhost:8787'

export interface LocalisationResult {
  node_id: string | null
  confidence: number
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
