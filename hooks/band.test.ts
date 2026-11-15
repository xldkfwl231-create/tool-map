import { expect, test } from 'claude-code/testing'

import { ageLabel, bandSvg, fitCount, resetLabel } from './band-svg'
import type { BandModel } from './band-svg'
import { asToday, branchLabel, catFace, dayKey, sayLine, todayLabel, usedChips } from './register'

const MODEL: BandModel = {
  say: '넉넉해요',
  doneColor: null,
  folder: '업무도구',
  branch: '메인 ↓137',
  session: '방금 시작 · 질문 1번 · $0.40',
  weather: { icon: '☀️', word: '맑음' },
  face: 'calm',
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
  today: '',
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

test('띠 그림: 고양이가 말풍선으로 말하고, 오늘 합계는 맨 아랫줄에', async () => {
  const band = bandSvg({ ...MODEL, say: '일하는 중이에요…', today: '오늘 · 질문 23번 · $12.75' })
  expect(band.source.includes('일하는 중이에요…')).toBe(true)
  expect(band.source.includes('오늘 · 질문 23번 · $12.75')).toBe(true)
  expect(band.height).toBe(bandSvg(MODEL).height + 20)
})

test('말풍선 한마디: 일하는 중 → 급한 알림 → 다 했어요 → 평소 한마디', async () => {
  const idle = { isWorking: false, doneLine: '', level: 0, limitMax: 10 }
  expect(sayLine(idle)).toBe('넉넉해요')
  expect(sayLine({ ...idle, level: 3 })).toBe('곧 요약돼요')
  expect(sayLine({ ...idle, doneLine: '✅ 다 했어요! 1분 33초' })).toBe('✅ 다 했어요! 1분 33초')
  expect(sayLine({ ...idle, doneLine: '✅ 다 했어요! 1분 33초', limitMax: 96 })).toBe('한도가 거의 찼어요')
  expect(sayLine({ ...idle, level: 4, limitMax: 96 })).toBe('새 세션을 열어 주세요')
  expect(sayLine({ ...idle, isWorking: true, level: 4 })).toBe('일하는 중이에요…')
})

test('고양이 표정: 많이 차면 걱정, 잘 끝났으면 웃음', async () => {
  expect(catFace({ isHappy: false, level: 0, limitMax: 0 })).toBe('calm')
  expect(catFace({ isHappy: true, level: 1, limitMax: 50 })).toBe('happy')
  expect(catFace({ isHappy: true, level: 3, limitMax: 50 })).toBe('worried')
  expect(catFace({ isHappy: false, level: 0, limitMax: 92 })).toBe('worried')
})

test('오늘 합계: 날짜가 바뀌면 0부터, 아무것도 없으면 안 보인다', async () => {
  const day = dayKey(new Date(2026, 10, 15, 12).getTime())
  expect(day).toBe('2026-11-15')
  expect(asToday({ date: day, prompts: 3, usd: 1.5 }, day)).toEqual({ date: day, prompts: 3, usd: 1.5 })
  expect(asToday({ date: '2026-11-14', prompts: 3, usd: 1.5 }, day)).toEqual({ date: day, prompts: 0, usd: 0 })
  expect(asToday('깨진 값', day)).toEqual({ date: day, prompts: 0, usd: 0 })
  expect(todayLabel({ date: day, prompts: 23, usd: 12.75 }, day)).toBe('오늘 · 질문 23번 · $12.75')
  expect(todayLabel({ date: day, prompts: 0, usd: 0 }, day)).toBe('')
  expect(todayLabel({ date: '2026-11-14', prompts: 5, usd: 1 }, day)).toBe('')
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
