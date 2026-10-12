import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleAnalysis } from '@/domain/replay/fixtures';
import { replayToView } from '@/domain/replay/coords';
import type { Match } from '@/domain/types';
import { MatchProvider, useMatch } from '@/store/MatchContext';
import { VideoClientError } from '@/video-analysis/client';
import { matchWithSquads, mockBoardLayout, toClient } from '@/components/board/boardTestUtils';
import { ReplaysView } from './ReplaysView';
import type { ClipDeps } from './ClipImport';

/**
 * These drive the real UI with the status check, media probing and the
 * analysis request replaced by fakes. The "analysis" is the hand-written
 * fixture in domain/replay/fixtures.ts, so they prove the FLOW (upload →
 * confirm → analyse → review → save → replay), not that any model understands
 * football footage.
 */

// --- a controllable animation-frame clock -------------------------------------------
let now = 0;
let frames = new Map<number, FrameRequestCallback>();
let frameId = 1;
function advance(ms: number) {
  now += ms;
  const due = [...frames.values()];
  frames = new Map();
  act(() => due.forEach((cb) => cb(now)));
}

beforeEach(() => {
  now = 0;
  frames = new Map();
  frameId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = frameId++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => void frames.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  let n = 0;
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => `blob:clip-${n++}`, revokeObjectURL: () => {} });
  mockBoardLayout();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const META = { model: 'gemini-test', samplingFps: 5, durationSeconds: 12, analysedAt: '2026-10-12T09:00:00.000Z' };

function fakeDeps(over: Partial<ClipDeps> = {}) {
  const deps = {
    status: async () => ({
      configured: true,
      provider: 'gemini' as const,
      model: 'gemini-test',
      limits: { maxBytes: 50 * 1024 * 1024, maxSeconds: 60, samplingFps: 5, types: ['video/mp4'] },
    }),
    duration: async () => 12,
    check: async () => null,
    analyze: vi.fn(async () => ({ analysis: sampleAnalysis(), meta: META })),
    ...over,
  };
  return deps as ClipDeps & { analyze: ReturnType<typeof vi.fn> };
}

/** Exposes the live match so tests can assert on it without going through the UI. */
let latest: Match | null = null;
function Probe() {
  const match = useMatch();
  useEffect(() => {
    latest = match;
  });
  return null;
}

function setup(deps: ClipDeps = fakeDeps(), match: Match = matchWithSquads()) {
  const user = userEvent.setup();
  render(
    <MatchProvider initialMatch={match}>
      <Probe />
      <ReplaysView clipDeps={deps} />
    </MatchProvider>,
  );
  return { user, deps };
}

const clip = () => new File([new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])], 'goal-attempt.mp4', { type: 'video/mp4' });

async function importAndAnalyse(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /ai sketch from a clip/i }));
  await user.upload(await screen.findByLabelText('Video clip'), clip());
  await user.click(await screen.findByRole('button', { name: 'Analyse this clip' }));
  await screen.findByRole('heading', { name: 'Review replay' });
}

const caption = () => screen.getByTestId('replay-caption');
const marker = (name: RegExp) => screen.getByRole('button', { name });
const translateOf = (el: Element) => {
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(el.getAttribute('transform') ?? '');
  if (!m) throw new Error('no transform');
  return { x: Number(m[1]), y: Number(m[2]) };
};

describe('importing a clip', () => {
  it('previews the clip, analyses it once on request, and opens an editable review', async () => {
    const { user, deps } = setup();
    await user.click(screen.getByRole('button', { name: /ai sketch from a clip/i }));
    await user.upload(await screen.findByLabelText('Video clip'), clip());

    // Preview and confirmation come first; nothing has been sent.
    expect(await screen.findByLabelText('Clip preview')).toBeInTheDocument();
    expect(screen.getByText(/goal-attempt\.mp4/)).toBeInTheDocument();
    expect(deps.analyze).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Analyse this clip' }));
    await screen.findByRole('heading', { name: 'Review replay' });
    expect(deps.analyze).toHaveBeenCalledTimes(1);

    // The analysis is on the existing pitch as estimates, editable.
    expect(screen.getByRole('group', { name: /Tactical replay/ })).toBeInTheDocument();
    expect(screen.getByText(/Estimated reconstruction/)).toBeInTheDocument();
    expect(screen.getByLabelText('Event type')).toHaveValue('shotOnTarget');
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toContain('Through ball');
    expect(screen.getByText(/Shirt numbers not visible/)).toBeInTheDocument(); // uncertainty is shown
    // Nothing is saved yet.
    expect(latest!.replays).toHaveLength(0);
  });

  it('explains how to enable analysis and still lets the user annotate by hand', async () => {
    const deps = fakeDeps({
      status: async () => ({
        configured: false,
        provider: 'gemini' as const,
        model: 'gemini-test',
        limits: { maxBytes: 1, maxSeconds: 1, samplingFps: 5, types: [] },
        reason: 'No GEMINI_API_KEY is set on the DizPitch server, so video clips cannot be analysed automatically.',
      }),
    });
    const { user } = setup(deps);
    await user.click(screen.getByRole('button', { name: /ai sketch from a clip/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('GEMINI_API_KEY');
    expect(alert).toHaveTextContent('.env.local');
    expect(screen.queryByLabelText('Video clip')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /annotate a replay by hand/i }));
    expect(await screen.findByRole('heading', { name: 'Review replay' })).toBeInTheDocument();
    expect(deps.analyze).not.toHaveBeenCalled();
  });

  it('reports an unreachable server and does not pretend to analyse', async () => {
    const { user } = setup(fakeDeps({ status: async () => null }));
    await user.click(screen.getByRole('button', { name: /ai sketch from a clip/i }));
    expect(await screen.findByText(/server could not be reached/)).toBeInTheDocument();
  });

  it('rejects an unsuitable clip before anything is uploaded', async () => {
    const deps = fakeDeps({
      check: async () => ({ code: 'video_too_long' as const, message: 'The clip is 95 s long; the limit is 60 s.', retryable: false }),
    });
    const { user } = setup(deps);
    await user.click(screen.getByRole('button', { name: /ai sketch from a clip/i }));
    await user.upload(await screen.findByLabelText('Video clip'), clip());
    expect(await screen.findByRole('alert')).toHaveTextContent('the limit is 60 s');
    expect(screen.queryByRole('button', { name: 'Analyse this clip' })).not.toBeInTheDocument();
    expect(deps.analyze).not.toHaveBeenCalled();
  });

  it('shows a failed analysis, never repeats it by itself, and retries only when asked', async () => {
    const analyze = vi
      .fn()
      .mockRejectedValueOnce(new VideoClientError({ code: 'rate_limited', message: 'The video service is rate-limited right now.', retryable: true }))
      .mockResolvedValue({ analysis: sampleAnalysis(), meta: META });
    const { user } = setup(fakeDeps({ analyze }));
    await user.click(screen.getByRole('button', { name: /ai sketch from a clip/i }));
    await user.upload(await screen.findByLabelText('Video clip'), clip());
    await user.click(await screen.findByRole('button', { name: 'Analyse this clip' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('rate-limited');
    await act(async () => {
      await Promise.resolve();
    });
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /annotate a replay by hand/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: 'Review replay' });
    expect(analyze).toHaveBeenCalledTimes(2);
  });
});

describe('reviewing, correcting and saving', () => {
  it('lets the user correct the event, players and positions and shows it in the preview', async () => {
    const { user } = setup();
    await importAndAnalyse(user);

    await user.selectOptions(screen.getByLabelText('Event type'), 'goal');
    await user.clear(screen.getByLabelText('Description'));
    await user.type(screen.getByLabelText('Description'), 'Corrected: low finish into the corner.');
    await user.selectOptions(screen.getByLabelText('Attacking team'), 'away');

    // The attacker the AI placed at (55, 50) is now turned around the pitch.
    const ball = within(screen.getByRole('group', { name: 'Players and ball' })).getByRole('button', { name: 'Ball, estimated position' });
    expect(translateOf(ball)).toEqual(replayToView({ x: 45, y: 50 }, 'landscape'));

    // Identify a player by hand, and leave another unidentified.
    await user.click(screen.getByRole('tab', { name: 'Players' }));
    const row = screen.getByRole('listitem', { name: 'Attacker 2' });
    await user.type(within(row).getByLabelText('Name'), 'Dev Anand');
    expect(within(row).getByLabelText('Name')).toHaveValue('Dev Anand');
    expect(screen.getByRole('listitem', { name: 'Defender 1' })).toBeInTheDocument();

    // Move the ball with the keyboard: arrow keys nudge the selected marker.
    marker(/^Ball/).focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    const moved = translateOf(within(screen.getByRole('group', { name: 'Players and ball' })).getByRole('button', { name: /^Ball/ }));
    const before = replayToView({ x: 45, y: 50 }, 'landscape');
    expect(moved.x).toBeGreaterThan(before.x);
    // Dragging/nudging marks the position as the user's: no longer "estimated".
    expect(within(screen.getByRole('group', { name: 'Players and ball' })).getByRole('button', { name: 'Ball' })).toBeInTheDocument();
  });

  it('moves a player by dragging on the pitch, mapped through the pitch coordinates', async () => {
    const { user } = setup();
    await importAndAnalyse(user);
    const ball = marker(/^Ball/);
    const from = translateOf(ball);
    const to = replayToView({ x: 70, y: 30 }, 'landscape');
    fireEvent.pointerDown(ball, { ...toClient(from), pointerId: 3, button: 0 });
    fireEvent.pointerMove(screen.getByRole('group', { name: /Tactical replay/ }), { ...toClient(to), pointerId: 3 });
    fireEvent.pointerUp(screen.getByRole('group', { name: /Tactical replay/ }), { ...toClient(to), pointerId: 3 });
    const after = translateOf(marker(/^Ball/));
    expect(after.x).toBeCloseTo(to.x, 2);
    expect(after.y).toBeCloseTo(to.y, 2);
    // It created a keyframe at the current time (replay start).
    await user.click(screen.getByRole('tab', { name: 'Keyframes' }));
    expect(screen.getAllByRole('listitem', { name: /^Keyframe/ }).length).toBeGreaterThanOrEqual(3);
  });

  it('adds, edits and removes arrows', async () => {
    const { user } = setup();
    await importAndAnalyse(user);
    await user.click(screen.getByRole('tab', { name: 'Arrows' }));
    expect(screen.getAllByRole('listitem', { name: /^Arrow/ })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /^Add arrow at/ }));
    expect(screen.getAllByRole('listitem', { name: /^Arrow/ })).toHaveLength(3);
    await user.selectOptions(screen.getByLabelText('Arrow 3 type'), 'shot');
    expect(screen.getByLabelText('Arrow 3 type')).toHaveValue('shot');
    await user.click(screen.getByRole('button', { name: 'Delete arrow 3' }));
    expect(screen.getAllByRole('listitem', { name: /^Arrow/ })).toHaveLength(2);
  });

  it('saves with unidentified players and approximate positions, keeping the original analysis', async () => {
    const { user } = setup();
    await importAndAnalyse(user);
    await user.click(screen.getByRole('button', { name: /save replay/i }));
    expect(await screen.findByRole('heading', { name: 'Shot on target · 67:12' })).toBeInTheDocument();
    expect(latest!.replays).toHaveLength(1);
    const saved = latest!.replays[0];
    // The unedited AI analysis is kept verbatim next to the (editable) replay.
    expect(saved.original).toEqual(sampleAnalysis());
    expect(saved.actors.some((a) => a.name === '')).toBe(true); // unidentified players are fine
    expect(saved.origin).toBe('ai');
    expect(saved.source).toMatchObject({ fileName: 'goal-attempt.mp4', model: 'gemini-test', samplingFps: 5 });
  });

  it('keeps edits when reopened and does not touch the rest of the match', async () => {
    const before = matchWithSquads();
    const { user } = setup(fakeDeps(), before);
    await importAndAnalyse(user);
    await user.selectOptions(screen.getByLabelText('Event type'), 'goal');
    await user.click(screen.getByRole('button', { name: /save replay/i }));
    await screen.findByRole('heading', { name: /Shot on target|Goal/ });

    const { replays: _after, ...afterRest } = latest!;
    const { replays: _before, ...beforeRest } = before;
    void _after;
    void _before;
    expect(afterRest).toEqual(beforeRest); // squads, board, drawings, events, clock: untouched

    await user.click(screen.getByRole('button', { name: 'Back to replays' }));
    await user.click(screen.getByRole('button', { name: /^Edit /i }));
    expect(await screen.findByLabelText('Event type')).toHaveValue('goal');
  });

  it('refuses to save an invalid replay with a reason', async () => {
    const { user } = setup();
    await importAndAnalyse(user);
    await user.clear(screen.getByLabelText('Title'));
    await user.click(screen.getByRole('button', { name: /save replay/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the replay a title.');
    expect(latest!.replays).toHaveLength(0);
  });

  it('re-analyses only after an explicit, confirmed request, and replaces the draft', async () => {
    const analyze = vi.fn(async () => ({ analysis: sampleAnalysis(), meta: META }));
    const { user } = setup(fakeDeps({ analyze }));
    await importAndAnalyse(user);
    await user.selectOptions(screen.getByLabelText('Event type'), 'foul');
    expect(analyze).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /analyse the clip again/i }));
    expect(analyze).toHaveBeenCalledTimes(1); // asking is not doing
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/uses API quota/);
    await user.click(screen.getByRole('button', { name: 'Analyse again' }));
    await screen.findByRole('heading', { name: 'Review replay' });
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(await screen.findByLabelText('Event type')).toHaveValue('shotOnTarget'); // edits replaced
  });

  it('cancelling asks before discarding edits and saves nothing', async () => {
    const { user } = setup();
    await importAndAnalyse(user);
    await user.selectOptions(screen.getByLabelText('Event type'), 'foul');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/Discard/);
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('heading', { name: 'Tactical replays' })).toBeInTheDocument();
    expect(latest!.replays).toHaveLength(0);
  });
});

describe('manual replays', () => {
  it('can be created, positioned, saved and played with no video and no AI', async () => {
    const deps = fakeDeps();
    const { user } = setup(deps);
    await user.click(screen.getByRole('button', { name: /create replay by hand/i }));
    await user.click(screen.getByRole('tab', { name: 'Players' }));
    await user.click(screen.getByRole('button', { name: 'Add player' }));
    await user.click(screen.getByRole('tab', { name: 'Event' }));
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Corner routine');
    await user.click(screen.getByRole('button', { name: /save replay/i }));
    expect(await screen.findByRole('heading', { name: 'Corner routine' })).toBeInTheDocument();
    expect(latest!.replays[0]).toMatchObject({ origin: 'manual', source: null, original: null });
    expect(deps.analyze).not.toHaveBeenCalled();
  });
});

describe('playing a saved replay', () => {
  async function savedAndOpen() {
    const ctx = setup();
    await importAndAnalyse(ctx.user);
    await ctx.user.click(screen.getByRole('button', { name: /save replay/i }));
    await screen.findByRole('button', { name: 'Back to replays' });
    return ctx;
  }

  it('plays, pauses, resets, replays and scrubs without any new request or change to the match', async () => {
    const { user, deps } = await savedAndOpen();
    const snapshot = JSON.stringify(latest);
    const time = () => Number(screen.getByRole('group', { name: /Tactical replay/ }).getAttribute('data-replay-time'));

    expect(time()).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Play' }));
    advance(16);
    advance(1000);
    expect(time()).toBeGreaterThan(0.9);
    expect(time()).toBeLessThan(1.2);

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    const paused = time();
    advance(2000);
    expect(time()).toBe(paused);

    // Speed doubles the rate.
    await user.click(screen.getByRole('button', { name: '2×' }));
    await user.click(screen.getByRole('button', { name: 'Play' }));
    advance(16);
    const start = time();
    advance(500);
    expect(time() - start).toBeGreaterThan(0.9);

    await user.click(screen.getByRole('button', { name: 'Reset to start' }));
    expect(time()).toBe(0);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();

    // Scrub: the caption follows the timeline annotations.
    fireEvent.change(screen.getByLabelText('Replay position'), { target: { value: '3.6' } });
    expect(time()).toBeCloseTo(3.6, 1);
    expect(caption()).toHaveTextContent('Shot');

    // "Replay" from the middle goes back to the start (unlike Play, which would continue from 3.6 s).
    await user.click(screen.getByRole('button', { name: 'Replay from the beginning' }));
    advance(16);
    advance(500);
    expect(time()).toBeGreaterThan(0.3);
    expect(time()).toBeLessThan(1.5);
    advance(60_000);
    expect(screen.getByRole('button', { name: 'Play again' })).toBeInTheDocument(); // stopped at the end

    expect(deps.analyze).toHaveBeenCalledTimes(1); // only the original analysis
    expect(JSON.stringify(latest)).toBe(snapshot); // playback never edits the match
  });

  it('steps between keyframes and keeps the markers on the pitch throughout', async () => {
    await savedAndOpen();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next keyframe' }));
    const t = Number(screen.getByRole('group', { name: /Tactical replay/ }).getAttribute('data-replay-time'));
    expect(t).toBe(2);
    const board = screen.getByRole('group', { name: 'Players and ball' });
    for (const el of within(board).getAllByRole('img')) {
      const { x, y } = translateOf(el);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(105);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(68);
    }
  });

  it('stops its animation loop when the replay closes', async () => {
    const { user } = await savedAndOpen();
    await user.click(screen.getByRole('button', { name: 'Play' }));
    advance(16);
    expect(frames.size).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Back to replays' }));
    expect(frames.size).toBe(0); // the pending frame was cancelled on unmount
  });

  it('deletes a replay after confirmation and leaves the match alone', async () => {
    const { user } = await savedAndOpen();
    await user.click(screen.getByRole('button', { name: 'Back to replays' }));
    await user.click(screen.getByRole('button', { name: /^Delete /i }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/not affected/);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(latest!.replays).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'No replays' })).toBeInTheDocument();
  });
});

describe('portrait orientation', () => {
  it('moves a marker in the direction of the arrow key as seen on screen', async () => {
    const { user } = setup();
    await importAndAnalyse(user);
    await user.click(screen.getByRole('button', { name: 'portrait' }));
    marker(/^Ball/).focus();
    const before = translateOf(marker(/^Ball/));
    await user.keyboard('{ArrowUp}');
    const up = translateOf(marker(/^Ball/));
    expect(up.y).toBeLessThan(before.y); // up is up
    expect(up.x).toBeCloseTo(before.x, 5);
    await user.keyboard('{ArrowRight}');
    const right = translateOf(marker(/^Ball/));
    expect(right.x).toBeGreaterThan(up.x); // right is right
  });
});

describe('jersey display', () => {
  const origin = (presetId: string) => ({
    presetId, league: 'isl', season: '2026-27', snapshotAt: '', verifiedAt: null, officialName: presetId,
    shortName: null, abbreviation: null, city: null, logoUrl: null, profileUrl: null, coach: null,
  });

  it('draws replay players as jerseys when the match is in jersey mode, and keeps circles otherwise', async () => {
    const base = matchWithSquads();
    const preset = { ...base, playerDisplay: 'jerseys' as const, home: { ...base.home, preset: origin('isl-club-1874') }, away: { ...base.away, preset: origin('isl-club-498') } };
    const { user } = setup(fakeDeps(), preset);
    await importAndAnalyse(user);
    const pitch = screen.getByRole('group', { name: 'Players and ball' });
    expect(pitch.querySelectorAll('[data-kit]').length).toBeGreaterThan(0);
    // The ball is never a jersey.
    expect(within(pitch).getByRole('button', { name: /^Ball/ }).querySelector('[data-kit]')).toBeNull();
  });

  it('keeps circles for a custom-team match', async () => {
    const { user } = setup();
    await importAndAnalyse(user);
    expect(screen.getByRole('group', { name: 'Players and ball' }).querySelectorAll('[data-kit]')).toHaveLength(0);
  });
});

describe('video analysis switched off', () => {
  it('answers "Coming Soon" on both video buttons and opens nothing', async () => {
    const deps = fakeDeps();
    const user = userEvent.setup();
    render(
      <MatchProvider initialMatch={matchWithSquads()}>
        <ReplaysView clipDeps={deps} videoAnalysis={false} />
      </MatchProvider>,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /track a video/i }));
    expect(screen.getByRole('status')).toHaveTextContent('Coming Soon');
    expect(screen.getByRole('status')).toHaveTextContent('🎬');
    // Still on the list: no import screen, no service or AI request.
    expect(screen.getByRole('heading', { name: 'Tactical replays' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Video file')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ai sketch from a clip/i }));
    expect(screen.getByRole('status')).toHaveTextContent('Coming Soon');
    expect(screen.queryByLabelText('Video clip')).not.toBeInTheDocument();
    expect(deps.analyze).not.toHaveBeenCalled();
  });

  it('still lets the user create a replay by hand', async () => {
    const user = userEvent.setup();
    render(
      <MatchProvider initialMatch={matchWithSquads()}>
        <ReplaysView videoAnalysis={false} />
      </MatchProvider>,
    );
    await user.click(screen.getByRole('button', { name: /create replay by hand/i }));
    expect(await screen.findByRole('heading', { name: 'Review replay' })).toBeInTheDocument();
  });

  it('is off unless NEXT_PUBLIC_VIDEO_ANALYSIS is "on"', async () => {
    const { videoAnalysisEnabled } = await import('@/lib/features');
    vi.stubEnv('NEXT_PUBLIC_VIDEO_ANALYSIS', 'on');
    expect(videoAnalysisEnabled()).toBe(true);
    for (const v of ['', 'off', 'true', '1']) {
      vi.stubEnv('NEXT_PUBLIC_VIDEO_ANALYSIS', v);
      expect(videoAnalysisEnabled()).toBe(false);
    }
    vi.unstubAllEnvs();
  });
});

