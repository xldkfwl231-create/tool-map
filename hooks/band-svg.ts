// 입력창 위 띠를 그림(SVG) 한 장으로 그린다: 고양이와 말풍선 · 동그라미 게이지 세 개 · 쓴 스킬·MCP 칩.
// 'claude-code' 를 부르지 않는 순수 함수만 있어서 node 로도 돌려 볼 수 있다.

export type Gauge = { label: string; percent: number | null; note: string }
export type Chip = { label: string; count: number; isRunning: boolean }
export type Face = 'calm' | 'happy' | 'worried'
export type BandModel = {
  /** 고양이 말풍선 한마디: '넉넉해요' · '일하는 중이에요…' · '✅ 다 했어요! 3분 12초' */
  say: string
  /** 작업이 끝났을 때 띠 전체를 칠하는 색 (아니면 null) */
  doneColor: string | null
  folder: string
  /** '메인 ↓137' · 깃 폴더가 아니면 '' */
  branch: string
  /** '방금 시작 · 질문 1번 · $0.40' */
  session: string
  weather: { icon: string; word: string }
  face: Face
  /** 고양이 머리 옆 표시: ✨ ☂ 💦 · 없으면 '' */
  side: string
  isWorking: boolean
  step: number
  gauges: Gauge[]
  chips: Chip[]
  /** 지난 요청에 쓴 것, 가장 궁금한 것부터 */
  lastTurn: string[]
  /** '오늘 · 질문 23번 · $12.75' · 없으면 '' */
  today: string
}

// ponytail: 그림 너비는 760 고정 — 자리가 좁으면 앱이 통째로 줄여 그린다.
// 넓은 창을 꽉 채우려면 너비를 받아서 칸 너비를 다시 계산하면 된다.
const W = 760
const PAD = 12
const CHIP_H = 26
const TEXT = 13
const SMALL = 12.5
const FONT = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif"

// 어두운 화면 기준 색. 칸과 칩은 제 바탕색을 갖고, 바탕 없는 글자는 중간 회색이라
// 밝은 화면에서도 읽힌다.
const MUTED = '#8f8d85'
const USED_DOT = '#5dcaa5'
const RUN = { fill: '#633806', ink: '#fac775', dot: '#ef9f27' }
const BUBBLE = { fill: '#f6f4ec', ink: '#2b2a27' }
const TILES = [
  { fill: '#72243e', title: '#f4c0d1', note: '#ed93b1', ring: '#d4537e' },
  { fill: '#085041', title: '#9fe1cb', note: '#5dcaa5', ring: '#1d9e75' },
  { fill: '#633806', title: '#fac775', note: '#ef9f27', ring: '#ef9f27' },
] as const
// 치즈 고양이. 작업 완료 색(짙은 바탕) 위에서는 묻히지 않게 밝은 털로 바꾼다.
const CAT = { fur: '#f0a04b', stripe: '#c56f1f', cream: '#fdebcf', pink: '#f28ba4', eye: '#3b1d12' }
const CAT_ON_DONE = { fur: '#ffe0b0', stripe: '#f2ab5e', cream: '#ffffff', pink: '#f28ba4', eye: '#3b1d12' }

type Look = { fill: string; ink: string; opacity?: number; dot?: string }

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

// 글자 너비 어림: 그림 안에서는 실제 너비를 잴 수 없어 글자 종류로 어림한다 (조금 넉넉하게).
export function textWidth(text: string, size: number) {
  let em = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    if (c === 0xfe0f) continue
    if (c >= 0x1f000 || (c >= 0x2300 && c <= 0x27bf)) em += 1.35
    else if (c >= 0x1100) em += 0.95
    else if (ch === ' ') em += 0.3
    else if (/[A-Z0-9$%&@#×]/.test(ch)) em += 0.62
    else if (/[ilj.,:;'|!·]/.test(ch)) em += 0.3
    else em += 0.55
  }

  return em * size
}

// 한 줄에 칩이 몇 개 들어가는지. 다 못 넣으면 「+N개」 자리를 남긴다.
export function fitCount(widths: number[], room: number, gap: number, more: number) {
  let x = 0
  for (const [i, width] of widths.entries()) {
    const isLast = i === widths.length - 1
    if (x + width + (isLast ? 0 : gap + more) > room) return i
    x += width + gap
  }

  return widths.length
}

export function ageLabel(ms: number) {
  const min = Math.floor(ms / 60000)
  if (min < 1) return '방금 시작'
  if (min < 60) return `${min}분째`

  return min % 60 === 0 ? `${Math.floor(min / 60)}시간째` : `${Math.floor(min / 60)}시간 ${min % 60}분째`
}

export function resetLabel(ms: number) {
  const min = Math.floor(ms / 60000)
  if (min < 1) return '곧 새로'
  if (min < 60) return `${min}분 뒤 새로`
  const hours = Math.floor(min / 60)
  if (hours < 24) return min % 60 === 0 ? `${hours}시간 뒤 새로` : `${hours}시간 ${min % 60}분 뒤 새로`
  const days = Math.floor(hours / 24)

  return hours % 24 === 0 ? `${days}일 뒤 새로` : `${days}일 ${hours % 24}시간 뒤 새로`
}

const pillWidth = (label: string, hasDot: boolean) => Math.round(textWidth(label, TEXT) + 20 + (hasDot ? 14 : 0))

function pill(x: number, y: number, label: string, width: number, look: Look) {
  const lead = look.dot ? 14 : 0
  const opacity = look.opacity === undefined ? '' : ` fill-opacity="${look.opacity}"`
  const dot = look.dot ? `<circle cx="${x + 14}" cy="${y + CHIP_H / 2}" r="4" fill="${look.dot}"/>` : ''

  return (
    `<rect x="${x}" y="${y}" width="${width}" height="${CHIP_H}" rx="${CHIP_H / 2}" fill="${look.fill}"${opacity}/>${dot}` +
    `<text x="${x + 10 + lead}" y="${y + 17.5}" font-size="${TEXT}" fill="${look.ink}">${esc(label)}</text>`
  )
}

// 고양이: 가로 22칸 · 세로 16칸, 한 칸 4px. 일할 때는 앞발과 꼬리 끝을 번갈아 움직여 걷는다.
// 평소 얼굴은 5초에 한 번 눈을 깜빡인다 (그림 안 움직임을 못 그리는 화면에서는 그냥 뜬 눈).
function cat(x: number, y: number, m: { look: typeof CAT; face: Face; isWorking: boolean; step: number }) {
  const U = 4
  const c = m.look
  const at = (cx: number, cy: number, w: number, h: number) =>
    `x="${x + cx * U}" y="${y + cy * U}" width="${w * U}" height="${h * U}"`
  const r = (cx: number, cy: number, w: number, h: number, fill: string) => `<rect ${at(cx, cy, w, h)} fill="${fill}"/>`
  const lid = (cx: number) =>
    `<rect ${at(cx, 4, 2, 2)} fill="${c.fur}" opacity="0"><animate attributeName="opacity" values="0;0;1;0" keyTimes="0;0.94;0.97;1" dur="5s" repeatCount="indefinite"/></rect>`
  const isOdd = m.isWorking && m.step % 2 === 1
  const isEven = m.isWorking && m.step % 2 === 0
  const paw = (cx: number, isUp: boolean) => r(cx, 13, 2, 1, c.fur) + (isUp ? '' : r(cx, 14, 2, 1, c.cream))

  const eyes = {
    calm: [r(6, 4, 2, 3, c.eye), r(13, 4, 2, 3, c.eye), lid(6), lid(13)],
    happy: [r(5, 6, 1, 1, c.eye), r(6, 5, 2, 1, c.eye), r(8, 6, 1, 1, c.eye), r(12, 6, 1, 1, c.eye), r(13, 5, 2, 1, c.eye), r(15, 6, 1, 1, c.eye)],
    worried: [r(5, 4, 1, 1, c.eye), r(6, 3, 2, 1, c.eye), r(15, 4, 1, 1, c.eye), r(13, 3, 2, 1, c.eye), r(6, 5, 2, 2, c.eye), r(13, 5, 2, 2, c.eye)],
  }[m.face]

  return (
    '<g shape-rendering="crispEdges">' +
    // 꼬리
    r(16, 12, 4, 1, c.fur) + r(18, 12, 1, 1, c.stripe) + r(20, 10, 1, 3, c.fur) + r(isOdd ? 20 : 21, 8, 1, 2, c.fur) +
    // 몸 · 가슴 · 앞발
    r(5, 10, 11, 4, c.fur) + r(9, 10, 3, 3, c.cream) + paw(6, isOdd) + paw(13, isEven) +
    // 귀
    r(3, 0, 2, 1, c.fur) + r(3, 1, 4, 1, c.fur) + r(16, 0, 2, 1, c.fur) + r(14, 1, 4, 1, c.fur) +
    r(4, 1, 2, 1, c.pink) + r(15, 1, 2, 1, c.pink) +
    // 머리 · 이마 줄무늬 · 수염
    r(3, 2, 15, 8, c.fur) + r(8, 2, 1, 2, c.stripe) + r(10, 2, 1, 3, c.stripe) + r(12, 2, 1, 2, c.stripe) +
    r(1, 6, 2, 1, c.cream) + r(1, 8, 2, 1, c.cream) + r(18, 6, 2, 1, c.cream) + r(18, 8, 2, 1, c.cream) +
    // 주둥이 · 코 · 입
    r(8, 7, 5, 2, c.cream) + r(10, 7, 1, 1, c.pink) + r(9, 8, 1, 1, c.eye) + r(11, 8, 1, 1, c.eye) +
    eyes.join('') +
    '</g>'
  )
}

function tile(x: number, y: number, w: number, h: number, g: Gauge, look: (typeof TILES)[number]) {
  const cx = x + 42
  const cy = y + h / 2
  const R = 25
  const around = 2 * Math.PI * R
  const percent = g.percent === null ? 0 : Math.max(0, Math.min(100, g.percent))
  const ring = `cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke-width="7"`
  const arc = percent > 0
    ? `<circle ${ring} stroke="${look.ring}" stroke-linecap="round" stroke-dasharray="${((around * percent) / 100).toFixed(1)} ${around.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`
    : ''

  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${look.fill}" fill-opacity="0.9"/>` +
    `<circle ${ring} stroke="#ffffff" stroke-opacity="0.16"/>${arc}` +
    `<text x="${cx}" y="${cy + 5}" font-size="14" font-weight="bold" text-anchor="middle" fill="${look.title}">${g.percent === null ? '–' : `${g.percent}%`}</text>` +
    `<text x="${x + 84}" y="${cy - 4}" font-size="15" font-weight="bold" fill="${look.title}">${esc(g.label)}</text>` +
    `<text x="${x + 84}" y="${cy + 17}" font-size="${SMALL}" fill="${look.note}">${esc(g.note)}</text>`
  )
}

export function bandSvg(m: BandModel) {
  const isDone = m.doneColor !== null
  const ink = isDone ? '#ffffff' : MUTED
  const plain: Look = isDone ? { fill: '#000000', opacity: 0.3, ink: '#ffffff' } : { fill: '#3d3d3a', ink: '#ecebe4' }
  const parts: string[] = []
  const say = (x: number, y: number, text: string, anchor = 'start') =>
    `<text x="${x}" y="${y}" font-size="${SMALL}" text-anchor="${anchor}" fill="${ink}">${esc(text)}</text>`

  // 맨 윗줄: 고양이 말풍선 · 폴더 · 가지 · 오른쪽 끝에 세션 요약
  let x = PAD
  const headRoom = W - PAD - textWidth(m.session, SMALL) - 12
  // 자리가 모자라면 뒤에 오는 칩(가지 이름)부터 빠진다
  const head = (label: string, look: Look) => {
    const width = pillWidth(label, look.dot !== undefined)
    if (x > PAD && x + width > headRoom) return
    parts.push(pill(x, PAD, label, width, look))
    x += width + 6
  }
  // 말풍선 꼬리는 바로 아래 고양이 머리를 가리킨다
  const tailY = PAD + CHIP_H - 1
  parts.push(`<polygon points="${PAD + 30},${tailY} ${PAD + 42},${tailY} ${PAD + 34},${tailY + 8}" fill="${BUBBLE.fill}"/>`)
  head(m.say, BUBBLE)
  head(`📁 ${clip(m.folder, 18)}`, plain)
  if (m.branch !== '') head(`🌿 ${clip(m.branch, 22)}`, plain)
  parts.push(say(W - PAD, PAD + 17.5, m.session, 'end'))

  // 가운데 줄: 고양이 + 날씨, 동그라미 게이지 세 칸
  const tileY = PAD + CHIP_H + 10
  const tileH = 84
  const face = 92
  parts.push(cat(PAD + 2, tileY, {
    look: isDone ? CAT_ON_DONE : CAT,
    face: m.face,
    isWorking: m.isWorking,
    step: m.step,
  }))
  if (m.side !== '') {
    parts.push(`<text x="${PAD + 84}" y="${tileY + 14}" font-size="13" text-anchor="middle">${esc(m.side)}</text>`)
  }
  parts.push(say(PAD + face / 2, tileY + 79, `${m.weather.icon} ${m.weather.word}`, 'middle'))

  const tilesX = PAD + face + 10
  const gap = 8
  const tileW = (W - PAD - tilesX - gap * (TILES.length - 1)) / TILES.length
  TILES.forEach((look, i) => {
    const g = m.gauges[i] ?? { label: '', percent: null, note: '' }
    parts.push(tile(tilesX + i * (tileW + gap), tileY, tileW, tileH, g, look))
  })

  // 아랫줄: 쓴 스킬·MCP (노랑 쓰는 중 · 초록 쓴 것)
  const lineY = tileY + tileH + 10
  const rowY = lineY + 8
  const textY = rowY + 17.5
  parts.push(`<line x1="${PAD}" y1="${lineY}" x2="${W - PAD}" y2="${lineY}" stroke="${ink}" stroke-opacity="0.3"/>`)
  parts.push(say(PAD, textY, '스킬 · MCP'))

  const legend = [{ dot: RUN.dot, text: '쓰는 중' }, { dot: USED_DOT, text: '쓴 것' }]
  let lx = W - PAD
  for (const item of [...legend].reverse()) {
    parts.push(say(lx, textY, item.text, 'end'))
    lx -= textWidth(item.text, SMALL) + 9
    parts.push(`<circle cx="${lx}" cy="${rowY + CHIP_H / 2}" r="4" fill="${item.dot}"/>`)
    lx -= 16
  }

  x = PAD + textWidth('스킬 · MCP', SMALL) + 10
  const pills = m.chips.map(c => {
    const label = c.isRunning ? c.label : `${c.label} ×${c.count}`

    return { label, width: pillWidth(label, true), look: c.isRunning ? RUN : { ...plain, dot: USED_DOT } }
  })
  const shown = fitCount(pills.map(p => p.width), lx - x, 6, textWidth('+99개', SMALL))
  for (const p of pills.slice(0, shown)) {
    parts.push(pill(x, rowY, p.label, p.width, p.look))
    x += p.width + 6
  }
  if (m.chips.length === 0) parts.push(say(x, textY, '아직 쓴 것 없음'))
  else if (shown < m.chips.length) parts.push(say(x, textY, `+${m.chips.length - shown}개`))

  // 맨 아랫줄(있을 때만): 왼쪽에 지난 요청에 쓴 것, 오른쪽 끝에 오늘 합계.
  // 자리가 모자라면 지난 요청을 뒤에서부터 뺀다.
  let height = rowY + CHIP_H + PAD
  if (m.lastTurn.length > 0 || m.today !== '') {
    const y = rowY + CHIP_H + 20
    const room = W - PAD * 2 - (m.today === '' ? 0 : textWidth(m.today, SMALL) + 16)
    if (m.today !== '') parts.push(say(W - PAD, y, m.today, 'end'))
    if (m.lastTurn.length > 0) {
      let line = '지난 요청  '
      for (const [i, part] of m.lastTurn.entries()) {
        const next = `${line}${i > 0 ? ' · ' : ''}${part}`
        if (textWidth(next, SMALL) > room) break
        line = next
      }
      parts.push(say(PAD, y, line))
    }
    height += 20
  }

  const ground = isDone ? `<rect width="${W}" height="${height}" rx="14" fill="${m.doneColor}"/>` : ''
  const figures = m.gauges.map(g => `${g.label} ${g.percent === null ? '모름' : `${g.percent}%`}`).join(', ')

  return {
    source:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" font-family="${FONT}">` +
      `${ground}${parts.join('')}</svg>`,
    height,
    alt: [m.say, figures, m.weather.word, `쓴 스킬·MCP ${m.chips.length}개`, m.today].filter(Boolean).join(' · '),
  }
}
