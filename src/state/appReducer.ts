import type { AppState, Contribution, Criteria, MeetingNote, PeerReview, PerformanceGrade, Task, TeamMember } from '../types'

export type AppAction =
  | { type: 'LOAD_STATE'; payload: AppState }
  | { type: 'ADD_TASK'; payload: Task }
  | { type: 'UPDATE_TASK'; payload: Task }
  | { type: 'DELETE_TASK'; payload: { id: string } }
  | { type: 'DELETE_TASKS'; payload: { ids: string[] } }
  | { type: 'IMPORT_TASKS'; payload: Task[] }
  | { type: 'ADD_MEMBER'; payload: TeamMember }
  | { type: 'UPDATE_MEMBER'; payload: TeamMember }
  | { type: 'DELETE_MEMBER'; payload: { id: string } }
  | { type: 'DELETE_MEMBERS'; payload: { ids: string[] } }
  | { type: 'IMPORT_MEMBERS'; payload: TeamMember[] }
  | { type: 'SET_CONTRIBUTION_PERCENT'; payload: { taskId: string; memberId: string; contributionPercent: number } }
  | { type: 'SET_CONTRIBUTION_GRADE'; payload: { taskId: string; memberId: string; personalPerformanceGrade: PerformanceGrade } }
  | { type: 'SET_CONTRIBUTION_NOTE'; payload: { taskId: string; memberId: string; evaluationNote: string } }
  | { type: 'SET_CRITERIA'; payload: Partial<Criteria> }
  | { type: 'RESET_ALL' }
  | { type: 'ADD_MEETING_NOTE'; payload: MeetingNote }
  | { type: 'UPDATE_MEETING_NOTE'; payload: MeetingNote }
  | { type: 'DELETE_MEETING_NOTE'; payload: { id: string } }
  | { type: 'IMPORT_PEER_REVIEWS'; payload: PeerReview[] }
  | { type: 'DELETE_PEER_REVIEW'; payload: { id: string } }

export function createEmptyState(): AppState {
  return {
    tasks: [],
    members: [],
    contributions: [],
    meetingNotes: [],
    peerReviews: [],
    criteria: {
      performanceGradeWeight: 100,
      taskGradeWeight: 100,
      workloadWeight: 100,
      personalGradeWeight: 0,
      contributionWeight: 100,
      peerReviewWeight: 0,
      gradeSPercent: 10,
      gradeAPercent: 20,
      gradeBPercent: 40,
      gradeCPercent: 20,
      gradeDPercent: 10,
    },
  }
}

function upsertContribution(
  contributions: Contribution[],
  taskId: string,
  memberId: string,
  patch: Partial<Pick<Contribution, 'contributionPercent' | 'personalPerformanceGrade' | 'evaluationNote' | 'isAutoDistributed'>>,
): Contribution[] {
  const exists = contributions.some((c) => c.taskId === taskId && c.memberId === memberId)
  if (exists) {
    return contributions.map((c) =>
      c.taskId === taskId && c.memberId === memberId ? { ...c, ...patch } : c,
    )
  }
  return [
    ...contributions,
    {
      taskId,
      memberId,
      contributionPercent: 0,
      personalPerformanceGrade: 'B',
      ...patch,
    },
  ]
}

function distributeEqually(count: number): number[] {
  if (count <= 0) return []
  const base = Math.floor(100 / count)
  const remainder = 100 - base * count
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0))
}

// For every task whose contributions are untouched by hand (none recorded yet, or all
// still auto), (re)split its 100% evenly across the current members. Runs after any
// action that can change the task/member count, and once on app load, so this stays
// true regardless of whether a task or a member was added first, and also repairs
// data that already existed before this behavior shipped.
export function syncAutoDistribution(
  tasks: Task[],
  members: TeamMember[],
  contributions: Contribution[],
): Contribution[] {
  if (members.length === 0) return contributions

  let result = contributions
  for (const task of tasks) {
    const taskContributions = result.filter((c) => c.taskId === task.id)
    const isFullyAuto = taskContributions.every((c) => c.isAutoDistributed)
    if (!isFullyAuto) continue

    const shares = distributeEqually(members.length)
    const desired: Contribution[] = members.map((member, i) => ({
      taskId: task.id,
      memberId: member.id,
      contributionPercent: shares[i],
      personalPerformanceGrade:
        taskContributions.find((c) => c.memberId === member.id)?.personalPerformanceGrade ?? ('B' as PerformanceGrade),
      isAutoDistributed: true,
    }))

    const alreadyCorrect =
      taskContributions.length === desired.length &&
      desired.every((d) =>
        taskContributions.some((c) => c.memberId === d.memberId && c.contributionPercent === d.contributionPercent),
      )
    if (alreadyCorrect) continue

    result = [...result.filter((c) => c.taskId !== task.id), ...desired]
  }
  return result
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'LOAD_STATE':
      return action.payload

    case 'ADD_TASK': {
      const tasks = [...state.tasks, action.payload]
      return { ...state, tasks, contributions: syncAutoDistribution(tasks, state.members, state.contributions) }
    }

    case 'UPDATE_TASK':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.payload.id ? action.payload : t)),
      }

    case 'DELETE_TASK': {
      const tasks = state.tasks.filter((t) => t.id !== action.payload.id)
      const contributions = state.contributions.filter((c) => c.taskId !== action.payload.id)
      return { ...state, tasks, contributions: syncAutoDistribution(tasks, state.members, contributions) }
    }

    case 'DELETE_TASKS': {
      const ids = new Set(action.payload.ids)
      const tasks = state.tasks.filter((task) => !ids.has(task.id))
      const contributions = state.contributions.filter((contribution) => !ids.has(contribution.taskId))
      const peerReviews = state.peerReviews.filter((review) => !ids.has(review.taskId))
      return { ...state, tasks, peerReviews, contributions: syncAutoDistribution(tasks, state.members, contributions) }
    }

    case 'IMPORT_TASKS':
      return {
        ...state,
        tasks: action.payload,
        contributions: syncAutoDistribution(action.payload, state.members, state.contributions),
      }

    case 'ADD_MEMBER': {
      const members = [...state.members, action.payload]
      return { ...state, members, contributions: syncAutoDistribution(state.tasks, members, state.contributions) }
    }

    case 'UPDATE_MEMBER':
      return {
        ...state,
        members: state.members.map((m) => (m.id === action.payload.id ? action.payload : m)),
      }

    case 'DELETE_MEMBER': {
      const members = state.members.filter((m) => m.id !== action.payload.id)
      const contributions = state.contributions.filter((c) => c.memberId !== action.payload.id)
      const meetingNotes = state.meetingNotes.filter((n) => n.memberId !== action.payload.id)
      const peerReviews = state.peerReviews.filter((r) => r.targetMemberId !== action.payload.id)
      return {
        ...state,
        members,
        meetingNotes,
        peerReviews,
        contributions: syncAutoDistribution(state.tasks, members, contributions),
      }
    }

    case 'DELETE_MEMBERS': {
      const ids = new Set(action.payload.ids)
      const members = state.members.filter((member) => !ids.has(member.id))
      const contributions = state.contributions.filter((contribution) => !ids.has(contribution.memberId))
      const meetingNotes = state.meetingNotes.filter((note) => !ids.has(note.memberId))
      const peerReviews = state.peerReviews.filter((review) => !ids.has(review.targetMemberId))
      return {
        ...state,
        members,
        meetingNotes,
        peerReviews,
        contributions: syncAutoDistribution(state.tasks, members, contributions),
      }
    }

    case 'IMPORT_MEMBERS':
      return {
        ...state,
        members: action.payload,
        contributions: syncAutoDistribution(state.tasks, action.payload, state.contributions),
      }

    case 'SET_CONTRIBUTION_PERCENT': {
      const { taskId, memberId, contributionPercent } = action.payload
      return {
        ...state,
        contributions: upsertContribution(state.contributions, taskId, memberId, {
          contributionPercent,
          isAutoDistributed: false,
        }),
      }
    }

    case 'SET_CONTRIBUTION_GRADE': {
      const { taskId, memberId, personalPerformanceGrade } = action.payload
      return {
        ...state,
        contributions: upsertContribution(state.contributions, taskId, memberId, { personalPerformanceGrade }),
      }
    }

    case 'SET_CONTRIBUTION_NOTE': {
      const { taskId, memberId, evaluationNote } = action.payload
      return { ...state, contributions: upsertContribution(state.contributions, taskId, memberId, { evaluationNote }) }
    }

    case 'SET_CRITERIA':
      return { ...state, criteria: { ...state.criteria, ...action.payload } }

    case 'RESET_ALL':
      return createEmptyState()

    case 'ADD_MEETING_NOTE':
      return { ...state, meetingNotes: [...state.meetingNotes, action.payload] }

    case 'UPDATE_MEETING_NOTE':
      return {
        ...state,
        meetingNotes: state.meetingNotes.map((n) => (n.id === action.payload.id ? action.payload : n)),
      }

    case 'DELETE_MEETING_NOTE':
      return {
        ...state,
        meetingNotes: state.meetingNotes.filter((n) => n.id !== action.payload.id),
      }

    case 'IMPORT_PEER_REVIEWS':
      return { ...state, peerReviews: action.payload }

    case 'DELETE_PEER_REVIEW':
      return {
        ...state,
        peerReviews: state.peerReviews.filter((r) => r.id !== action.payload.id),
      }

    default:
      return state
  }
}
