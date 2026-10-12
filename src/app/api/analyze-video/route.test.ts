import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ connection: async () => undefined }));
const { GET, POST } = await import('./route');

afterEach(() => vi.unstubAllEnvs());

describe('/api/analyze-video when video analysis is switched off', () => {
  it('refuses status checks and uploads before touching the key or the upload', async () => {
    vi.stubEnv('NEXT_PUBLIC_VIDEO_ANALYSIS', 'off');
    vi.stubEnv('GEMINI_API_KEY', 'test-key-never-used');
    const get = await GET();
    expect(get.status).toBe(503);
    const body = new FormData();
    body.set('video', new File([new Uint8Array(10)], 'clip.mp4'));
    const request = new Request('http://localhost/api/analyze-video', { method: 'POST', body });
    const formData = vi.spyOn(request, 'formData');
    const post = await POST(request);
    expect(post.status).toBe(503);
    expect(((await post.json()) as { error: { code: string; message: string } }).error).toMatchObject({ code: 'not_configured', message: 'Video analysis is coming soon.' });
    expect(formData).not.toHaveBeenCalled();
  });
});
