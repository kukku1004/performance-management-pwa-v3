export type Importance = '중점' | '핵심' | '일반' | '지원'
export type PerformanceGrade = 'S' | 'A' | 'B' | 'C' | 'D'
export type Workload = '대' | '중' | '소'
export type EvaluationGrade = 'S' | 'A' | 'B' | 'C' | 'D'
export type Position = '팀장' | 'PM' | 'PL' | '팀원'
export type Level = '사원' | '대리' | '과장' | '차장'

export interface Task {
  id: string
  name: string
  importance: Importance
  performanceGrade: PerformanceGrade
  workload: Workload
  objective: string
  achievement: string
}

export interface TeamMember {
  id: string
  name: string
  active: boolean
  position: Position | ''
  level: Level | ''
  yearsOfService: number | null
  role: string
  comment: string
}

export interface Contribution {
  taskId: string
  memberId: string
  contributionPercent: number
  personalPerformanceGrade: PerformanceGrade
  evaluationNote?: string
  // true = still an auto equal-split value, safe to redistribute on the next ADD_MEMBER
  isAutoDistributed?: boolean
}

export interface MeetingNote {
  id: string
  memberId: string
  date: string
  comment: string
  mood?: string
  growthPoints?: {
    strength: string
    improvement: string
    challenge: string
    careerGoal: string
  }
}

export interface PeerReview {
  id: string
  taskId: string
  reviewerMemberId: string
  reviewerName: string
  targetMemberId: string
  contributionPercent: number | null
  grade: PerformanceGrade | null
  evidence: string
}

export interface Criteria {
  // Each is a 0-100 reflection ratio: 0 = no effect (neutral baseline), 100 = full effect.
  performanceGradeWeight: number
  taskGradeWeight: number
  workloadWeight: number
  personalGradeWeight: number
  contributionWeight: number
  peerReviewWeight: number
  gradeSPercent: number
  gradeAPercent: number
  gradeBPercent: number
  gradeCPercent: number
  gradeDPercent: number
}

export interface AppState {
  tasks: Task[]
  members: TeamMember[]
  contributions: Contribution[]
  criteria: Criteria
  meetingNotes: MeetingNote[]
  peerReviews: PeerReview[]
}

export type EvaluationPeriodType = 'half' | 'quarter' | 'annual' | 'custom'

export interface EvaluationPeriod {
  year: number
  type: EvaluationPeriodType
  value: string
  startDate?: string
  endDate?: string
}

export interface Team {
  id: string
  name: string
  members: TeamMember[]
  growthProfiles: MemberGrowthProfile[]
  meetingNotes: MeetingNote[]
  createdAt: string
}

export interface MemberGrowthProfile {
  memberId: string
  promotionReviewDate: string
  promotionTargetScore: number
  growthMemo: string
  personalNotes?: Array<string | MemberPersonalNote>
  positionYears?: number
  performanceHistory?: GrowthPerformanceRecord[]
  auxiliaryMetrics?: GrowthAuxiliaryMetrics
}

export interface MemberPersonalNote {
  id: string
  content: string
  color: 'gray' | 'orange' | 'blue' | 'green' | 'violet'
  starred?: boolean
}

export interface GrowthPerformanceRecord {
  year: number
  firstHalf: EvaluationGrade | null
  secondHalf: EvaluationGrade | null
  competency: EvaluationGrade | null
}

export interface GrowthAuxiliaryMetrics {
  position: number
  rewardPenalty: number
  tenure: number
  education: number
}

export interface EvaluationProject {
  id: string
  teamId: string
  period: EvaluationPeriod
  createdAt: string
  updatedAt: string
  appState: AppState
}

export interface WorkspaceState {
  schemaVersion: 1
  teams: Team[]
  projects: EvaluationProject[]
  activeProjectId: string | null
}

export const IMPORTANCE_OPTIONS: Importance[] = ['중점', '핵심', '일반', '지원']
export const PERFORMANCE_GRADE_OPTIONS: PerformanceGrade[] = ['S', 'A', 'B', 'C', 'D']
export const WORKLOAD_OPTIONS: Workload[] = ['대', '중', '소']
export const POSITION_OPTIONS: Position[] = ['팀장', 'PM', 'PL', '팀원']
export const LEVEL_OPTIONS: Level[] = ['사원', '대리', '과장', '차장']
