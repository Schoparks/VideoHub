import { describe, expect, it } from 'vitest';
import { rewriteWebDash } from '../electron/playback/web-dash';
import { createMediaUrlTemplate } from '../electron/playback/url-template';

const wrap = (value: string, extra = '') => `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" ${extra}><Period>${value}</Period></MPD>`;
const rewrite = (text: string) => {
  const files: string[] = [], templates: string[] = [];
  const result = rewriteWebDash(text, 'https://media.example/root/main.mpd',
    url => { files.push(url); return `http://127.0.0.1/file/${files.length}`; },
    url => { templates.push(url); return `http://127.0.0.1/template/${templates.length}`; });
  return { result, files, templates };
};

describe('webpage DASH addressing', () => {
  it('retains independent audio/video tracks with inherited segment lists and query strings', () => {
    const { result, files } = rewrite(wrap('<BaseURL>../assets/</BaseURL><AdaptationSet><SegmentList><Initialization sourceURL="init.mp4?x=1&amp;y=2"/><SegmentURL media="part.m4s"/></SegmentList><Representation id="video"/><Representation id="audio"/></AdaptationSet>'));
    expect(files).toEqual(['https://media.example/assets/init.mp4?x=1&y=2', 'https://media.example/assets/part.m4s',
      'https://media.example/assets/init.mp4?x=1&y=2', 'https://media.example/assets/part.m4s']);
    expect(result.match(/<Representation/g)).toHaveLength(2);
    expect(result).not.toContain('media.example');
    expect(result.match(/<SegmentList/g)).toHaveLength(2);
  });

  it('binds representation identities and bandwidth while retaining numbered/timed templates', () => {
    const { templates, files } = rewrite(wrap('<AdaptationSet><SegmentTemplate media="$RepresentationID$-$Bandwidth$-$Number%05d$-$Time$.m4s" initialization="init-$RepresentationID$.mp4"/><Representation id="v1" bandwidth="1000"/></AdaptationSet>'));
    expect(templates).toEqual(['https://media.example/root/v1-1000-$Number%05d$-$Time$.m4s']);
    expect(files).toEqual(['https://media.example/root/init-v1.mp4']);
  });

  it('registers segment-base byte-range files without altering their ranges', () => {
    const { files, result } = rewrite(wrap('<AdaptationSet><Representation><BaseURL>track.mp4</BaseURL><SegmentBase indexRange="100-200"><Initialization range="0-99"/></SegmentBase></Representation></AdaptationSet>'));
    expect(files).toEqual(['https://media.example/root/track.mp4']);
    expect(result).toContain('indexRange="100-200"');
    expect(result).toContain('range="0-99"');
    expect(result).toContain('<BaseURL>http://127.0.0.1/file/1</BaseURL>');
  });

  it('merges partial template overrides and retains the closest timeline', () => {
    const { result, templates, files } = rewrite(wrap('<AdaptationSet><SegmentTemplate timescale="1000" media="$Number$.m4s" initialization="init.mp4"><SegmentTimeline><S d="2000" r="2"/></SegmentTimeline></SegmentTemplate><Representation><SegmentTemplate startNumber="5"><SegmentTimeline><S d="3000"/></SegmentTimeline></SegmentTemplate></Representation></AdaptationSet>'));
    expect(templates).toEqual(['https://media.example/root/$Number$.m4s']);
    expect(files).toEqual(['https://media.example/root/init.mp4']);
    expect(result).toContain('timescale="1000"');
    expect(result).toContain('startNumber="5"');
    expect(result).toContain('d="3000"');
    expect(result).not.toContain('d="2000"');
  });

  it('uses representation addressing ahead of a different inherited addressing mode', () => {
    const { files, templates } = rewrite(wrap('<AdaptationSet><SegmentTemplate media="$Number$.m4s"/><Representation><SegmentList><Initialization sourceURL="init.mp4"/><SegmentURL media="only.m4s"/></SegmentList></Representation></AdaptationSet>'));
    expect(files).toEqual(['https://media.example/root/init.mp4', 'https://media.example/root/only.m4s']);
    expect(templates).toEqual([]);
  });

  it('rejects protected, external-entity, malformed and unsupported manifests', () => {
    for (const text of [wrap('<ContentProtection/>'), '<!DOCTYPE MPD><MPD/>', '<MPD><Period></MPD>',
      wrap('<Representation/>'), wrap('<Representation><BaseURL>file:///secret</BaseURL><SegmentBase/></Representation>')]) {
      expect(() => rewrite(text)).toThrow();
    }
  });

  it('does not trust an alternate prefix for external XML linking', () => {
    expect(() => rewrite(wrap('<Representation xmlns:remote="http://www.w3.org/1999/xlink" remote:href="https://other.example/a"><SegmentBase/></Representation>'))).toThrow();
  });
});

describe('DASH template capabilities', () => {
  it('expands only numeric parameters without changing signed query strings or formatting', () => {
    const template = createMediaUrlTemplate('https://media.example/a-$Number%05d$-$Time$.m4s?token=abc');
    expect(template.suffix).toBe('$Number%05d$/$Time$');
    expect(template.expand(['00005', '1234'])).toBe('https://media.example/a-00005-1234.m4s?token=abc');
    for (const values of [['5'], ['../x', '1'], ['5', 'file:'], ['5', '1/2']]) expect(() => template.expand(values)).toThrow();
  });

  it('rejects unknown placeholders, userinfo and dynamic hosts', () => {
    for (const url of ['https://$Number$.example/part', 'https://media.example/$Unknown$',
      'https://user:secret@media.example/$Number$', 'file:///a-$Number$']) {
      expect(() => createMediaUrlTemplate(url)).toThrow();
    }
  });
});
