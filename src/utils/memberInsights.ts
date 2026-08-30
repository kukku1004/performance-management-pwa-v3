import type { MeetingNote, TeamMember, WorkspaceState } from '../types'
import { getMemberEvaluationHistory, getMemberProjectPerformance } from './growth'

export interface MemberInsightEvidence {
  label: string
  value: string
  detail?: string
}

export interface MemberInsight {
  id: string
  title: string
  summary: string
  question: string
  evidence: MemberInsightEvidence[]
  tone: 'positive' | 'attention' | 'neutral'
}

function gradeScore(grade: string | null) {
  return grade ? ({ S: 5, A: 4, B: 3, C: 2, D: 1 }[grade] ?? 0) : 0
}

function recentMeetingInsight(notes: MeetingNote[]): MemberInsight | null {
  const latest = [...notes].sort((a, b) => b.date.localeCompare(a.date))[0]
  if (!latest) return null
  const growth = latest.growthPoints
  const focus = growth?.challenge || growth?.improvement || growth?.careerGoal
  const normalizedComment = latest.comment.replace(/\s+/g, ' ').trim()
  const meetingSummary = normalizedComment.length > 52 ? `${normalizedComment.slice(0, 52)}…` : normalizedComment
  const growthEvidence = growth ? [
    growth.strength && { label: '강점', value: growth.strength },
    growth.improvement && { label: '보완 필요', value: growth.improvement },
    growth.challenge && { label: '다음 도전 경험', value: growth.challenge },
    growth.careerGoal && { label: 'Career Goal', value: growth.careerGoal },
  ].filter((item): item is { label: string; value: string } => Boolean(item)) : []
  return {
    id: 'recent-meeting',
    title: focus ? `지난 면담의 “${focus}”을 이어서 확인해 보세요` : `지난 면담: ${meetingSummary}`,
    summary: meetingSummary,
    question: focus ? `지난 면담에서 이야기한 “${focus}”은 지금 어떻게 진행되고 있나요?` : '지난 면담 이후 업무에서 가장 크게 달라진 점은 무엇인가요?',
    evidence: [
      { label: '지난 면담 요약', value: latest.comment },
      ...growthEvidence,
    ],
    tone: 'neutral',
  }
}

export function buildMemberInsights(workspace: WorkspaceState, teamId: string, member: TeamMember, notes: MeetingNote[]): MemberInsight[] {
  const history = getMemberEvaluationHistory(workspace, teamId, member.id)
  const latest = history[0]
  const previous = history[1]
  const project = latest ? workspace.projects.find((item) => item.id === latest.projectId) : undefined
  const performance = latest ? getMemberProjectPerformance(workspace, latest.projectId, member.id) : null
  const insights: MemberInsight[] = []

  if (latest && previous) {
    const delta = Math.round((latest.score - previous.score) * 10) / 10
    if (Math.abs(delta) >= 2) {
      const improved = delta > 0
      insights.push({
        id: 'performance-change',
        title: improved ? '최근 성과 흐름이 좋아지고 있습니다' : '최근 성과 변화를 함께 살펴볼 필요가 있습니다',
        summary: `${previous.label}보다 ${Math.abs(delta).toFixed(1)}점 ${improved ? '상승했습니다' : '낮아졌습니다'}.`,
        question: improved ? '최근 성과가 좋아진 가장 큰 이유는 무엇인가요?' : '최근 업무에서 성과를 내기 어렵게 만든 요인은 무엇이었나요?',
        evidence: [
          { label: previous.label, value: `${previous.score.toFixed(1)}점 · ${previous.grade}` },
          { label: latest.label, value: `${latest.score.toFixed(1)}점 · ${latest.grade}` },
        ],
        tone: improved ? 'positive' : 'attention',
      })
    }
  }

  const topTask = performance?.majorTasks[0]
  if (latest && topTask) {
    insights.push({
      id: 'major-task',
      title: `${topTask.name}에서 강한 기여를 보였습니다`,
      summary: `${topTask.importance} 과제에서 기여도 ${topTask.contributionPercent.toFixed(0)}%, 수행등급 ${topTask.grade}입니다.`,
      question: '이 성과를 만들 때 본인이 가장 잘했다고 생각하는 부분은 무엇인가요?',
      evidence: [
        { label: '평가기간', value: latest.label },
        { label: '주요 과제', value: topTask.name, detail: topTask.evaluationNote || '작성된 평가 근거가 없습니다.' },
        { label: '평가 결과', value: `기여도 ${topTask.contributionPercent.toFixed(0)}% · 수행등급 ${topTask.grade} · 개인점수 ${topTask.individualScore.toFixed(1)}` },
      ],
      tone: gradeScore(topTask.grade) >= 4 ? 'positive' : 'neutral',
    })
  }

  if (project) {
    const reviews = project.appState.peerReviews.filter((review) => review.targetMemberId === member.id && review.reviewerMemberId !== member.id)
    const withContribution = reviews.filter((review) => review.contributionPercent !== null)
    const averageContribution = withContribution.length ? withContribution.reduce((sum, review) => sum + (review.contributionPercent ?? 0), 0) / withContribution.length : null
    const evidence = reviews.filter((review) => review.evidence.trim())
    if (reviews.length > 0) {
      const gradeAverage = reviews.reduce((sum, review) => sum + gradeScore(review.grade), 0) / reviews.filter((review) => review.grade).length
      const positive = Number.isFinite(gradeAverage) && gradeAverage >= 4
      insights.push({
        id: 'peer-review',
        title: positive ? '동료들이 협업 기여를 긍정적으로 보고 있습니다' : '동료 관점의 협업 경험을 확인해 보세요',
        summary: `${reviews.length}건의 피어리뷰${averageContribution === null ? '' : `에서 평균 기여도 ${averageContribution.toFixed(1)}%`}가 모였습니다.`,
        question: positive ? '동료들과 효과적으로 협업할 수 있었던 방식은 무엇이었나요?' : '협업 과정에서 더 원활하게 만들고 싶은 부분은 무엇인가요?',
        evidence: [
          { label: '피어리뷰', value: `${reviews.length}건${averageContribution === null ? '' : ` · 평균 기여도 ${averageContribution.toFixed(1)}%`}` },
          ...evidence.slice(0, 4).map((review) => ({ label: review.reviewerName, value: review.grade ?? '등급 없음', detail: review.evidence })),
        ],
        tone: positive ? 'positive' : 'neutral',
      })
    }
  }

  const meeting = recentMeetingInsight(notes)
  if (meeting) insights.push(meeting)

  if (insights.length === 0) {
    insights.push({
      id: 'start-conversation',
      title: '현재 업무 경험부터 가볍게 확인해 보세요',
      summary: '아직 자동으로 요약할 성과나 피어리뷰 데이터가 충분하지 않습니다.',
      question: '최근 업무에서 가장 의미 있었던 일과 어려웠던 일은 무엇인가요?',
      evidence: [{ label: '데이터 상태', value: '성과·피어리뷰 데이터가 쌓이면 인사이트가 자동으로 표시됩니다.' }],
      tone: 'neutral',
    })
  }

  const priority = { 'performance-change': 0, 'major-task': 1, 'peer-review': 2, 'recent-meeting': 3, 'start-conversation': 4 }
  return insights.sort((a, b) => priority[a.id as keyof typeof priority] - priority[b.id as keyof typeof priority]).slice(0, 3)
}
