import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSeasonPresets } from '../quality';
import { parseSeasonPresets } from '../schema';
import { buildIslSeason, cityFromVenue, isSamePerson } from './build';
import type { BuildInput } from './build';
import { absoluteUrl, IslParseError, parseClubList, parseFixtures, parsePlayerProfile, parseSiteDate, parseSquadPage } from './parse';
import { isAllowed, parseRobots } from './robots';

const fixture = (name: string) => readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8');
const squadHtml = fixture('squad-page.html');

describe('parseSquadPage (real page excerpt)', () => {
  const page = parseSquadPage(squadHtml);

  it('identifies the club, its competition series, venue and logo', () => {
    expect(page.clubSourceId).toBe('656');
    expect(page.clubName).toBe('Bengaluru FC');
    expect(page.seriesId).toBe('944');
    expect(page.venue).toBe('Sree Kanteerava Stadium, Bengaluru');
    expect(page.logoUrl).toBe('https://www.indiansuperleague.com/static-assets/images/club/656.png');
    expect(page.officialSiteUrl).toBe('https://www.bengalurufc.com/');
  });

  it('reads players with the number the card displays, their headshot and profile link', () => {
    const chhetri = page.players.find((p) => p.sourceId === '19150')!;
    expect(chhetri).toMatchObject({
      fullName: 'Sunil Chhetri',
      positionName: 'Forward',
      nationality: 'India',
      shirtNumber: 11,
      headshotUrl: 'https://www.indiansuperleague.com/static-assets/images/players/19150.png',
      profileUrl: 'https://www.indiansuperleague.com/players/forward-19150-sunil-chhetri-profile',
    });
    const koch = page.players.find((p) => p.sourceId === '2397')!;
    expect(koch).toMatchObject({ fullName: 'Menno Robert Maria Koch', nationality: 'Netherlands', positionName: 'Defender', shirtNumber: 3 });
    expect(page.players).toHaveLength(4);
    expect(page.warnings).toEqual([]);
  });

  it('reads the head coach and their photo', () => {
    expect(page.staff).toHaveLength(1);
    expect(page.staff[0]).toMatchObject({
      name: 'Jose Zoyo',
      role: 'Head Coach',
      nationality: 'Spain',
      photoUrl: 'https://www.indiansuperleague.com/static-assets/images/support-staff/229673.png',
    });
  });

  it('keeps a number the site publishes as -1 as "no number" and says so', () => {
    const html = squadHtml.replace('<span class="player-number">11</span>', '<span class="player-number">-1</span>');
    const parsed = parseSquadPage(html);
    const p = parsed.players.find((x) => x.sourceId === '19150')!;
    expect(p.shirtNumber).toBeNull();
    expect(p.shirtNumberText).toBe('-1');
  });

  it('flags a squad entry that has no card instead of inventing an image', () => {
    const html = squadHtml.replace(/<div class="swiper-slide squad-item(?:(?!<div class="swiper-slide squad-item)[\s\S])*?players\/forward-19150-[\s\S]*?<\/a><\/div><\/div><\/div>/, '');
    const parsed = parseSquadPage(html);
    const p = parsed.players.find((x) => x.sourceId === '19150')!;
    expect(p.headshotUrl).toBeNull();
    expect(p.profileUrl).toBeNull();
    expect(parsed.warnings.join(' ')).toContain('Sunil Chhetri');
  });

  it('fails loudly when the page is not a squad page', () => {
    expect(() => parseSquadPage('<html><body>maintenance</body></html>')).toThrow(IslParseError);
  });
});

describe('parseClubList / parseFixtures', () => {
  it('lists clubs from the switcher', () => {
    const clubs = parseClubList(squadHtml);
    expect(clubs.map((c) => [c.sourceId, c.name])).toEqual([
      ['656', 'Bengaluru FC'],
      ['3234', 'Sporting Club Delhi'],
    ]);
    expect(() => parseClubList('<html></html>')).toThrow(IslParseError);
  });

  it('reads the season label per series and the club abbreviations', () => {
    const info = parseFixtures(fixture('fixtures-page.html'));
    expect(info.seasons.get('944')).toBe('2026-27');
    expect(info.abbreviations.get('656')).toEqual({ name: 'Bengaluru FC', abbreviation: 'BFC' });
    expect(info.abbreviations.get('3234')?.abbreviation).toBe('SCD');
  });
});

describe('parsePlayerProfile', () => {
  it('reads the date of birth (DD-MM-YYYY) and skips the empty first occurrence of the data', () => {
    const profile = parsePlayerProfile(fixture('profile-page.html'), '19150');
    expect(profile).toMatchObject({ sourceId: '19150', fullName: 'Sunil Chhetri', dateOfBirth: '1984-08-03', nationality: 'India' });
  });

  it('returns no date of birth, with a note, when the page ships empty data', () => {
    const profile = parsePlayerProfile(fixture('profile-empty.html'), '77');
    expect(profile.dateOfBirth).toBeNull();
    expect(profile.notes[0]).toContain('no biography data');
    expect(() => parsePlayerProfile(fixture('profile-empty.html'))).toThrow(IslParseError);
  });

  it('refuses a profile that belongs to a different player', () => {
    expect(() => parsePlayerProfile(fixture('profile-page.html'), '999')).toThrow(/not 999/);
  });

  it('parses site dates strictly', () => {
    expect(parseSiteDate('03-08-1984 00:00:00')).toBe('1984-08-03');
    expect(parseSiteDate('31-02-1990')).toBeNull();
    expect(parseSiteDate('01-01-1900')).toBeNull();
    expect(parseSiteDate(null)).toBeNull();
    expect(parseSiteDate('1984-08-03')).toBeNull();
  });
});

describe('absoluteUrl', () => {
  it('makes site paths absolute and drops the deploy cache-buster', () => {
    expect(absoluteUrl('/static-assets/images/players/1.png?v=103.31')).toBe('https://www.indiansuperleague.com/static-assets/images/players/1.png');
    expect(absoluteUrl('/static-assets/images/club/656.png?103.31')).toBe('https://www.indiansuperleague.com/static-assets/images/club/656.png');
    expect(absoluteUrl(null)).toBeNull();
  });
});

describe('robots.txt', () => {
  const robots = parseRobots(
    ['User-agent: Twitterbot', 'Disallow:', '', 'User-agent: *', 'Allow : ', '', 'User-agent: *', 'Disallow: */page/*?loadmore=*', 'Disallow: /apiv3/*', 'Disallow: /api/*', 'Disallow: /user', 'Sitemap: https://x/s.xml'].join('\n'),
    'DizPitchPresetImporter/1.0',
  );

  it('blocks the paths the site disallows and allows club and player pages', () => {
    expect(isAllowed(robots, '/api/anything')).toBe(false);
    expect(isAllowed(robots, '/apiv3/x')).toBe(false);
    expect(isAllowed(robots, '/user')).toBe(false);
    expect(isAllowed(robots, '/clubs/656-bengaluru-fc-profile/squad')).toBe(true);
    expect(isAllowed(robots, '/players/forward-19150-sunil-chhetri-profile')).toBe(true);
    expect(robots.sitemaps).toEqual(['https://x/s.xml']);
  });

  it('uses the longest matching rule and honours Allow, wildcards, $ and crawl-delay', () => {
    const r = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*.pdf$\nCrawl-delay: 3', 'x');
    expect(isAllowed(r, '/private/secret')).toBe(false);
    expect(isAllowed(r, '/private/open/page')).toBe(true);
    expect(isAllowed(r, '/a/b.pdf')).toBe(false);
    expect(isAllowed(r, '/a/b.pdf?x=1')).toBe(true);
    expect(r.crawlDelaySeconds).toBe(3);
  });

  it('a group naming our product overrides the wildcard group', () => {
    const r = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: dizpitchpresetimporter\nDisallow: /secret', 'DizPitchPresetImporter/1.0');
    expect(isAllowed(r, '/clubs/1')).toBe(true);
    expect(isAllowed(r, '/secret')).toBe(false);
  });
});

describe('buildIslSeason', () => {
  const page = parseSquadPage(squadHtml);
  const fixtures = parseFixtures(fixture('fixtures-page.html'));
  const profiles: BuildInput['profiles'] = new Map([
    ['19150', { profile: parsePlayerProfile(fixture('profile-page.html'), '19150'), url: 'https://www.indiansuperleague.com/players/forward-19150-sunil-chhetri-profile', retrievedAt: '2026-10-12T05:00:00.000Z' }],
  ]);
  const build = (overrides: Partial<BuildInput> = {}) =>
    buildIslSeason({
      season: '2026-27',
      fixtures,
      squads: [{ club: { sourceId: '656', name: 'Bengaluru FC', path: '/clubs/656-bengaluru-fc-profile' }, page, url: 'https://www.indiansuperleague.com/clubs/656-bengaluru-fc-profile/squad', retrievedAt: '2026-10-12T05:00:00.000Z' }],
      profiles,
      generatedAt: '2026-10-12T05:10:00.000Z',
      generator: 'test',
      sources: [{ name: 'Test', url: 'https://www.indiansuperleague.com/', retrievedAt: '2026-10-12T05:00:00.000Z' }],
      ...overrides,
    });

  it('produces a schema-valid season with stable ids, source URLs and the confirmed season', () => {
    const { doc, problems } = build();
    expect(problems).toEqual([]);
    expect(parseSeasonPresets(doc)).toMatchObject({ ok: true });
    const team = doc.teams[0];
    expect(team).toMatchObject({
      id: 'isl-club-656',
      sourceId: '656',
      displayName: 'Bengaluru FC',
      abbreviation: 'BFC',
      city: 'Bengaluru',
      venue: 'Sree Kanteerava Stadium, Bengaluru',
      verification: 'official',
      coach: { name: 'Jose Zoyo', role: 'Head Coach', verification: 'official' },
    });
    expect(team.shortName).toBeNull();
    const chhetri = team.players.find((p) => p.id === 'isl-player-19150')!;
    expect(chhetri).toMatchObject({ shirtNumber: 11, position: 'Forward', dateOfBirth: '1984-08-03', verification: 'official' });
    expect(chhetri.source.url).toContain('/clubs/656-bengaluru-fc-profile/squad');
    expect(team.players.find((p) => p.id === 'isl-player-2397')!.dateOfBirth).toBeNull();
  });

  it('blocks a squad that belongs to another season or cannot be tied to one', () => {
    expect(build({ season: '2025-26' }).problems.join(' ')).toContain('not 2025-26');
    const noSeries = build({ squads: [{ ...build().doc && { club: { sourceId: '656', name: 'Bengaluru FC', path: '/clubs/656-bengaluru-fc-profile' }, page: { ...page, seriesId: null }, url: 'u', retrievedAt: '2026-10-12T05:00:00.000Z' } }] });
    expect(noSeries.problems.join(' ')).toContain('cannot be confirmed');
  });

  it('blocks a squad page that is for a different club than the one requested', () => {
    const { problems } = build({ squads: [{ club: { sourceId: '1', name: 'Other FC', path: '/clubs/1-other-profile' }, page, url: 'https://www.indiansuperleague.com/x', retrievedAt: '2026-10-12T05:00:00.000Z' }] });
    expect(problems.join(' ')).toContain('expected 1');
  });

  it('records unusable numbers as missing, with a note, never as a made-up value', () => {
    const odd = { ...page, players: page.players.map((p) => (p.sourceId === '19150' ? { ...p, shirtNumber: null, shirtNumberText: '-1' } : p)) };
    const { doc } = build({ squads: [{ club: { sourceId: '656', name: 'Bengaluru FC', path: '/clubs/656-bengaluru-fc-profile' }, page: odd, url: 'https://www.indiansuperleague.com/x', retrievedAt: '2026-10-12T05:00:00.000Z' }] });
    const p = doc.teams[0].players.find((x) => x.id === 'isl-player-19150')!;
    expect(p.shirtNumber).toBeNull();
    expect(p.notes.join(' ')).toContain('"-1"');
    expect(checkSeasonPresets(doc).some((i) => i.code === 'missing-shirt-number')).toBe(true);
  });

  it('does not call shortened forms of a name a discrepancy, but does flag a different name', () => {
    expect(isSamePerson('Menno Koch', 'Menno Robert Maria Koch')).toBe(true);
    expect(isSamePerson('Aheibam Singh', 'Aheibam Suraj Singh')).toBe(true);
    expect(isSamePerson('Ashique Kuruniyan', 'Muhammed Ashique Kuruniyan')).toBe(true);
    expect(isSamePerson('Rahul Kannoly', 'Sandesh Jhingan')).toBe(false);
    const clash = parsePlayerProfile(fixture('profile-page.html'), '19150');
    clash.fullName = 'Somebody Else';
    const { doc } = build({ profiles: new Map([['19150', { profile: clash, url: 'u', retrievedAt: '2026-10-12T05:00:00.000Z' }]]) });
    expect(doc.teams[0].players.find((p) => p.id === 'isl-player-19150')!.notes.join(' ')).toContain('Somebody Else');
  });

  it('notes when other pages of the site name the club differently', () => {
    const { doc } = build({
      squads: [{ club: { sourceId: '656', name: 'Bengaluru', path: '/clubs/656-bengaluru-fc-profile' }, page, url: 'https://www.indiansuperleague.com/x', retrievedAt: '2026-10-12T05:00:00.000Z' }],
    });
    expect(doc.teams[0].displayName).toBe('Bengaluru FC');
    expect(doc.teams[0].notes.join(' ')).toContain('"Bengaluru"');
  });

  it('derives the city from the venue line only when it has one', () => {
    expect(cityFromVenue('Kalinga Stadium, Bhubaneswar')).toBe('Bhubaneswar');
    expect(cityFromVenue('Vivekananda Yuba Bharati Krirangan, Kolkata')).toBe('Kolkata');
    expect(cityFromVenue('Kalinga Stadium')).toBeNull();
    expect(cityFromVenue(null)).toBeNull();
  });
});
