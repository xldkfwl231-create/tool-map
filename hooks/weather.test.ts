import { expect, test } from 'claude-code/testing'

import { faceOf, forecastOf, formatDuration } from './register'

test('사용률에 따라 날씨가 바뀐다', async () => {
  expect(forecastOf(10).word).toBe('맑음')
  expect(forecastOf(60).word).toBe('비')
  expect(forecastOf(95).word).toBe('요약 임박 · 새 세션 권장')
})

test('폭풍 이상이면 걱정하는 얼굴', async () => {
  expect(faceOf(0)).toBe('▐▛███▜▌')
  expect(faceOf(4)).toBe('▐▙███▟▌')
})

test('시간 표시', async () => {
  expect(formatDuration(192)).toBe('3분 12초')
})
