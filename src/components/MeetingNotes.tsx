import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useAppState } from '../state/AppContext'
import type { MeetingNote, TeamMember } from '../types'
import { useWorkspace } from '../state/WorkspaceContext'
import { getMemberEvaluationHistory } from '../utils/growth'
import { buildMemberInsights } from '../utils/memberInsights'
import ConfirmDialog from './ConfirmDialog'
import MeetingNotesFocusPreview from './MeetingNotesFocusPreview'

function todayString() { return new Date().toISOString().slice(0, 10) }
const EMPTY_GROWTH_POINTS = { strength: '', improvement: '', challenge: '', careerGoal: '' }
const SAMPLE_MEETING_SCENARIOS = [
  {
    mood: '🙂',
    recent: '주요 논의: 최근 핵심 과제에서 성과 흐름이 좋아진 원인과 본인이 주도한 부분을 확인함.\n팀원 의견: 초기에 이해관계자 요구를 정리한 뒤 작업 순서를 합의한 것이 재작업을 줄이는 데 도움이 되었다고 함.\n팀장 의견: 결과뿐 아니라 협업 방식을 팀에 공유해 반복 가능한 강점으로 만들 필요가 있음.\n후속 확인사항: 다음 월간 회의에서 업무 정리 방식을 10분간 공유하기로 함.',
    previous: '주요 논의: 업무 범위가 넓어질 때 우선순위 판단이 늦어지는 문제를 점검함.\n팀원 의견: 요청을 모두 처리하려다 중요한 업무의 집중 시간이 줄어든다고 느낌.\n팀장 의견: 중요도와 마감 영향을 기준으로 먼저 제외할 일을 정하는 연습이 필요함.\n후속 확인사항: 매주 월요일 우선순위 3개를 합의하고 금요일에 결과를 확인하기로 함.',
    growth: { strength: '복잡한 요구사항을 구조화하고 관계자 합의를 이끄는 능력', improvement: '동시에 들어오는 요청의 우선순위를 빠르게 조정하는 판단', challenge: '다음 과제에서 초기 범위 정의와 중간 리뷰를 직접 운영', careerGoal: '프로젝트 리딩 경험을 확장해 차기 역할을 준비' },
  },
  {
    mood: '😊',
    recent: '주요 논의: 산출물 완성도와 협업 과정에서 잘된 점을 돌아봄.\n팀원 의견: 초안 단계에서 동료 피드백을 일찍 받아 품질을 높일 수 있었다고 함.\n팀장 의견: 세밀한 검토 역량이 강점이며, 판단 근거를 더 간결하게 설명하면 영향력이 커질 것임.\n후속 확인사항: 다음 리뷰부터 핵심 의사결정 근거를 세 문장으로 정리하기로 함.',
    previous: '주요 논의: 본인이 맡은 영역은 안정적이지만 회의에서 의견을 늦게 내는 경향을 이야기함.\n팀원 의견: 충분히 검토한 뒤 말하려다 논의 시점을 놓치는 경우가 있다고 함.\n팀장 의견: 완성된 답보다 초기 가설을 먼저 공유해도 된다는 기준을 합의함.\n후속 확인사항: 주간 회의마다 최소 한 번 대안이나 우려 사항을 제안하기로 함.',
    growth: { strength: '높은 완성도와 사용자 관점의 꼼꼼한 검토', improvement: '초기 단계에서 의견과 가설을 빠르게 공유하는 습관', challenge: '다음 리뷰 세션의 진행과 의사결정 기록 담당', careerGoal: '전문성을 바탕으로 동료의 품질 기준을 높이는 역할' },
  },
  {
    mood: '😐',
    recent: '주요 논의: 최근 업무량 증가로 집중도가 떨어지는 구간과 지원이 필요한 부분을 확인함.\n팀원 의견: 긴급 요청이 반복되면서 계획 업무를 마무리하기 어렵고 피로도가 높아졌다고 함.\n팀장 의견: 개인의 속도 문제가 아니라 업무 유입 관리 문제로 보고 요청 창구와 우선순위를 정리하기로 함.\n후속 확인사항: 2주 동안 긴급 요청 건수와 소요 시간을 기록한 뒤 업무 배분을 재조정하기로 함.',
    previous: '주요 논의: 새로운 업무 영역을 맡으면서 생긴 학습 부담과 진행 상황을 점검함.\n팀원 의견: 기술 이해에는 진전이 있으나 질문할 시점을 판단하기 어렵다고 함.\n팀장 의견: 30분 이상 막히면 질문한다는 기준을 정하고 참고할 동료를 연결함.\n후속 확인사항: 매주 학습 내용과 막힌 지점을 짧게 공유하기로 함.',
    growth: { strength: '낯선 영역에서도 끝까지 파고들어 문제를 해결하는 책임감', improvement: '업무 과부하를 조기에 알리고 도움을 요청하는 커뮤니케이션', challenge: '반복되는 긴급 요청을 유형화하고 개선안을 제안', careerGoal: '안정적으로 담당 영역을 운영하는 핵심 실무자' },
  },
  {
    mood: '🙂',
    recent: '주요 논의: 맡은 업무의 독립성과 다음 단계에서 필요한 의사결정 경험을 이야기함.\n팀원 의견: 실행은 자신 있지만 방향을 결정할 때 승인에 의존하는 편이라고 느낌.\n팀장 의견: 영향이 제한적인 결정부터 직접 선택하고 결과를 회고하는 방식으로 권한을 넓히기로 함.\n후속 확인사항: 다음 과제에서 한 개 영역의 일정과 품질 결정을 직접 맡기로 함.',
    previous: '주요 논의: 협업 과정에서 요청 사항이 자주 바뀌어 생기는 어려움을 점검함.\n팀원 의견: 변경 이유를 충분히 알지 못하면 우선순위를 잡기 어렵다고 함.\n팀장 의견: 요청을 받으면 목적, 마감, 성공 기준을 먼저 확인하는 질문 목록을 사용하기로 함.\n후속 확인사항: 변경 요청 세 건에 질문 목록을 적용해 효과를 확인하기로 함.',
    growth: { strength: '약속한 일정과 품질을 안정적으로 지키는 실행력', improvement: '불확실한 상황에서 스스로 판단하고 결정하는 자신감', challenge: '소규모 업무 단위의 일정·품질 책임자 역할', careerGoal: '독립적으로 과제를 이끌 수 있는 프로젝트 담당자' },
  },
  {
    mood: '😊',
    recent: '주요 논의: 팀 적응 과정에서 잘된 점과 더 빠르게 성장하기 위해 필요한 지원을 확인함.\n팀원 의견: 업무 맥락을 설명해 주는 동료 덕분에 적응이 빨랐고 실제 과제를 더 맡아보고 싶다고 함.\n팀장 의견: 질문과 학습 속도가 강점이며, 작업 결과를 스스로 점검하는 기준을 만들어야 함.\n후속 확인사항: 다음 달까지 작은 개선 과제를 처음부터 끝까지 수행하고 회고하기로 함.',
    previous: '주요 논의: 입사 초기 업무 이해도와 협업 시 어려운 점을 확인함.\n팀원 의견: 용어와 의사결정 배경이 익숙하지 않아 회의 내용을 따라가기 어렵다고 함.\n팀장 의견: 핵심 문서와 담당 동료를 안내하고 회의 후 질문 시간을 보장하기로 함.\n후속 확인사항: 주 1회 20분 체크인으로 궁금한 점과 학습 내용을 확인하기로 함.',
    growth: { strength: '빠른 학습 속도와 피드백을 바로 적용하는 태도', improvement: '완료 기준을 스스로 점검하고 결과를 설명하는 능력', challenge: '작은 개선 과제를 단독으로 계획하고 완료', careerGoal: '담당 업무를 독립적으로 수행하는 팀의 안정적인 구성원' },
  },
]

export default function MeetingNotes() {
  const { state } = useAppState()
  const { workspace, activeTeam, saveMeetingNote, deleteMeetingNote } = useWorkspace()
  const members = state.members
  const currentMemberIds = new Set(members.map((member) => member.id))
  const meetingNotes = (activeTeam?.meetingNotes ?? state.meetingNotes).filter((note) => currentMemberIds.has(note.memberId))
  const [selectedMemberId, setSelectedMemberId] = useState(members[0]?.id ?? '')
  const [newDate, setNewDate] = useState(todayString())
  const [newComment, setNewComment] = useState('')
  const [newMood, setNewMood] = useState('')
  const [newGrowthPoints, setNewGrowthPoints] = useState(EMPTY_GROWTH_POINTS)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editComment, setEditComment] = useState('')
  const [editMood, setEditMood] = useState('')
  const [deletingNote, setDeletingNote] = useState<MeetingNote | null>(null)

  useEffect(() => {
    if (!members.some((member) => member.id === selectedMemberId)) setSelectedMemberId(members[0]?.id ?? '')
  }, [members, selectedMemberId])

  const selectedMember: TeamMember | undefined = members.find((member) => member.id === selectedMemberId)
  const notesForMember = meetingNotes.filter((note) => note.memberId === selectedMemberId).sort((a, b) => b.date.localeCompare(a.date))
  const meetingInsights = activeTeam && selectedMember
    ? buildMemberInsights(workspace, activeTeam.id, selectedMember, notesForMember)
    : []

  function getMemberGrade(memberId: string) {
    const currentYear = new Date().getFullYear()
    return activeTeam ? getMemberEvaluationHistory(workspace, activeTeam.id, memberId).find((item) => item.year === currentYear)?.grade ?? null : null
  }

  function handleAdd() {
    if (!selectedMemberId || !newDate || !newComment.trim()) return
    saveMeetingNote({ id: uuidv4(), memberId: selectedMemberId, date: newDate, comment: newComment.trim(), ...(newMood ? { mood: newMood } : {}), ...(Object.values(newGrowthPoints).some((value) => value.trim()) ? { growthPoints: newGrowthPoints } : {}) })
    setNewComment('')
    setNewMood('')
    setNewGrowthPoints(EMPTY_GROWTH_POINTS)
  }

  function updateLoadedNote(note: MeetingNote) {
    if (!newDate || !newComment.trim()) return
    const hasGrowthPoints = Object.values(newGrowthPoints).some((value) => value.trim())
    saveMeetingNote({ ...note, date: newDate, comment: newComment.trim(), mood: newMood || undefined, growthPoints: hasGrowthPoints ? newGrowthPoints : undefined })
  }

  function startEdit(note: MeetingNote) {
    setEditingNoteId(note.id)
    setEditDate(note.date)
    setEditComment(note.comment)
    setEditMood(note.mood ?? '')
  }

  function saveEdit(note: MeetingNote) {
    if (!editDate || !editComment.trim()) return
    saveMeetingNote({ ...note, date: editDate, comment: editComment.trim(), mood: editMood || undefined })
    setEditingNoteId(null)
  }

  function handleDeleteConfirm() {
    if (!deletingNote) return
    deleteMeetingNote(deletingNote.id)
    setDeletingNote(null)
  }

  function addSampleMeetingData() {
    members.forEach((member, index) => {
      const scenario = SAMPLE_MEETING_SCENARIOS[index % SAMPLE_MEETING_SCENARIOS.length]
      saveMeetingNote({ id: `sample-meeting-${member.id}-recent`, memberId: member.id, date: '2026-08-21', comment: scenario.recent, mood: scenario.mood, growthPoints: scenario.growth })
      saveMeetingNote({ id: `sample-meeting-${member.id}-previous`, memberId: member.id, date: '2026-07-17', comment: scenario.previous, mood: '🙂' })
    })
  }

  return <div className="ui-page">
    {members.length === 0 || !selectedMember ? <p className="ui-empty">등록된 팀원이 없습니다. 팀원 관리에서 먼저 팀원을 등록하세요.</p> : <div className="-mt-5 overflow-hidden bg-white">
      {import.meta.env.DEV && meetingNotes.length === 0 && <div className="flex justify-end border-b border-gray-100 pb-2"><button type="button" onClick={addSampleMeetingData} className="ui-button ui-button-secondary ui-button-sm">가상 면담 데이터 채우기</button></div>}
      <MeetingNotesFocusPreview
        members={members} selectedMember={selectedMember} selectedMemberId={selectedMemberId} onSelectMember={setSelectedMemberId}
        notes={notesForMember} allNotes={meetingNotes} insights={meetingInsights}
        newDate={newDate} newComment={newComment} newMood={newMood} growthPoints={newGrowthPoints}
        onDateChange={setNewDate} onCommentChange={setNewComment} onMoodChange={setNewMood} onGrowthPointsChange={setNewGrowthPoints}
        onAdd={handleAdd} onUpdateLoaded={updateLoadedNote} onEdit={startEdit}
        editingNoteId={editingNoteId} editDate={editDate} editComment={editComment} editMood={editMood}
        onEditDateChange={setEditDate} onEditCommentChange={setEditComment} onEditMoodChange={setEditMood}
        onSaveEdit={saveEdit} onCancelEdit={() => setEditingNoteId(null)} onDelete={setDeletingNote} getMemberGrade={getMemberGrade}
      />
    </div>}
    <ConfirmDialog open={deletingNote !== null} title="면담 기록 삭제" message={`${deletingNote?.date} 면담 기록을 삭제하시겠습니까?`} onConfirm={handleDeleteConfirm} onCancel={() => setDeletingNote(null)} />
  </div>
}
