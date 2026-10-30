import { expect, test } from 'claude-code/testing'

import { effortLabel, modelLabel, tokenLabel, tokensPerPercent, usdLabel } from './register'

test('모델 이름을 읽기 쉽게', async () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-haiku-5-5')).toBe('Haiku 5.5')
})

test('노력 설정을 한국어로', async () => {
  expect(effortLabel('medium')).toBe('중간')
  expect(effortLabel('xhigh')).toBe('매우 높음')
  expect(effortLabel(undefined)).toBe('기본')
})

test('토큰과 금액 표시', async () => {
  expect(tokenLabel(950)).toBe('950')
  expect(tokenLabel(3400)).toBe('3.4천')
  expect(tokenLabel(45678)).toBe('4.6만')
  expect(usdLabel(0.183)).toBe('$0.18')
  expect(usdLabel(0.0042)).toBe('$0.0042')
})

test('5시간 한도 1%당 토큰 추정', async () => {
  expect(tokensPerPercent({})).toBe(null)
  expect(tokensPerPercent({ a: { turns: 2, tokens: 200000, usd: 1, limitPct: 4 } })).toBe(50000)
})
