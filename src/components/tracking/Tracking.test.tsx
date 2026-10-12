import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyH, estimateHomography } from '@/domain/tracking/homography';
import type { Vec2 } from '@/domain/tracking/homography';
import { LANDMARKS } from '@/domain/tracking/landmarks';
import type { Match } from '@/domain/types';
import { MatchProvider, useMatch } from '@/store/MatchContext';
import realResult from '@/tracking/__fixtures__/real-result-147s.json';
import type { CvHealth, CvProgress } from '@/tracking/client';
import { CvClientError } from '@/tracking/client';
import { asServiceResult, trackingResultSchema } from '@/tracking/schema';
import { matchWithSquads, mockBoardLayout, toClient } from '@/components/board/boardTestUtils';
import { ReplaysView } from '@/components/replay/ReplaysView';
import type { TrackingDeps } from './TrackingImport';

/**
 * The real tracking UI, with the cv-service calls replaced by fakes that return REAL service output
 * (src/tracking/__fixtures__/real-result-147s.json, recorded from the test clip). These prove the flow
 * (choose → confirm → progress → review → correct → save → replay → reopen); they do not run any model.
 */

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
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => `blob:video-${n++}`, revokeObjectURL: () => {} });
  // jsdom has no media pipeline or 2D canvas.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  mockBoardLayout();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const HEALTH: CvHealth = {
  status: 'ok',
  device: 'mps',
  models: { dir: 'models/', missing: [] },
  limits: { maxUploadMb: 300, maxSourceSeconds: 1800, maxSegmentSeconds: 15, frameStride: 1, formats: ['mp4', 'mov', 'webm', 'mkv'] },
  resultTtlSeconds: 3600,
};
const realServiceResult = () => asServiceResult(trackingResultSchema.parse(structuredClone(realResult)));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeDeps(over: Partial<TrackingDeps> = {}) {
  return {
    health: vi.fn(async () => ({ ok: true as const, health: HEALTH })),
    duration: vi.fn(async () => 344.84),
    analyze: vi.fn(async () => realServiceResult()),
    scan: vi.fn(async () => ({
      source: { width: 854, height: 480, fps: 25, durationS: 344.84 },
      shots: [],
      suggestions: [{ startS: 147, durationS: 9.44, wideScore: 0.89 }],
    })),
    ...over,
  } satisfies TrackingDeps;
}

let latest: Match | null = null;
function Probe() {
  const match = useMatch();
  useEffect(() => {
    latest = match;
  });
  return null;
}

function setup(deps: TrackingDeps = fakeDeps(), match: Match = matchWithSquads()) {
  const user = userEvent.setup();
  const utils = render(
    <MatchProvider initialMatch={match}>
      <Probe />
      <ReplaysView trackingDeps={deps} />
    </MatchProvider>,
  );
  return { user, deps, ...utils };
}

const video = () => new File([new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])], 'test_clip.mp4', { type: 'video/mp4' });
const pitch = () => screen.getByRole('group', { name: 'Tracked players and ball' });
const status = () => screen.getByTestId('tracking-status').textContent ?? '';

/** First frame of the real fixture with an automatic calibration (pitch positions exist there). */
const calibratedFrame = (realResult.calibration.perFrame.source as string[]).findIndex((s, i) => s !== 'none' && realResult.calibration.homography[i] !== null);

async function chooseVideo(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /track a video/i }));
  await user.upload(await screen.findByLabelText('Video file'), video());
  await screen.findByLabelText('Video preview');
  await user.clear(screen.getByLabelText('Start (seconds)'));
  await user.type(screen.getByLabelText('Start (seconds)'), '147.2');
  await user.clear(screen.getByLabelText(/^Length/));
  await user.type(screen.getByLabelText(/^Length/), '2');
}

async function trackAndReview(user: ReturnType<typeof userEvent.setup>) {
  await chooseVideo(user);
  await user.click(screen.getByRole('button', { name: 'Track this segment' }));
  await screen.findByLabelText('Title');
}

async function goToFrame(user: ReturnType<typeof userEvent.setup>, frame: number) {
  for (let i = 0; i < frame; i++) await user.click(screen.getByRole('button', { name: 'Next frame' }));
  expect(status()).toMatch(new RegExp(`^Frame ${frame + 1} of 50`));
}

describe('service availability', () => {
  it('explains how to start the service when it is not running, and checks again on request', async () => {
    const deps = fakeDeps({ health: vi.fn(async () => ({ ok: false as const, code: 'service_unreachable', message: 'Not running at 127.0.0.1:8001.' })) });
    const { user } = setup(deps);
    await user.click(screen.getByRole('button', { name: /track a video/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('uv run uvicorn app.main:app --port 8001');
    expect(screen.queryByLabelText('Video file')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(deps.health).toHaveBeenCalledTimes(2);
  });

  it('says which weights are missing', async () => {
    const deps = fakeDeps({ health: vi.fn(async () => ({ ok: true as const, health: { ...HEALTH, status: 'models_missing' as const, models: { dir: 'models/', missing: ['football-player-detection.pt'] } } })) });
    const { user } = setup(deps);
    await user.click(screen.getByRole('button', { name: /track a video/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('football-player-detection.pt');
    expect(screen.getByRole('alert')).toHaveTextContent('download_models.sh');
  });
});

describe('choosing and tracking a segment', () => {
  it('validates the segment before anything is uploaded', async () => {
    const { user, deps } = setup();
    await chooseVideo(user);
    await user.clear(screen.getByLabelText(/^Length/));
    await user.type(screen.getByLabelText(/^Length/), '20');
    expect(screen.getByRole('alert')).toHaveTextContent('at most 15 s');
    expect(screen.getByRole('button', { name: 'Track this segment' })).toBeDisabled();
    expect(deps.analyze).not.toHaveBeenCalled();
  });

  it('suggests wide shots from a scan and uses one as the segment', async () => {
    const { user, deps } = setup();
    await chooseVideo(user);
    await user.click(screen.getByRole('button', { name: /find wide shots/i }));
    await user.click(await screen.findByRole('button', { name: /2:27.0 · 9.4 s/ }));
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(147);
    expect(screen.getByLabelText(/^Length/)).toHaveValue(9.44);
    expect(deps.scan).toHaveBeenCalledTimes(1);
  });

  it('shows the real progress reported by the job and can cancel it', async () => {
    const job = deferred<ReturnType<typeof realServiceResult>>();
    let signal: AbortSignal | null = null;
    let report: (p: CvProgress) => void = () => {};
    const deps = fakeDeps({
      analyze: vi.fn((_file, _segment, onProgress, s) => {
        signal = s;
        report = onProgress;
        return job.promise;
      }),
    });
    const { user } = setup(deps);
    await chooseVideo(user);
    await user.click(screen.getByRole('button', { name: 'Track this segment' }));
    expect(vi.mocked(deps.analyze).mock.calls[0][1]).toEqual({ startSeconds: 147.2, durationSeconds: 2 });
    act(() => report({ phase: 'uploading', fraction: 0.42 }));
    expect(screen.getByRole('status', { name: 'Tracking progress' })).toHaveTextContent('Uploading the video… 42%');
    act(() => report({ phase: 'processing', stage: 'detecting and tracking', done: 120, total: 200 }));
    expect(screen.getByRole('status', { name: 'Tracking progress' })).toHaveTextContent('Detecting and tracking: frame 120 of 200');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(signal!.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Track this segment' })).toBeEnabled();
  });

  it('reports a failed job without opening the editor', async () => {
    const deps = fakeDeps({ analyze: vi.fn(async () => Promise.reject(new CvClientError('processing_error', 'The video could not be decoded.'))) });
    const { user } = setup(deps);
    await chooseVideo(user);
    await user.click(screen.getByRole('button', { name: 'Track this segment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tracking failed: The video could not be decoded.');
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });
});

describe('reviewing, correcting, saving and replaying', () => {
  it('maps teams, links a squad player, corrects observations, saves, and replays from stored data only', async () => {
    const deps = fakeDeps();
    const { user, unmount } = setup(deps);
    await trackAndReview(user);
    expect(screen.getByLabelText('Title')).toHaveValue('Tracked clip 2:27–2:29');
    expect(screen.getByLabelText('Source video')).toBeInTheDocument(); // the user's video sits beside the pitch
    expect(calibratedFrame).toBeGreaterThanOrEqual(0);

    // Nothing is assigned automatically: both colour groups start undecided.
    expect(screen.getByLabelText(/Colour group A/)).toHaveValue('');
    await user.selectOptions(screen.getByLabelText(/Colour group A/), 'home');
    expect(screen.getByLabelText(/Colour group B/)).toHaveValue(''); // still the user's call
    await user.selectOptions(screen.getByLabelText(/Colour group B/), 'away');

    await goToFrame(user, calibratedFrame);
    const homeMarkers = within(pitch()).getAllByRole('button', { name: /^Home FC: Player track/ });
    expect(homeMarkers.length).toBeGreaterThan(0);
    const chosen = homeMarkers[0];
    const trackId = chosen.getAttribute('data-track-id')!;
    await user.click(chosen);
    const detail = screen.getByRole('group', { name: /^Selected:/ });
    expect(within(detail).getByText(/At frame/)).toHaveTextContent('detected');

    // Link a squad player (home squad only).
    const options = within(within(detail).getByLabelText('Squad player')).getAllByRole('option').map((o) => o.textContent);
    expect(options.slice(1).every((o) => latest!.home.players.some((p) => `${p.shirtNumber} ${p.name}` === o))).toBe(true);
    const player = latest!.home.players[0];
    await user.selectOptions(within(detail).getByLabelText('Squad player'), player.id);
    const linked = () => within(pitch()).getByRole('button', { name: new RegExp(`^Home FC: ${player.shirtNumber} ${player.name}`) });
    expect(linked()).toHaveAttribute('data-track-id', trackId);

    // Mark the observation wrong. This is the first calibrated frame, so there is nothing before it to bridge from:
    // the marker is not drawn at all rather than guessed.
    await user.click(within(screen.getByRole('group', { name: /^Selected:/ })).getByRole('button', { name: /mark incorrect here/i }));
    expect(screen.getByRole('group', { name: /^Selected:/ })).toHaveTextContent('marked incorrect by you');
    expect(pitch().querySelector(`[data-track-id="${trackId}"]`)).toBeNull();
    await user.click(screen.getByRole('button', { name: /undo correction here/i }));
    expect(screen.getByRole('group', { name: /^Selected:/ })).toHaveTextContent(/At frame \d+: detected/);

    // Place it by hand at this frame by clicking the pitch.
    await user.click(screen.getByRole('button', { name: /move on pitch here/i }));
    const target = { x: 30, y: 20 }; // view metres (landscape)
    fireEvent.pointerDown(pitch().closest('svg')!, { ...toClient(target), pointerId: 1, button: 0 });
    expect(linked().getAttribute('aria-label')).toMatch(/placed by you$/);
    expect(screen.getByRole('group', { name: /^Selected:/ })).toHaveTextContent('placed by you');

    await user.click(screen.getByRole('button', { name: /save tracked replay/i }));
    expect(await screen.findByRole('heading', { name: 'Tracked clip 2:27–2:29' })).toBeInTheDocument();
    const saved = latest!.replays[0];
    expect(saved.origin).toBe('tracking');
    expect(saved.tracking!.teams.sideOf).toEqual({ A: 'home', B: 'away' });
    const savedTrack = saved.tracking!.tracks.find((t) => t.id === trackId)!;
    expect(savedTrack.playerId).toBe(player.id);
    expect(savedTrack.edits[String(calibratedFrame)]).toMatchObject({ kind: 'position' });
    expect(JSON.stringify(latest)).not.toMatch(/blob:|base64/); // the video is never stored

    // Playback reads stored data only: no detection, no match writes.
    const snapshot = JSON.stringify(latest);
    await user.click(screen.getByRole('button', { name: 'Play' }));
    advance(16);
    advance(500);
    expect(status()).toMatch(/^Frame (1[2-4]) of 50/);
    advance(5000); // past the end: stops
    expect(screen.getByRole('button', { name: 'Play again' })).toBeInTheDocument();
    expect(deps.analyze).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(latest)).toBe(snapshot);
    const stored = latest!;
    unmount();

    // Reopen (as after a reload): the replay plays without the video and without the service.
    const offline = fakeDeps({ analyze: vi.fn(async () => Promise.reject(new Error('must not be called'))), health: vi.fn(async () => Promise.reject(new Error('must not be called'))) });
    const second = setup(offline, JSON.parse(JSON.stringify(stored)) as Match);
    await second.user.click(screen.getByRole('button', { name: /^Play Tracked clip/ }));
    expect(screen.getByLabelText('Original video file')).toBeInTheDocument();
    await goToFrame(second.user, calibratedFrame);
    expect(within(pitch()).getByRole('img', { name: new RegExp(`^Home FC: ${player.shirtNumber} ${player.name}.*placed by you$`) })).toBeInTheDocument();
    expect(offline.analyze).not.toHaveBeenCalled();
    expect(offline.health).not.toHaveBeenCalled();
  });

  it('hides a false detection and joins two fragments of one player', async () => {
    const { user } = setup();
    await trackAndReview(user);
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const rows = within(screen.getByRole('list', { name: 'Track list' })).getAllByRole('button');
    await user.click(rows[1]);
    await user.click(screen.getByRole('button', { name: 'Hide track' }));
    expect(screen.getByRole('button', { name: 'Show track' })).toBeInTheDocument();
    // Joining two tracks seen at the same time is refused with a reason.
    const detail = screen.getByRole('group', { name: /^Selected:/ });
    const select = within(detail).getByLabelText('Same player as (join fragments)');
    const candidates = within(select).getAllByRole('option').slice(1) as HTMLOptionElement[];
    await user.selectOptions(select, candidates[0].value);
    await user.click(within(detail).getByRole('button', { name: 'Join' }));
    const outcome = within(detail).queryByRole('alert');
    if (outcome) expect(outcome).toHaveTextContent(/same time|ball/);
    else expect(screen.getByRole('group', { name: /^Selected:/ })).toHaveTextContent(/joined from/);
  });

  it('calibrates a shot by hand from clicked landmarks and uses it for positions', async () => {
    const { user } = setup();
    await trackAndReview(user);
    await user.click(screen.getByRole('tab', { name: 'Calibration' }));
    expect(screen.getByRole('region', { name: 'Pitch calibration' })).toHaveTextContent('unverified');
    await user.click(screen.getByLabelText(/Reject the automatic calibration/));
    expect(status()).toMatch(/0 shown on the pitch/);

    await user.click(screen.getByRole('button', { name: /calibrate by hand on this frame/i }));
    // A broadcast-like perspective fixed by where four landmarks appear in the 854x480 picture; the fifth follows from it.
    // jsdom's zero-size canvas maps client px 1:1 to image px.
    const seen: [string, Vec2][] = [['halfway-far', [500, 70]], ['halfway-near', [560, 460]], ['Left-box-far', [90, 120]], ['Left-box-near', [20, 300]]];
    const toImage = estimateHomography(seen.map(([id]) => LANDMARKS.find((l) => l.id === id)!.pitchM as Vec2), seen.map(([, p]) => p))!;
    for (const id of ['halfway-far', 'halfway-near', 'Left-box-far', 'Left-box-near', 'centre-spot']) {
      await user.selectOptions(screen.getByLabelText('Next landmark'), id);
      const [x, y] = applyH(toImage, LANDMARKS.find((l) => l.id === id)!.pitchM as Vec2)!;
      fireEvent.pointerDown(screen.getByTestId('video-overlay'), { clientX: x, clientY: y, pointerId: 1 });
    }
    expect(screen.getAllByTestId('landmark-mark')).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Use these 5 points' }));
    expect(screen.getByRole('region', { name: 'Pitch calibration' })).toHaveTextContent(/5 landmarks set on frame 1 · leave-one-out error 0\.0\d m/);
    expect(screen.getByRole('region', { name: 'Pitch calibration' })).toHaveTextContent('This frameyour manual calibration');
    expect(status()).not.toMatch(/ 0 shown on the pitch/);
  });
});
