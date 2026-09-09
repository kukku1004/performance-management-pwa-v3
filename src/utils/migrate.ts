import type { AppState, Contribution, Criteria, MeetingNote, PeerReview, PerformanceGrade, Task, TeamMember } from '../types'
import { PERFORMANCE_GRADE_OPTIONS } from '../types'

function isPerformanceGrade(value: unknown): value is PerformanceGrade {
  return typeof value === 'string' && (PERFORMANCE_GRADE_OPTIONS as string[]).includes(value)
}

function migrateTask(raw: Record<string, unknown>): Task | null {
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
  return {
    id: raw.id,
    name: raw.name,
    importance: raw.importance as Task['importance'],
    performanceGrade: raw.performanceGrade as Task['performanceGrade'],
    workload: raw.workload as Task['workload'],
    objective: typeof raw.objective === 'string' ? raw.objective : '',
    achievement: typeof raw.achievement === 'string' ? raw.achievement : '',
  }
}

function migrateMember(raw: Record<string, unknown>): TeamMember | null {
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
  return {
    id: raw.id,
    name: raw.name,
    active: typeof raw.active === 'boolean' ? raw.active : true,
    position: typeof raw.position === 'string' ? (raw.position as TeamMember['position']) : '',
    level: typeof raw.level === 'string' ? (raw.level as TeamMember['level']) : '',
    yearsOfService: typeof raw.yearsOfService === 'number' ? raw.yearsOfService : null,
    role: typeof raw.role === 'string' ? raw.role : '',
    comment: typeof raw.comment === 'string' ? raw.comment : '',
  }
}

// Older builds stored contribution as a 0~1 ratio with no personal grade field.
function migrateContribution(raw: Record<string, unknown>): Contribution | null {
  if (typeof raw.taskId !== 'string' || typeof raw.memberId !== 'string') return null

  let contributionPercent: number
  if (typeof raw.contributionPercent === 'number') {
    contributionPercent = raw.contributionPercent
  } else if (typeof raw.contributionRatio === 'number') {
    contributionPercent = raw.contributionRatio * 100
  } else {
    contributionPercent = 0
  }

  const personalPerformanceGrade = isPerformanceGrade(raw.personalPerformanceGrade)
    ? raw.personalPerformanceGrade
    : 'B'

  return {
    taskId: raw.taskId,
    memberId: raw.memberId,
    contributionPercent,
    personalPerformanceGrade,
    evaluationNote: typeof raw.evaluationNote === 'string' ? raw.evaluationNote : typeof raw.personalGradeNote === 'string' ? raw.personalGradeNote : '',
    isAutoDistributed: raw.isAutoDistributed === true,
  }
}

function migrateMeetingNote(raw: Record<string, unknown>): MeetingNote | null {
  if (typeof raw.id !== 'string' || typeof raw.memberId !== 'string') return null
  if (typeof raw.date !== 'string' || typeof raw.comment !== 'string') return null
  return {
    id: raw.id,
    memberId: raw.memberId,
    date: raw.date,
    comment: raw.comment,
    mood: typeof raw.mood === 'string' ? raw.mood : undefined,
    growthPoints: raw.growthPoints && typeof raw.growthPoints === 'object'
      ? raw.growthPoints as MeetingNote['growthPoints']
      : undefined,
    source: raw.source === 'performance-pdf' ? 'performance-pdf' : undefined,
    sourcePeriod: typeof raw.sourcePeriod === 'string' ? raw.sourcePeriod : undefined,
    sourceFileName: typeof raw.sourceFileName === 'string' ? raw.sourceFileName : undefined,
  }
}

function migratePeerReview(raw: Record<string, unknown>): PeerReview | null {
  if (typeof raw.id !== 'string' || typeof raw.reviewerName !== 'string') return null
  if (typeof raw.targetMemberId !== 'string') return null
  return {
    id: raw.id,
    taskId: typeof raw.taskId === 'string' ? raw.taskId : '',
    reviewerMemberId: typeof raw.reviewerMemberId === 'string' ? raw.reviewerMemberId : '',
    reviewerName: raw.reviewerName,
    targetMemberId: raw.targetMemberId,
    contributionPercent: typeof raw.contributionPercent === 'number' ? raw.contributionPercent : null,
    grade: isPerformanceGrade(raw.grade) ? raw.grade : null,
    evidence: typeof raw.evidence === 'string' ? raw.evidence : '',
  }
}

// Criteria used to be plain on/off booleans; now each is a 0-100 reflection
// ratio. Reads the new numeric field if present, else falls back to the old
// boolean (true/false -> 100/0) so existing saved data keeps working, else
// the given default.
function resolveWeight(newValue: unknown, oldValue: unknown, defaultWeight: number): number {
  if (typeof newValue === 'number') return Math.max(0, Math.min(100, newValue))
  if (typeof oldValue === 'boolean') return oldValue ? 100 : 0
  return defaultWeight
}

function migrateCriteria(raw: unknown): Criteria {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    performanceGradeWeight: resolveWeight(r.performanceGradeWeight, r.usePerformanceGrade, 100),
    taskGradeWeight: resolveWeight(r.taskGradeWeight, r.useImportance, 100),
    workloadWeight: resolveWeight(r.workloadWeight, r.useWorkload, 100),
    personalGradeWeight: resolveWeight(r.personalGradeWeight, r.usePersonalPerformanceGrade, 0),
    contributionWeight: resolveWeight(r.contributionWeight, r.useContribution, 100),
    peerReviewWeight: resolveWeight(r.peerReviewWeight, r.usePeerReview, 0),
    gradeSPercent: resolveWeight(r.gradeSPercent, undefined, 10),
    gradeAPercent: resolveWeight(r.gradeAPercent, undefined, 20),
    gradeBPercent: resolveWeight(r.gradeBPercent, undefined, 40),
    gradeCPercent: resolveWeight(r.gradeCPercent, undefined, 20),
    gradeDPercent: resolveWeight(r.gradeDPercent, undefined, 10),
  }
}

// The old `createSampleData()` fixture (removed) hardcoded a real team's
// name/task info and shipped as the default state to every browser that had
// never touched localStorage. Browsers that opened the app before the fix
// and never edited anything still have that exact fixture saved. Detect it
// by name/field fingerprint (ignoring random ids) and treat it as if the
// user never entered anything, so it resets to a clean empty state instead
// of continuing to show someone else's real data.
const LEGACY_SAMPLE_TASKS = [
  { name: 'CloudX', importance: '중점', performanceGrade: 'A', workload: '대' },
  { name: 'Design System', importance: '핵심', performanceGrade: 'S', workload: '중' },
  { name: 'OneClick', importance: '일반', performanceGrade: 'B', workload: '소' },
]
const LEGACY_SAMPLE_MEMBER_FIELDS = [
  { position: '팀장', level: '과장', yearsOfService: 7, role: '기획' },
  { position: 'PL', level: '대리', yearsOfService: 4, role: '디자인' },
  { position: '팀원', level: '사원', yearsOfService: 2, role: '개발' },
]
const LEGACY_SAMPLE_CONTRIBUTION_FIELDS: Record<string, Array<[number, PerformanceGrade]>> = {
  CloudX: [[50, 'A'], [30, 'B'], [20, 'B']],
  'Design System': [[20, 'B'], [50, 'S'], [30, 'A']],
  OneClick: [[30, 'B'], [30, 'B'], [40, 'A']],
}

export function isUntouchedLegacySample(state: AppState): boolean {
  if (state.meetingNotes.length > 0 || state.peerReviews.length > 0) return false
  if (state.tasks.length !== LEGACY_SAMPLE_TASKS.length) return false
  if (state.members.length !== LEGACY_SAMPLE_MEMBER_FIELDS.length) return false
  if (state.contributions.length !== Object.values(LEGACY_SAMPLE_CONTRIBUTION_FIELDS).flat().length) return false

  const tasksMatch = LEGACY_SAMPLE_TASKS.every((fixture) =>
    state.tasks.some(
      (t) =>
        t.name === fixture.name &&
        t.importance === fixture.importance &&
        t.performanceGrade === fixture.performanceGrade &&
        t.workload === fixture.workload,
    ),
  )
  if (!tasksMatch) return false

  const membersMatch = LEGACY_SAMPLE_MEMBER_FIELDS.every((fixture) =>
    state.members.some(
      (m) =>
        m.position === fixture.position &&
        m.level === fixture.level &&
        m.yearsOfService === fixture.yearsOfService &&
        m.role === fixture.role,
    ),
  )
  if (!membersMatch) return false

  return Object.entries(LEGACY_SAMPLE_CONTRIBUTION_FIELDS).every(([taskName, fixtures]) => {
    const task = state.tasks.find((item) => item.name === taskName)
    if (!task) return false
    const actual = state.contributions
      .filter((item) => item.taskId === task.id)
      .map((item) => `${item.contributionPercent}:${item.personalPerformanceGrade}`)
      .sort()
    const expected = fixtures.map(([percent, grade]) => `${percent}:${grade}`).sort()
    return actual.length === expected.length && actual.every((value, index) => value === expected[index])
  })
}

export function migrateAppState(raw: unknown): AppState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.tasks) || !Array.isArray(r.members)) return null

  const tasks = (r.tasks as Record<string, unknown>[])
    .map(migrateTask)
    .filter((t): t is Task => t !== null)
  const members = (r.members as Record<string, unknown>[])
    .map(migrateMember)
    .filter((m): m is TeamMember => m !== null)
  const contributions = Array.isArray(r.contributions)
    ? (r.contributions as Record<string, unknown>[])
        .map(migrateContribution)
        .filter((c): c is Contribution => c !== null)
    : []
  const criteria = migrateCriteria(r.criteria)
  const meetingNotes = Array.isArray(r.meetingNotes)
    ? (r.meetingNotes as Record<string, unknown>[])
        .map(migrateMeetingNote)
        .filter((n): n is MeetingNote => n !== null)
    : []
  const peerReviews = Array.isArray(r.peerReviews)
    ? (r.peerReviews as Record<string, unknown>[])
        .map(migratePeerReview)
        .filter((p): p is PeerReview => p !== null)
    : []

  return { tasks, members, contributions, criteria, meetingNotes, peerReviews }
}
