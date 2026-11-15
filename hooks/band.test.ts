import { expect, test } from 'claude-code/testing'

import { ageLabel, bandSvg, fitCount, resetLabel } from './band-svg'
import type { BandModel } from './band-svg'
import { branchLabel, usedChips } from './register'

const MODEL: BandModel = {
  state: '',
  doneColor: null,
  folder: '업무도구',
  branch: '메인 ↓137',
  session: '방금 시작 · 질문 1번 · $0.40',
  weather: { icon: '☀️', word: '맑음', level: 0 },
  side: '',
  isWorking: false,
  step: 0,
  gauges: [
    { label: '기억', percent: 10, note: '9.6만 / 100만' },
    { label: '5시간', percent: 10, note: '8분 뒤 새로' },
    { label: '이번 주', percent: 32, note: '5일 뒤 새로' },
  ],
  chips: [],
  lastTurn: [],
}

test('세션 나이를 우리말로', async () => {
  expect(ageLabel(20 * 1000)).toBe('방금 시작')
  expect(ageLabel(12 * 60000)).toBe('12분째')
  expect(ageLabel(120 * 60000)).toBe('2시간째')
  expect(ageLabel(65 * 60000)).toBe('1시간 5분째')
})

test('한도가 새로 채워질 때까지 남은 시간', async () => {
  expect(resetLabel(-5)).toBe('곧 새로')
  expect(resetLabel(8 * 60000)).toBe('8분 뒤 새로')
  expect(resetLabel(130 * 60000)).toBe('2시간 10분 뒤 새로')
  expect(resetLabel(5 * 24 * 3600000)).toBe('5일 뒤 새로')
  expect(resetLabel((5 * 24 + 3) * 3600000)).toBe('5일 3시간 뒤 새로')
})

test('칩이 한 줄에 다 안 들어가면 「+N개」 자리를 남긴다', async () => {
  expect(fitCount([100, 100, 100], 400, 6, 40)).toBe(3)
  expect(fitCount([100, 100, 100], 260, 6, 40)).toBe(2)
  expect(fitCount([100, 100, 100], 240, 6, 40)).toBe(1)
  expect(fitCount([], 100, 6, 40)).toBe(0)
})

test('띠 그림: 아무것도 안 썼을 때 안내가 나온다', async () => {
  const band = bandSvg(MODEL)
  expect(band.source.includes('아직 쓴 것 없음')).toBe(true)
  expect(band.source.includes('지난 요청')).toBe(false)
  expect(band.alt.includes('이번 주 32%')).toBe(true)
})

test('띠 그림: 이름에 든 기호가 그림을 깨지 않는다', async () => {
  const band = bandSvg({
    ...MODEL,
    folder: 'A&B <test>',
    chips: [{ label: 'a"b', count: 2, isRunning: false }],
    lastTurn: ['💰 $0.18'],
  })
  expect(band.source.includes('A&amp;B &lt;test&gt;')).toBe(true)
  expect(band.source.includes('a&quot;b ×2')).toBe(true)
  expect(band.source.includes('지난 요청')).toBe(true)
  expect(band.height).toBe(bandSvg(MODEL).height + 20)
})

test('띠 그림: 모르는 값은 줄표로', async () => {
  const band = bandSvg({ ...MODEL, gauges: [{ label: '기억', percent: null, note: '확인 중' }] })
  expect(band.alt.includes('기억 모름')).toBe(true)
})

test('가지 이름 옆에 뒤진 · 앞선 커밋 수', async () => {
  expect(branchLabel(null)).toBe('')
  expect(branchLabel({ branch: '메인', ahead: 0, behind: 0 })).toBe('메인')
  expect(branchLabel({ branch: '메인', ahead: 2, behind: 137 })).toBe('메인 ↓137 ↑2')
})

test('쓴 것 순서: 쓰는 중 → 방금 쓴 것 → 많이 쓴 순', async () => {
  const chips = usedChips(
    { 'm:playwright': 5, 'm:firecrawl': 1, 'm:hwp-mcp': 2 },
    ['m:hwp-mcp'],
    'm:firecrawl',
  )
  expect(chips.map(c => c.label)).toEqual(['한글 파일(hwp-mcp)', '웹 검색·수집(firecrawl)', 'Playwright'])
  expect(chips[0]?.isRunning).toBe(true)
  expect(chips[2]?.count).toBe(5)
})

const BAND = {
  plugin: 'tool-map',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('데스크톱에서는 그림 한 장, 터미널에서는 글자로 그린다', async ($, on) => {
  // 엔진 대신 대답해 주는 자리
  on('session.id', () => ({ value: 'abc' }))
  on('session.root', () => ({ value: 'C:/work/업무도구' }))
  on('clock.now', () => ({ value: 60000 }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 1000000, tokens: 96000, percent: 10 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 10, resetsAt: '2030-01-01T00:00:00Z' }],
      cost: { usd: 0.4 },
    },
  }))

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const picture = await desktop.find({ type: 'Svg' })
  expect(picture?.type).toBe('Svg')
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await terminal.find({ type: 'Text', text: /스킬·MCP/ }))?.text).toBe('스킬·MCP 아직 쓴 것 없음')
  await terminal.unmount()
})
