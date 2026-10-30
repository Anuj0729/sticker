export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Tells other open tabs (like /tester) that packs/stickers changed
export const notify = () => {
  try { const c = new BroadcastChannel('sticker-studio'); c.postMessage('changed'); c.close(); } catch {}
};

export async function call(path, { token, method = 'GET', body, form } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: form || (body && JSON.stringify(body)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}
