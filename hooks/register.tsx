import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { DESC } from './descriptions'

const PANE = 'tool-map'
// 묶음마다 왼쪽 색 띠 (어두운 바탕에서 잘 보이는 색)
const GROUP_COLORS = ['#e879a6', '#60a5fa', '#f59e0b', '#f87171', '#34d399', '#a78bfa', '#94a3b8', '#d97757'] as const
const used = atom({ plugin: 'tool-map', key: 'used' } as const, {})
const active = atom({ plugin: 'tool-map', key: 'active' } as const, [])
const opened = atom({ plugin: 'tool-map', key: 'opened' } as const, [])
const selected = atom({ plugin: 'tool-map', key: 'selected' } as const, '')
const last = atom({ plugin: 'tool-map', key: 'last' } as const, '')

// 입력창 한 줄: 클로드 캐릭터 + 컨텍스트 날씨 + 스킬 요약 + 작업 완료 색
const CLAWD = '#d97757'
const FACE_CALM = '▐▛███▜▌'
const FACE_WORRIED = '▐▙███▟▌'
const BODY = '▝▜█████▛▘'
const LEGS = ['  ▘▘ ▝▝', '  ▝▝ ▘▘'] as const

// 작업 중에는 다리를 번갈아 그려 걷는 것처럼 보이게 한다 (모듈 안의 값이라 다시 불러오면 처음부터)
let step = 0
let stopWalk: (() => void) | null = null
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

type DoneState = { seconds: number; isAborted: boolean }

export function pickColor(sessionId: string) {
  let hash = 0
  for (const ch of sessionId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0

  return PALETTE[hash % PALETTE.length]
}

export function forecastOf(percent: number) {
  const index = FORECAST.findIndex(b => percent < b.upTo)

  return { index, ...FORECAST[index] }
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
type ModelTotal = { turns: number; tokens: number; usd: number; limitPct: number }

const lastTurn = atom({ plugin: 'tool-map', key: 'lastTurn' } as const, null as TurnCost | null)
const byModel = atom({ plugin: 'tool-map', key: 'byModel' } as const, {} as Record<string, ModelTotal>)

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
  if (n < 10000) return `${(n / 1000).toFixed(1)}천`

  return `${(n / 10000).toFixed(1)}만`
}

export function usdLabel(usd: number) {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

export function turnTokens(t: Pick<TurnCost, 'input' | 'output' | 'cacheRead' | 'cacheWrite'>) {
  return t.input + t.output + t.cacheRead + t.cacheWrite
}

// 5시간 한도 1%에 들어간 토큰 (지금까지 기록으로 낸 추정)
export function tokensPerPercent(totals: Record<string, ModelTotal>) {
  const all = Object.values(totals)
  const pct = all.reduce((sum, t) => sum + t.limitPct, 0)
  if (pct <= 0) return null

  return Math.round(all.reduce((sum, t) => sum + t.tokens, 0) / pct)
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tool-map',
      description: '설치한 스킬·MCP 지도를 세션 옆에 엽니다',
    })
    // On a reload no surface may be attached yet; /tool-map opens it then.
    if ((await $.session.surfaces()).length > 0) {
      $.ui.open({ id: PANE, title: '스킬·MCP 지도' }).catch(() => undefined)
    }
    await takeReading($)

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
    before = await readMeter($)
    stopWalk?.()
    step = 0
    stopWalk = $.clock.every(600, () => {
      step += 1
      $.ui.invalidate('ui.render')
    })

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    stopWalk?.()
    stopWalk = null
    step = 0
    await update($, done, () => ({ seconds: Math.round(e.durationMs / 1000), isAborted: e.isAborted }))
    await takeReading($)

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
    const key = `${modelLabel(turn.model)} · 노력 ${turn.effort}`
    await update($, byModel, all => {
      const was = all[key] ?? { turns: 0, tokens: 0, usd: 0, limitPct: 0 }

      return {
        ...all,
        [key]: {
          turns: was.turns + 1,
          tokens: was.tokens + turnTokens(turn),
          usd: was.usd + (turn.usd ?? 0),
          limitPct: was.limitPct + (turn.limitPct ?? 0),
        },
      }
    })

    return result
  })

  on('command.run', { command: 'tool-map' }, async $ => {
    await $.ui.open({ id: PANE, title: '스킬·MCP 지도' })

    return { text: '스킬·MCP 지도를 열었습니다.' }
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

  // Above the prompt (design A): a three-row Claude on the left, two rows of
  // status on the right. Claude walks while working and holds an umbrella in rain.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const percent = await read($, usage)
    const { Box, Button, Text } = $.ui.resolve(e)
    const counts = await read($, used)
    const running = [...new Set(await read($, active))]
    const recent = await read($, last)
    const finished = await read($, done)
    const total = ALL.filter(i => counts[keyOf(i)]).length
    const openPane = () => $.ui.open({ id: PANE, title: '스킬·MCP 지도' }).then(() => undefined)

    const me = pickColor(await $.session.id())
    const isWorking = e.props.isWorking
    const isFinished = finished !== null && !isWorking
    const forecast = forecastOf(percent ?? 0)
    const ink = isFinished ? '#ffffff' : undefined

    const side = sideIconOf(forecast.index, isFinished)
    const legs = legsOf(isWorking ? step : 0)

    const weatherLine = percent === null
      ? '날씨 확인 중'
      : `${forecast.icon} ${forecast.word}  ·  컨텍스트 ${percent}%`
    const skillLine = running.length > 0
      ? `● 실행 중: ${running.map(nameOfKey).join(', ')}`
      : `스킬·MCP 사용 ${total}${recent !== '' ? ` · 최근 ${nameOfKey(recent)}` : ''}`

    const top = isFinished
      ? `${finished.isAborted ? '⏹ 멈췄어요' : '✅ 다 했어요!'}  ${formatDuration(finished.seconds)} · ${await folderLabel($)}`
      : weatherLine
    const turn = await read($, lastTurn)
    const spent = turn === null
      ? null
      : [
          `지난 요청 · ${modelLabel(turn.model)} · 노력 ${turn.effort}`,
          `입력 ${tokenLabel(turn.input)} · 출력 ${tokenLabel(turn.output)} · 캐시 ${tokenLabel(turn.cacheRead + turn.cacheWrite)}`,
          turn.usd !== null ? usdLabel(turn.usd) : null,
          turn.limitPct !== null ? `5시간 한도 +${turn.limitPct}%` : null,
        ].filter(Boolean).join(' · ')

    const bottom = isFinished
      ? `${weatherLine}  ·  ${skillLine}`
      : isWorking
        ? `● 작업 중…  ·  ${skillLine}`
        : skillLine

    return (
      <Box flexDirection="row" columnGap={2} paddingX={1} backgroundColor={isFinished ? me.color : undefined}>
        <Box flexDirection="column">
          <Text color={CLAWD} bold>
            {' '}{faceOf(forecast.index)}{side !== '' ? ` ${side}` : ''}
          </Text>
          <Text color={CLAWD} bold>{BODY}</Text>
          <Text color={CLAWD} bold>{legs}</Text>
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
          {spent !== null && (
            <Text color={ink} dimColor={!isFinished} wrap="truncate-end">
              {spent}
            </Text>
          )}
        </Box>
        <Button key="open-map" label="지도 열기" onPress={openPane} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const counts = await read($, used)
    const running = new Set(await read($, active))
    const open = new Set(await read($, opened))
    const picked = await read($, selected)
    const models = await read($, byModel)
    const perPct = tokensPerPercent(models)
    const total = ALL.filter(i => counts[keyOf(i)]).length

    const labelOf = (item: Item) => item.label ?? shortName(item.name)

    // Pressing an item shows its line under the group; pressing it again hides it.
    const chip = (item: Item) => {
      const key = keyOf(item)
      const n = counts[key] ?? 0
      const label = labelOf(item)
      const mcp = item.kind === 'm' ? ' [MCP]' : ''
      const isPicked = picked === key
      const pick = () => update($, selected, now => (now === key ? '' : key))
      // A desktop draws its own button and drops colors inside it, so the
      // status dot sits outside the button where its color shows everywhere.
      const isRunning = running.has(key)
      const dot = isRunning ? (
        <Text color="warning" bold>●</Text>
      ) : n > 0 ? (
        <Text color="success" bold>●</Text>
      ) : (
        <Text dimColor>○</Text>
      )

      return (
        <Box key={`chip-${key}`} flexDirection="row" columnGap={1}>
          {dot}
          <Button
            key={`item-${key}`}
            onPress={pick}
            variant={isRunning || n > 0 ? 'primary' : undefined}
            dimColor={!isRunning && n === 0 && !isPicked}
          >
            {label}{mcp}{n > 0 ? ` ×${n}` : ''}
          </Button>
        </Box>
      )
    }

    const note = (shown: Item[]) => {
      const item = shown.find(i => keyOf(i) === picked)
      if (!item) return undefined

      return (
        <Text color="suggestion">
          ↳ {labelOf(item)}: {DESC[picked] ?? '설명이 아직 없습니다'}
        </Text>
      )
    }

    const titles = GROUPS.map(g => g.title)
    const openAll = () => update($, opened, () => titles)
    const closeAll = () => update($, opened, () => [])

    // Every group starts folded so the pane stays short in a small window.
    return (
      <Box flexDirection="column">
        <Text dimColor>
          <Text color="warning" bold>●</Text> 실행 중  <Text color="success" bold>●</Text> 사용함  ○ 안 씀 · {total}개 사용
        </Text>
        <Box flexDirection="row" columnGap={2}>
          <Button key="open-all" onPress={openAll}>모두 펼치기</Button>
          <Button key="close-all" onPress={closeAll}>모두 접기</Button>
        </Box>
        <Text bold>모델·노력별 사용 (이 세션)</Text>
        {Object.keys(models).length === 0 && <Text dimColor>아직 기록이 없습니다. 요청을 하나 보내면 채워집니다.</Text>}
        {Object.entries(models).map(([key, t]) => (
          <Text key={`model-${key}`}>
            <Text color="suggestion" bold>{key}</Text>
            <Text dimColor> · 요청 {t.turns}번 · {tokenLabel(t.tokens)} 토큰 · {usdLabel(t.usd)} · 5시간 한도 {t.limitPct}%</Text>
          </Text>
        ))}
        {perPct !== null && (
          <Text dimColor>추정: 5시간 한도 1% ≈ {tokenLabel(perPct)} 토큰 (100% ≈ {tokenLabel(perPct * 100)} 토큰, 지금까지 기록 기준)</Text>
        )}
        <Text dimColor>묶음을 누르면 펼쳐지고, 항목을 누르면 설명이 나옵니다</Text>
        {GROUPS.map(group => {
          const hits = group.items.filter(i => counts[keyOf(i)] || running.has(keyOf(i)))
          const color = GROUP_COLORS[GROUPS.indexOf(group) % GROUP_COLORS.length]
          // Folded, the group still shows what was used, so the colors stay visible.
          const isOpen = open.has(group.title)
          const shown = isOpen ? group.items : hits
          const toggle = () =>
            update($, opened, list =>
              list.includes(group.title) ? list.filter(t => t !== group.title) : [...list, group.title],
            )

          return (
            <Box flexDirection="column">
              <Box flexDirection="row" columnGap={1}>
                <Text color={color} bold>▌</Text>
                {/* A desktop draws a button in its own colors, so the arrow alone is
                    the button and the title beside it carries the group's color. */}
                <Button key={`fold-${group.title}`} label={isOpen ? '▼' : '▶'} onPress={toggle} />
                <Text color={color} bold>{group.title}</Text>
                <Text color={hits.length > 0 ? 'success' : undefined} dimColor={hits.length === 0} bold={hits.length > 0}>
                  {hits.length}/{group.items.length}
                </Text>
              </Box>
              {shown.length > 0 && (
                <Box flexDirection="row" flexWrap="wrap" columnGap={2}>{shown.map(chip)}</Box>
              )}
              {note(shown)}
            </Box>
          )
        })}
      </Box>
    )
  })
}
