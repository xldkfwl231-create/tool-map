import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { DESC } from './descriptions'

const PANE = 'tool-map'
const used = atom({ plugin: 'tool-map', key: 'used' } as const, {})
const active = atom({ plugin: 'tool-map', key: 'active' } as const, [])
const opened = atom({ plugin: 'tool-map', key: 'opened' } as const, [])
const selected = atom({ plugin: 'tool-map', key: 'selected' } as const, '')
const last = atom({ plugin: 'tool-map', key: 'last' } as const, '')

// 입력창 한 줄: 클로드 캐릭터 + 컨텍스트 날씨 + 스킬 요약 + 작업 완료 색
const CLAWD = '#d97757'
const FACE_CALM = '▐▛███▜▌'
const FACE_WORRIED = '▐▙███▟▌'
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

export function formatDuration(seconds: number) {
  return seconds < 60 ? `${seconds}초` : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`
}

async function folderLabel($: EngineInterface) {
  const root = await $.session.root()

  return /scratch-workspaces/i.test(root)
    ? '폴더 없음'
    : (root.split(/[\\/]/).filter(Boolean).pop() ?? root)
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
    $.ui.open({ id: PANE, title: '스킬·MCP 지도' }).catch(() => undefined)
    await takeReading($)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, done, () => null)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    await update($, done, () => ({ seconds: Math.round(e.durationMs / 1000), isAborted: e.isAborted }))
    await takeReading($)

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

  // One line above the prompt, shown even while the pane is closed:
  // Claude's face, the context weather, the skill summary, and the done color.
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
    const isFinished = finished !== null && !e.props.isWorking
    const forecast = percent === null ? null : forecastOf(percent)

    const status = e.props.isWorking
      ? '작업 중…'
      : isFinished
        ? `${finished.isAborted ? '⏹ 중단됨' : '✅ 완료'} · ${await folderLabel($)} · ${formatDuration(finished.seconds)}`
        : null

    return (
      <Box backgroundColor={isFinished ? me.color : undefined} paddingX={1} columnGap={1}>
        {forecast !== null && (
          <Text color={CLAWD} bold>{faceOf(forecast.index)}</Text>
        )}
        {forecast !== null && (
          <Text color={isFinished ? '#ffffff' : undefined} bold={isFinished}>
            {forecast.icon} {forecast.word} {percent}%
          </Text>
        )}
        <Text wrap="truncate-end">
          <Text color={isFinished ? '#ffffff' : 'success'} bold> 스킬·MCP ● 사용 {total}</Text>
          {running.length > 0 && (
            <Text color={isFinished ? '#ffffff' : 'warning'} bold> · ● 실행 중: {running.map(nameOfKey).join(', ')}</Text>
          )}
          {running.length === 0 && recent !== '' && <Text dimColor={!isFinished}> · 최근: {nameOfKey(recent)}</Text>}
          {status !== null && <Text color={isFinished ? '#ffffff' : undefined} bold={isFinished}> · {status}</Text>}
        </Text>
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
      const text = running.has(key) ? (
        <Text color="warning" bold underline={isPicked}>● {label}{mcp}</Text>
      ) : n > 0 ? (
        <Text color="success" bold underline={isPicked}>● {label}{mcp} ×{n}</Text>
      ) : (
        <Text dimColor={!isPicked} underline={isPicked}>○ {label}{mcp}</Text>
      )

      return <Button key={`item-${key}`} onPress={pick}>{text}</Button>
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
        <Text dimColor>묶음을 누르면 펼쳐지고, 항목을 누르면 설명이 나옵니다</Text>
        {GROUPS.map(group => {
          const hits = group.items.filter(i => counts[keyOf(i)] || running.has(keyOf(i)))
          const head = (
            <Text bold>
              {group.title} <Text dimColor>({hits.length}/{group.items.length})</Text>
            </Text>
          )

          // Folded, the group still shows what was used, so the colors stay visible.
          const isOpen = open.has(group.title)
          const shown = isOpen ? group.items : hits
          const toggle = () =>
            update($, opened, list =>
              list.includes(group.title) ? list.filter(t => t !== group.title) : [...list, group.title],
            )

          return (
            <Box flexDirection="column">
              <Button key={`fold-${group.title}`} onPress={toggle}>
                {isOpen ? '▼' : '▶'} {head}
              </Button>
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
