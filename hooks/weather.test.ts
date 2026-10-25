import { expect, test } from 'claude-code/testing'

import { faceOf, forecastOf, formatDuration, legsOf, sideIconOf } from './register'

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

test('걷기: 다리가 번갈아 바뀐다', async () => {
  expect(legsOf(0)).not.toBe(legsOf(1))
  expect(legsOf(2)).toBe(legsOf(0))
})

test('머리 옆 표시: 완료 > 비 > 폭풍', async () => {
  expect(sideIconOf(2, false)).toBe('☂')
  expect(sideIconOf(2, true)).toBe('✨')
  expect(sideIconOf(3, false)).toBe('💦')
  expect(sideIconOf(0, false)).toBe('')
})
