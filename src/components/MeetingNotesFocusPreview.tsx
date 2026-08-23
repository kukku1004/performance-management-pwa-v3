import { useMemo, useState } from 'react'
import type { MeetingNote, TeamMember } from '../types'
import Badge from './Badge'
import DisclosureIcon from './DisclosureIcon'
import MemberGrowthOverview from './MemberGrowthOverview'
import RecentPerformanceSummary from './RecentPerformanceSummary'

type ReferencePanel = 'performance' | 'growth' | null

interface MeetingNotesFocusPreviewProps {
  members: TeamMember[]
  selectedMember: TeamMember
  selectedMemberId: string
  onSelectMember: (memberId: string) => void
  notes: MeetingNote[]
  insights: string[]
  newDate: string
  newComment: string
  newMood: string
  onDateChange: (value: string) => void
  onCommentChange: (value: string) => void
  onMoodChange: (value: string) => void
  onAdd: () => void
  onEdit: (note: MeetingNote) => void
  onDelete: (note: MeetingNote) => void
  getMemberGrade: (memberId: string) => string | null
}

const MOODS = ['😄', '😊', '🙂', '😐', '🙁', '😢', '😣', '😩', '😭']

export default function MeetingNotesFocusPreview({
  members, selectedMember, selectedMemberId, onSelectMember, notes, insights,
  newDate, newComment, newMood, onDateChange, onCommentChange, onMoodChange,
  onAdd, onEdit, onDelete, getMemberGrade,
}: MeetingNotesFocusPreviewProps) {
  const [referencePanel, setReferencePanel] = useState<ReferencePanel>(null)
  const [insightsOpen, setInsightsOpen] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(true)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(notes[0]?.id ?? null)
  const sortedNotes = useMemo(() => [...notes].sort((a, b) => b.date.localeCompare(a.date)), [notes])
  const selectedNote = sortedNotes.find((note) => note.id === selectedNoteId) ?? null

  return <div className="meeting-focus-shell">
    <div className="meeting-focus-members" role="tablist" aria-label="면담 팀원 선택">
      {members.map((member) => <button key={member.id} type="button" role="tab" aria-selected={member.id === selectedMemberId} onClick={() => onSelectMember(member.id)} className={`meeting-focus-member-tab ${member.id === selectedMemberId ? 'meeting-focus-member-tab-active' : ''}`}>
        {getMemberGrade(member.id) && <Badge tone="neutral" className="shrink-0 bg-white text-gray-900">{getMemberGrade(member.id)}</Badge>}
        <span className="truncate">{member.name}</span>
      </button>)}
    </div>

    <div className={`meeting-focus-workspace ${referencePanel ? 'meeting-focus-workspace-reference' : ''}`}>
      <aside className="meeting-focus-timeline">
        <div className="mb-5">
          <p className="text-xs font-medium text-gray-400">면담 이력</p>
          <h2 className="mt-1 text-lg font-semibold text-gray-950">{selectedMember.name}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{selectedMember.role} · {selectedMember.level}</p>
        </div>
        <div className="relative border-l border-gray-200 pl-5">
          {sortedNotes.length === 0 ? <p className="py-3 text-sm text-gray-400">아직 면담 기록이 없습니다.</p> : sortedNotes.map((note, index) => <button key={note.id} type="button" onClick={() => setSelectedNoteId(note.id)} className={`relative mb-2 block w-full rounded-md px-3 py-2.5 text-left transition ${selectedNoteId === note.id ? 'bg-gray-950 text-white' : 'hover:bg-gray-50'}`}>
            <span className={`absolute -left-[25px] top-4 h-2 w-2 rounded-full ring-4 ring-white ${selectedNoteId === note.id ? 'bg-orange-500' : 'bg-gray-300'}`} />
            <span className="flex items-center justify-between gap-2"><strong className="text-xs">{note.date}</strong>{note.mood && <span>{note.mood}</span>}</span>
            <span className={`mt-1 block truncate text-xs ${selectedNoteId === note.id ? 'text-gray-300' : 'text-gray-500'}`}>{note.comment}</span>
            {index === 0 && <span className={`mt-1 block text-[10px] ${selectedNoteId === note.id ? 'text-orange-300' : 'text-orange-600'}`}>최근 면담</span>}
          </button>)}
        </div>
      </aside>

      <main className="meeting-focus-document">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 pb-4">
          <div><p className="text-xs font-medium text-gray-400">면담 관리</p><h2 className="mt-1 text-xl font-semibold text-gray-950">{selectedMember.name} 면담</h2></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setReferencePanel(referencePanel === 'performance' ? null : 'performance')} className={`ui-button ui-button-secondary ui-button-sm ${referencePanel === 'performance' ? 'border-gray-950 bg-gray-950 text-white' : ''}`}>성과 상세</button>
            <button type="button" onClick={() => setReferencePanel(referencePanel === 'growth' ? null : 'growth')} className={`ui-button ui-button-secondary ui-button-sm ${referencePanel === 'growth' ? 'border-gray-950 bg-gray-950 text-white' : ''}`}>성장 시뮬레이션</button>
          </div>
        </header>

        {insights.length > 0 && <section className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4">
          <button type="button" onClick={() => setInsightsOpen((value) => !value)} className="flex w-full items-center justify-between py-3 text-left"><h3 className="text-sm font-semibold text-amber-950">면담 인사이트</h3><DisclosureIcon open={insightsOpen} className="h-4 w-4 text-amber-700" /></button>
          {insightsOpen && <ul className="space-y-2 pb-4 text-sm leading-5 text-amber-950/80">{insights.map((insight) => <li key={insight} className="flex gap-2"><span className="text-orange-600">•</span><span>{insight}</span></li>)}</ul>}
        </section>}

        <section className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="ui-section-title">면담일지</h3><input type="date" value={newDate} onChange={(event) => onDateChange(event.target.value)} className="ui-field w-auto" /></div>
          <textarea value={newComment} onChange={(event) => onCommentChange(event.target.value)} rows={7} placeholder="면담 내용을 입력하세요." className="ui-field mt-3 resize-y" />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-1" aria-label="면담 분위기">{MOODS.map((mood) => <button key={mood} type="button" onClick={() => onMoodChange(newMood === mood ? '' : mood)} className={`flex h-8 w-8 items-center justify-center rounded-md border ${newMood === mood ? 'border-orange-400 bg-orange-50' : 'border-transparent hover:border-gray-200'}`}>{mood}</button>)}</div><button type="button" onClick={onAdd} disabled={!newComment.trim()} className="ui-button ui-button-primary">작성하기</button></div>
        </section>

        <section className="mt-7">
          <button type="button" onClick={() => setHistoryOpen((value) => !value)} className="flex w-full items-center justify-between border-b border-gray-200 pb-3 text-left"><span className="flex items-center gap-2"><h3 className="ui-section-title">면담 기록</h3><span className="text-xs text-gray-400">{sortedNotes.length}건</span></span><DisclosureIcon open={historyOpen} className="h-4 w-4 text-gray-500" /></button>
          {historyOpen && <div className="divide-y divide-gray-100">{sortedNotes.map((note) => <article key={note.id} className="py-4"><div className="flex items-start justify-between gap-3"><div><strong className="text-sm text-gray-950">{note.mood && <span className="mr-2">{note.mood}</span>}{note.date}</strong><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{note.comment}</p></div><div className="flex shrink-0 gap-1"><button type="button" onClick={() => onEdit(note)} className="ui-button ui-button-ghost ui-button-sm">수정</button><button type="button" onClick={() => onDelete(note)} className="ui-button ui-button-danger ui-button-sm">삭제</button><button type="button" onClick={() => window.print()} className="ui-button ui-button-ghost ui-button-sm">출력</button></div></div></article>)}</div>}
        </section>

        {selectedNote && <section className="mt-8 border-t border-gray-200 pt-5 print:block"><p className="text-xs font-medium text-gray-400">선택한 면담 상세</p><div className="mt-2 flex items-center gap-2"><strong>{selectedNote.date}</strong>{selectedNote.mood && <span>{selectedNote.mood}</span>}</div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-700">{selectedNote.comment}</p></section>}
      </main>

      {referencePanel && <aside className="meeting-focus-reference">
        <div className="flex items-center justify-between border-b border-gray-200 pb-3"><h3 className="ui-section-title">{referencePanel === 'performance' ? '성과 상세' : '성장 시뮬레이션'}</h3><button type="button" onClick={() => setReferencePanel(null)} className="ui-button ui-button-ghost ui-button-sm h-8 w-8 px-0" aria-label="참고 패널 닫기">×</button></div>
        <div className="mt-4">{referencePanel === 'performance' ? <RecentPerformanceSummary member={selectedMember} /> : <MemberGrowthOverview member={selectedMember} compact collapsible />}</div>
      </aside>}
    </div>
  </div>
}
