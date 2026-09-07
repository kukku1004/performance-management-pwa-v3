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

export default function MeetingNotes() {
  const { state } = useAppState()
  const { workspace, activeTeam, saveMeetingNote, deleteMeetingNote } = useWorkspace()
  const members = state.members
  const currentMemberIds = new Set(members.map((member) => member.id))
  const allStoredNotes = (activeTeam?.meetingNotes ?? state.meetingNotes).filter((note) => currentMemberIds.has(note.memberId))
  const meetingNotes = allStoredNotes.filter((note) => note.source !== 'performance-pdf')
  const importedCommentNotes = allStoredNotes.filter((note) => note.source === 'performance-pdf')
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

  function resetComposer() {
    setNewDate(todayString())
    setNewComment('')
    setNewMood('')
    setNewGrowthPoints(EMPTY_GROWTH_POINTS)
    setEditingNoteId(null)
  }

  function handleSelectMember(memberId: string) {
    setSelectedMemberId(memberId)
    resetComposer()
  }

  function updateLoadedNote(note: MeetingNote) {
    if (!newDate || !newComment.trim()) return
    const hasGrowthPoints = Object.values(newGrowthPoints).some((value) => value.trim())
    saveMeetingNote({ ...note, date: newDate, comment: newComment.trim(), mood: newMood || undefined, growthPoints: hasGrowthPoints ? newGrowthPoints : undefined })
    resetComposer()
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

  return <div className="ui-page">
    {members.length === 0 || !selectedMember ? <p className="ui-empty">등록된 팀원이 없습니다. 팀원 관리에서 먼저 팀원을 등록하세요.</p> : <div className="-mt-5 overflow-hidden bg-white">
      <MeetingNotesFocusPreview
        members={members} selectedMember={selectedMember} selectedMemberId={selectedMemberId} onSelectMember={handleSelectMember}
        notes={notesForMember} allNotes={meetingNotes} importedCommentNotes={importedCommentNotes.filter((note) => note.memberId === selectedMemberId)} insights={meetingInsights}
        newDate={newDate} newComment={newComment} newMood={newMood} growthPoints={newGrowthPoints}
        onDateChange={setNewDate} onCommentChange={setNewComment} onMoodChange={setNewMood} onGrowthPointsChange={setNewGrowthPoints}
        onAdd={handleAdd} onStartNew={resetComposer} onUpdateLoaded={updateLoadedNote} onEdit={startEdit}
        editingNoteId={editingNoteId} editDate={editDate} editComment={editComment} editMood={editMood}
        onEditDateChange={setEditDate} onEditCommentChange={setEditComment} onEditMoodChange={setEditMood}
        onSaveEdit={saveEdit} onCancelEdit={() => setEditingNoteId(null)} onDelete={setDeletingNote} getMemberGrade={getMemberGrade}
      />
    </div>}
    <ConfirmDialog open={deletingNote !== null} title="면담 기록 삭제" message={`${deletingNote?.date} 면담 기록을 삭제하시겠습니까?`} onConfirm={handleDeleteConfirm} onCancel={() => setDeletingNote(null)} />
  </div>
}
