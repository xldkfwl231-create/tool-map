import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GitState, TodayTotal } from '../types'
import { ageLabel, bandSvg, resetLabel } from './band-svg'
import type { Chip, Face, Gauge } from './band-svg'

const used = atom({ plugin: 'tool-map', key: 'used' } as const, {})
const active = atom({ plugin: 'tool-map', key: 'active' } as const, [])
const last = atom({ plugin: 'tool-map', key: 'last' } as const, '')

// 입력창 한 줄: 클로드 캐릭터 + 컨텍스트 날씨 + 스킬 요약 + 작업 완료 색
const CLAWD = '#d97757'
const FACE_CALM = '▐▛███▜▌'
const FACE_WORRIED = '▐▙███▟▌'
const BODY = '▝▜█████▛▘'
const LEGS = ['  ▘▘ ▝▝', '  ▝▝ ▘▘'] as const

// 작업 중에는 다리를 번갈아 그려 걷는 것처럼 보이게 한다 (모듈 안의 값이라 다시 불러오면 처음부터)
let step = 0
let walkTimer: { cancel: () => void } | null = null
const FORECAST = [
  { upTo: 25, icon: '☀️', word: '맑음' },
  { upTo: 50, icon: '⛅', word: '구름 조금' },
  { upTo: 75, icon: '🌧', word: '비' },
  { upTo: 90, icon: '⛈', word: '폭풍' },
  { upTo: Infinity, icon: '🌪', word: '요약 임박 · 새 세션 권장' },
] as const
const PALETTE = [
  { name: '짙은 빨강', color: '#8b1a1a' },
  { name: '짙은 파랑', color: '#1e3a8a' },
  { name: '짙은 초록', color: '#14532d' },
  { name: '짙은 보라', color: '#4c1d95' },
  { name: '짙은 주황', color: '#9a3412' },
  { name: '짙은 청록', color: '#115e59' },
  { name: '짙은 자주', color: '#831843' },
] as const
const done = atom({ plugin: 'tool-map', key: 'done' } as const, null as DoneState | null)
const usage = atom({ plugin: 'tool-map', key: 'usage' } as const, null as number | null)
// 그림 띠(데스크톱 앱)에만 쓰는 값: 질문 수, 깃 가지
const prompts = atom({ plugin: 'tool-map', key: 'prompts' } as const, 0)
const git = atom({ plugin: 'tool-map', key: 'git' } as const, null as GitState | null)
// 오늘 하루 합계(질문 수 · 쓴 돈): 세션이 바뀌어도 이어지게 $.store 에도 적는다
const today = atom({ plugin: 'tool-map', key: 'today' } as const, null as TodayTotal | null)
// 1분마다 다시 그려서 「8분 뒤 새로」 같은 남은 시간이 멈춰 있지 않게 한다
let minuteTick: { cancel: () => void } | null = null

type DoneState = { seconds: number; isAborted: boolean }

export function pickColor(sessionId: string) {
  let hash = 0
  for (const ch of sessionId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0

  return PALETTE[hash % PALETTE.length] ?? PALETTE[0]
}

export function forecastOf(percent: number) {
  const index = FORECAST.findIndex(b => percent < b.upTo)

  return { index, ...(FORECAST[index] ?? FORECAST[0]) }
}

export function faceOf(index: number) {
  return index >= 3 ? FACE_WORRIED : FACE_CALM
}

// 머리 옆 표시: 완료 ✨ > 비 ☂ > 폭풍 이상 💦
export function sideIconOf(index: number, isFinished: boolean) {
  if (isFinished) return '✨'
  if (index === 2) return '☂'
  if (index >= 3) return '💦'

  return ''
}

export function legsOf(walkStep: number) {
  return LEGS[walkStep % 2]
}

export function formatDuration(seconds: number) {
  return seconds < 60 ? `${seconds}초` : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`
}

async function folderLabel($: EngineInterface) {
  const root = await $.session.root()

  return /scratch-workspaces/i.test(root)
    ? '폴더 없음'
    : (root.split(/[\\/]/).filter(Boolean).pop() ?? root)
}

// 요청마다 쓴 토큰과 금액 (금액은 앱이 /cost로 계산하는 값의 차이)
type TurnCost = {
  model: string
  effort: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  usd: number | null
  limitPct: number | null
}

const lastTurn = atom({ plugin: 'tool-map', key: 'lastTurn' } as const, null as TurnCost | null)

// 이번 요청이 시작될 때의 값 (모듈 안의 값)
let currentModel = ''
let currentEffort: string | number | undefined
let before: { usd: number | null; limitPct: number | null } = { usd: null, limitPct: null }

const EFFORT_KO: Record<string, string> = {
  low: '낮음', medium: '중간', high: '높음', xhigh: '매우 높음', max: '최대',
}

export function effortLabel(effort: string | number | undefined) {
  if (effort === undefined) return '기본'
  if (typeof effort === 'number') return `${effort}`

  return EFFORT_KO[effort] ?? effort
}

export function modelLabel(model: string) {
  const m = /(opus|sonnet|haiku|fable)-(\d+)-(\d+)/i.exec(model)
  if (!m) return model

  return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}.${m[3]}`
}

// 1,234 → 1.2천, 45,678 → 4.6만
export function tokenLabel(n: number) {
  if (n < 1000) return `${n}`
  const short = (x: number) => x.toFixed(1).replace(/\.0$/, '')
  if (n < 10000) return `${short(n / 1000)}천`

  return `${short(n / 10000)}만`
}

export function usdLabel(usd: number) {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}


async function readMeter($: EngineInterface) {
  const { rateLimits, cost } = await $.session.usage()
  const five = rateLimits.find(r => r.kind === 'five_hour')

  return { usd: cost?.usd ?? null, limitPct: five?.percentUsed ?? null }
}

async function takeReading($: EngineInterface) {
  const { context } = await $.session.usage()
  if (!context?.window) return

  const percent = context.percent ?? Math.round(((context.tokens ?? 0) / context.window) * 100)
  await update($, usage, () => percent)
}

// 가지 이름과, 원격보다 앞선(↑) · 뒤진(↓) 커밋 수. 깃 폴더가 아니면 null.
async function takeGit($: EngineInterface) {
  const run = async (...args: string[]) => {
    const r = await $.process.run(['git', ...args], { timeoutMs: 5000 })

    return r.exitCode === 0 ? r.stdout.trim() : ''
  }
  let state: GitState | null = null
  try {
    const branch = await run('symbolic-ref', '--short', '-q', 'HEAD')
    if (branch !== '') {
      const [ahead, behind] = (await run('rev-list', '--left-right', '--count', 'HEAD...@{upstream}')).split(/\s+/)
      state = { branch, ahead: Number(ahead) || 0, behind: Number(behind) || 0 }
    }
  } catch {
    // 깃이 없거나 못 돌렸으면 가지 칩을 안 그린다
  }
  await update($, git, () => state)
}

export function dayKey(ms: number) {
  const d = new Date(ms)

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 저장해 둔 오늘 합계. 날짜가 바뀌었거나 모양이 이상하면 0부터 센다.
export function asToday(held: unknown, date: string): TodayTotal {
  const t = held as Partial<TodayTotal> | null | undefined

  return t && t.date === date && typeof t.prompts === 'number' && typeof t.usd === 'number'
    ? { date, prompts: t.prompts, usd: t.usd }
    : { date, prompts: 0, usd: 0 }
}

export function todayLabel(total: TodayTotal | null, date: string) {
  if (total === null || total.date !== date || (total.prompts === 0 && total.usd === 0)) return ''

  return [
    '오늘',
    total.prompts > 0 ? `질문 ${total.prompts}번` : '',
    total.usd > 0 ? usdLabel(total.usd) : '',
  ].filter(part => part !== '').join(' · ')
}

async function addToday($: EngineInterface, add: { prompts?: number; usd?: number }) {
  try {
    const was = asToday(await $.store.get('today'), dayKey(await $.clock.now()))
    const next = {
      date: was.date,
      prompts: was.prompts + (add.prompts ?? 0),
      usd: Math.round((was.usd + (add.usd ?? 0)) * 10000) / 10000,
    }
    // ponytail: 읽고 더해서 쓰는 사이에 다른 세션이 쓰면 그쪽 몫이 빠진다(드묾).
    // 숫자가 틀어지면 세션마다 따로 적고 보여 줄 때 합치는 방식으로 바꾼다.
    await $.store.set('today', next)
    await update($, today, () => next)
  } catch {
    // 저장소를 못 쓰면 오늘 합계만 안 나온다
  }
}

// 고양이 말풍선: 일하는 중 → 급한 알림(새 세션 · 한도) → 다 했어요 → 평소 한마디
export function sayLine(s: { isWorking: boolean; doneLine: string; level: number; limitMax: number }) {
  if (s.isWorking) return '일하는 중이에요…'
  if (s.level >= 4) return '새 세션을 열어 주세요'
  if (s.limitMax >= 95) return '한도가 거의 찼어요'
  if (s.doneLine !== '') return s.doneLine

  return ['넉넉해요', '아직 괜찮아요', '기억이 반쯤 찼어요', '곧 요약돼요'][s.level] ?? '넉넉해요'
}

// 고양이 표정: 기억이나 한도가 많이 차면 걱정, 잘 끝났으면 웃음
export function catFace(s: { isHappy: boolean; level: number; limitMax: number }): Face {
  if (s.level >= 3 || s.limitMax >= 90) return 'worried'

  return s.isHappy ? 'happy' : 'calm'
}

export function branchLabel(state: GitState | null) {
  if (state === null) return ''

  return `${state.branch}${state.behind > 0 ? ` ↓${state.behind}` : ''}${state.ahead > 0 ? ` ↑${state.ahead}` : ''}`
}

type Item = { kind: 's' | 'm'; name: string; label?: string }
type Group = { title: string; items: Item[] }

const s = (...names: string[]): Item[] => names.map(name => ({ kind: 's', name }))
const m = (name: string, label: string): Item => ({ kind: 'm', name, label })

// What the person installed first; Claude's own skills and MCPs sit folded at the end.
const GROUPS: Group[] = [
  {
    title: '디자인·UI',
    items: s(
      'design:interface-design', 'design:frontend-design', 'design:high-end-visual-design',
      'design:redesign-existing-projects', 'design:design-taste-frontend', 'design:gpt-taste',
      'motion-polish:make-interfaces-feel-better', 'motion-polish:emil-design-eng',
      'motion-polish:animation-vocabulary', 'motion-polish:find-animation-opportunities',
      'industrial-brutalist-ui', 'minimalist-ui',
    ),
  },
  {
    title: '점검·리뷰',
    items: s(
      'review-check:accessibility', 'review-check:ux-heuristics', 'review-check:codebase-design',
      'review-check:diagnosing-bugs', 'review-check:improve-codebase-architecture',
      'review-check:verification-before-completion',
    ),
  },
  {
    title: '문서·기획·발표',
    items: s(
      'anthropic-skills:ppt-work-defaults', 'anthropic-skills:senior-club-pptx',
      'plan-docs:doc-coauthoring', 'plan-docs:domain-modeling', 'plan-docs:grill-with-docs',
      'plan-docs:grilling', 'plan-docs:handoff', 'plan-docs:to-questionnaire', 'plan-docs:ux-copy',
    ),
  },
  {
    title: '개인정보·문서 보호',
    items: s('pii-redact'),
  },
  {
    title: '리서치·데이터',
    items: [
      ...s(
        'research:kosis-stats', 'research:naver-blog-research', 'research:research-synthesis',
        'data:analyze', 'data:build-dashboard', 'data:create-viz', 'data:data-context-extractor',
        'data:data-visualization', 'data:explore-data', 'data:sql-queries',
        'data:statistical-analysis', 'data:validate-data', 'data:write-query',
      ),
      m('firecrawl', '웹 검색·수집(firecrawl)'),
      m('sequential-thinking', '단계적 사고'),
    ],
  },
  {
    title: '브라우저·한글',
    items: [
      m('playwright', 'Playwright'),
      m('hwp-mcp', '한글 파일(hwp-mcp)'),
    ],
  },
  {
    title: '기타 도구',
    items: s('basic-tools:archify', 'basic-tools:find-skills'),
  },
  {
    title: 'Claude 기본',
    items: [
      ...s(
        'anthropic-skills:docs', 'anthropic-skills:docx', 'anthropic-skills:pdf',
        'anthropic-skills:pptx', 'anthropic-skills:xlsx', 'anthropic-skills:google-workspace',
        'anthropic-skills:deep-research', 'anthropic-skills:built-in-browser',
        'anthropic-skills:chrome-browser', 'anthropic-skills:computer-use',
        'anthropic-skills:skill-creator', 'anthropic-skills:consolidate-memory',
        'anthropic-skills:import-memory', 'anthropic-skills:explain-usage',
        'anthropic-skills:setup-claude', 'anthropic-skills:morning', 'anthropic-skills:schedule',
        'artifact-design', 'artifact-diagramming', 'artifact-capabilities', 'dataviz', 'code-review',
        'simplify', 'security-review', 'update-config', 'keybindings-help', 'plugin-authoring',
        'fewer-permission-prompts', 'loop', 'schedule', 'claude-api', 'workflow-authoring', 'run',
        'init',
      ),
      m('Claude_Browser', '앱 내장 브라우저'),
      m('claude-in-chrome', '크롬 확장'),
      m('computer-use', '화면 조작(computer-use)'),
      m('terminal', '터미널'),
      m('scheduled-tasks', '예약 작업'),
      m('mcp-registry', '커넥터 찾기'),
      m('1a59c906-04da-521d-bda7-7f71b9f9e01c', 'Claude Docs'),
    ],
  },
]

const ALL = GROUPS.flatMap(g => g.items)
const keyOf = (item: Item) => `${item.kind}:${item.name}`
const shortName = (name: string) => name.slice(name.indexOf(':') + 1)
const KNOWN = new Set(ALL.map(keyOf))

// The engine may name a skill with or without its plugin prefix.
const skillKey = (skill: string) => {
  const items = ALL.filter(i => i.kind === 's')
  const hit = items.find(i => i.name === skill) ?? items.find(i => shortName(i.name) === shortName(skill))

  return hit && keyOf(hit)
}

const serverOf = (tool: string) => /^mcp__(.+?)__/.exec(tool)?.[1]

const count = async ($: Parameters<typeof update>[0], key: string) => {
  await update($, used, all => ({ ...all, [key]: (all[key] ?? 0) + 1 }))
  await update($, last, () => key)
}

const BY_KEY = new Map(ALL.map(i => [keyOf(i), i]))
const nameOfKey = (key: string) => {
  const item = BY_KEY.get(key)

  return item ? (item.label ?? shortName(item.name)) : key
}

// 띠에 늘 보이는 「쓴 것」: 쓰는 중 → 방금 쓴 것 → 많이 쓴 순
export function usedChips(counts: Record<string, number>, running: string[], recent: string): Chip[] {
  const keys = [...new Set([...running, ...Object.keys(counts).filter(k => (counts[k] ?? 0) > 0)])]
  const rank = (k: string) => (running.includes(k) ? 0 : k === recent ? 1 : 2)

  return keys
    .sort((a, b) => rank(a) - rank(b) || (counts[b] ?? 0) - (counts[a] ?? 0))
    .map(k => ({ label: nameOfKey(k), count: counts[k] ?? 0, isRunning: running.includes(k) }))
}

const isPlugin = (name: string, plugin: string) => name.split('@')[0] === plugin

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await takeReading($)
    await takeGit($)
    await addToday($, {})
    minuteTick?.cancel()
    minuteTick = $.clock.every(60000, () => $.ui.invalidate('ui.render'))

    return next(e)
  })

  // 사용량이 바뀌면(요청이 끝났을 때 · 한도가 1% 움직였을 때) 동그라미를 다시 그린다
  on('session.measure', ($, e, next) => {
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      currentModel = e.model
      currentEffort = e.effort
    }

    return yield* next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, done, () => null)
    await update($, prompts, n => n + 1)
    await addToday($, { prompts: 1 })
    before = await readMeter($)
    walkTimer?.cancel()
    step = 0
    walkTimer = $.clock.every(600, () => {
      step += 1
      $.ui.invalidate('ui.render')
    })

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    walkTimer?.cancel()
    walkTimer = null
    step = 0
    await update($, done, () => ({ seconds: Math.round(e.durationMs / 1000), isAborted: e.isAborted }))
    await takeReading($)
    await takeGit($)

    const after = await readMeter($)
    const u = e.usage
    const turn: TurnCost = {
      model: u?.model ?? currentModel,
      effort: effortLabel(currentEffort),
      input: u?.input_tokens ?? 0,
      output: u?.output_tokens ?? 0,
      cacheRead: u?.cache_read_input_tokens ?? 0,
      cacheWrite: u?.cache_creation_input_tokens ?? 0,
      usd: after.usd !== null && before.usd !== null ? Math.max(0, after.usd - before.usd) : null,
      limitPct: after.limitPct !== null && before.limitPct !== null
        ? Math.max(0, after.limitPct - before.limitPct)
        : null,
    }
    await update($, lastTurn, () => turn)
    await addToday($, { usd: turn.usd ?? 0 })

    return result
  })

  on('skill.prompt', async ($, e, next) => {
    const key = skillKey(e.skill)
    if (key) await count($, key)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const server = serverOf(e.tool)
    const key = `m:${server}`
    if (server === undefined || !KNOWN.has(key)) return next(e)

    await count($, key)
    await update($, active, list => [...list, key])
    try {
      return await next(e)
    } finally {
      await update($, active, list => {
        const at = list.indexOf(key)

        return at < 0 ? list : [...list.slice(0, at), ...list.slice(at + 1)]
      })
    }
  }).catch(($, e, next) => next(e))

  // Above the prompt. Where the surface can draw a picture (the desktop app) the
  // whole band is one Svg: Claude, three ring gauges and the skills in use. On a
  // terminal it stays a three-row Claude beside rows of text.
  // Claude walks while working and looks worried when the context fills up.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const percent = await read($, usage)
    const counts = await read($, used)
    const running = [...new Set(await read($, active))]
    const recent = await read($, last)
    const finished = await read($, done)
    const chips = usedChips(counts, running, recent)

    const me = pickColor(await $.session.id())
    const isWorking = e.props.isWorking
    const isFinished = finished !== null && !isWorking
    const forecast = forecastOf(percent ?? 0)
    const side = sideIconOf(forecast.index, isFinished)
    const doneLine = finished === null
      ? ''
      : `${finished.isAborted ? '⏹ 멈췄어요' : '✅ 다 했어요!'}  ${formatDuration(finished.seconds)}`
    const turn = await read($, lastTurn)
    // Most wanted first, so a narrow window cuts the least useful part.
    const spent = turn === null
      ? []
      : [
          turn.usd !== null ? `💰 ${usdLabel(turn.usd)}` : '',
          turn.limitPct !== null ? `5시간 +${turn.limitPct}%` : '',
          `${modelLabel(turn.model)} ${turn.effort}`,
          `출력 ${tokenLabel(turn.output)}`,
          `입력 ${tokenLabel(turn.input)}`,
          `캐시 ${tokenLabel(turn.cacheRead + turn.cacheWrite)}`,
        ].filter(part => part !== '')

    // 터미널 말고는(데스크톱 · 모바일 앱) 그림을 그릴 수 있다
    if (e.surface !== 'terminal') {
      const { Box, Svg } = $.ui.resolve(e)
      const { startedAt, context, rateLimits, cost } = await $.session.usage()
      const now = await $.clock.now()
      const asked = await read($, prompts)
      const limitMax = Math.max(
        0,
        ...rateLimits.filter(r => r.kind === 'five_hour' || r.kind === 'seven_day').map(r => r.percentUsed),
      )
      const limit = (kind: string, label: string): Gauge => {
        const window = rateLimits.find(r => r.kind === kind)
        if (!window) return { label, percent: null, note: '정보 없음' }

        return {
          label,
          percent: Math.round(window.percentUsed),
          note: window.resetsAt ? resetLabel(Date.parse(window.resetsAt) - now) : '',
        }
      }
      const band = bandSvg({
        say: sayLine({ isWorking, doneLine: isFinished ? doneLine.replace('  ', ' ') : '', level: forecast.index, limitMax }),
        doneColor: isFinished ? me.color : null,
        folder: await folderLabel($),
        branch: branchLabel(await read($, git)),
        session: [
          ageLabel(now - startedAt),
          asked > 0 ? `질문 ${asked}번` : '',
          cost ? usdLabel(cost.usd) : '',
        ].filter(part => part !== '').join(' · '),
        weather: { icon: forecast.icon, word: forecast.word.split(' · ')[0] ?? '' },
        face: catFace({ isHappy: isFinished && !finished.isAborted, level: forecast.index, limitMax }),
        side: side !== '' ? side : limitMax >= 90 ? '💦' : '',
        isWorking,
        step,
        gauges: [
          {
            label: '기억',
            percent: context.percent ?? percent,
            note: context.tokens === undefined
              ? '확인 중'
              : `${tokenLabel(context.tokens)} / ${tokenLabel(context.window)}`,
          },
          limit('five_hour', '5시간'),
          limit('seven_day', '이번 주'),
        ],
        chips,
        lastTurn: spent,
        today: todayLabel(await read($, today), dayKey(now)),
      })

      return (
        <Box>
          <Svg source={band.source} alt={band.alt} />
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    const ink = isFinished ? '#ffffff' : undefined
    // On a dark done color the usual orange is hard to see: a pale peach instead.
    const body = isFinished ? '#ffd9cc' : CLAWD
    const legs = legsOf(isWorking ? step : 0)

    const weatherLine = percent === null
      ? '날씨 확인 중'
      : `${forecast.icon} ${forecast.word}  ·  컨텍스트 ${percent}%`
    const usedLine = chips.filter(c => !c.isRunning).map(c => `${c.label} ×${c.count}`).join(', ')
    const skillLine = running.length > 0
      ? `● 실행 중: ${running.map(nameOfKey).join(', ')}`
      : `스킬·MCP ${usedLine === '' ? '아직 쓴 것 없음' : usedLine}`

    const top = isFinished ? `${doneLine} · ${await folderLabel($)}` : weatherLine

    const bottom = isFinished
      ? `${weatherLine}  ·  ${skillLine}`
      : isWorking
        ? `● 작업 중…  ·  ${skillLine}`
        : skillLine

    return (
      <Box flexDirection="row" columnGap={2} paddingX={1} backgroundColor={isFinished ? me.color : undefined}>
        <Box flexDirection="column" flexShrink={0}>
          <Text color={body} bold wrap="truncate">{' '}{faceOf(forecast.index)}</Text>
          <Text color={body} bold wrap="truncate">{BODY}</Text>
          <Text color={body} bold wrap="truncate">{legs}</Text>
        </Box>
        {/* The sign beside the head sits in a column of its own: an emoji's width
            is not the same on every surface, and inside the head row it wrapped. */}
        <Box flexDirection="column" flexShrink={0} width={2}>
          <Text>{side}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Text color={ink} bold wrap="truncate-end">{top}</Text>
          <Text
            color={isFinished ? ink : isWorking || running.length > 0 ? 'warning' : undefined}
            dimColor={!isFinished && !isWorking && running.length === 0}
            wrap="truncate-end"
          >
            {bottom}
          </Text>
          {spent.length > 0 && (
            <Text color={ink} dimColor={!isFinished} wrap="truncate-end">
              {spent.join(' · ')}
            </Text>
          )}
        </Box>
      </Box>
    )
  })

  // The Desktop Statusline plugin draws the same figures in English. Where this
  // band is a picture that already shows them, its row is left out of the band.
  on('ui.render', { component: 'AbovePromptList' }, ($, e, next) => {
    const rows = e.props.rows
    const isPicture = e.surface !== 'terminal' && rows.some(row => isPlugin(row.plugin, 'tool-map'))
    if (!isPicture) return next(e)

    return next({
      ...e,
      props: { ...e.props, rows: rows.filter(row => !isPlugin(row.plugin, 'desktop-statusline')) },
    })
  })
}
