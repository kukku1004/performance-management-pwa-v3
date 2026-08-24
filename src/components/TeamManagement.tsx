import { useRef, useState } from 'react'
import { useAppState } from '../state/AppContext'
import type { TeamMember } from '../types'
import { calcMemberParticipation } from '../utils/calculations'
import { downloadMemberTemplate, parseMemberWorkbook, type MemberImportResult } from '../utils/excel'
import MemberModal from './MemberModal'
import ConfirmDialog from './ConfirmDialog'
import ImportFeedback from './ImportFeedback'
import Badge from './Badge'
import SectionHeader from './SectionHeader'
import PeerReviewSection from './PeerReviewSection'
import CriteriaWorkspaceLayout from './CriteriaWorkspaceLayout'
import FileDropZone from './FileDropZone'
import { useWorkspace } from '../state/WorkspaceContext'

export default function TeamManagement() {
  const { state, dispatch } = useAppState()
  const { activeTeam } = useWorkspace()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null)
  const [deletingMember, setDeletingMember] = useState<TeamMember | null>(null)
  const [importResult, setImportResult] = useState<MemberImportResult | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [recentlyAddedIds, setRecentlyAddedIds] = useState<Set<string>>(new Set())
  const [activeView, setActiveView] = useState<'members' | 'peer'>('members')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function openAddModal() {
    setEditingMember(null)
    setModalOpen(true)
  }

  function openEditModal(member: TeamMember) {
    setEditingMember(member)
    setModalOpen(true)
  }

  function handleSave(member: TeamMember) {
    if (editingMember || state.members.some((existing) => existing.id === member.id)) {
      dispatch({ type: 'UPDATE_MEMBER', payload: member })
    } else {
      dispatch({ type: 'ADD_MEMBER', payload: member })
    }
    setModalOpen(false)
    setEditingMember(null)
  }

  function handleDeleteConfirm() {
    if (deletingMember) {
      dispatch({ type: 'DELETE_MEMBER', payload: { id: deletingMember.id } })
      setDeletingMember(null)
    }
  }

  function toggleMemberActive(member: TeamMember) {
    dispatch({ type: 'UPDATE_MEMBER', payload: { ...member, active: !member.active } })
  }

  async function importMemberFile(file: File | undefined) {
    if (!file) return
    const buffer = await file.arrayBuffer()
    const result = parseMemberWorkbook(buffer, state.members)
    dispatch({ type: 'IMPORT_MEMBERS', payload: result.members })
    setImportResult(result)
    setRecentlyAddedIds(new Set(result.addedIds))
    setUploadOpen(false)
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    await importMemberFile(file)
  }

  return (
    <CriteriaWorkspaceLayout>
    <div className="ui-page">
      <SectionHeader
        title="팀원 관리"
        description="현재 평가 프로젝트의 팀원을 관리합니다. 제외한 팀원의 다른 평가기간 이력과 TeamMember ID는 유지됩니다."
        action={
        <div className="flex items-center gap-2">
          {activeView === 'members' && <button onClick={openAddModal} className="ui-button ui-button-primary">+ 팀원 추가</button>}
        </div>
        }
      />

      <div className="flex border-b border-gray-200" role="tablist" aria-label="팀원 관리 구분">
        <button type="button" role="tab" aria-selected={activeView === 'members'} onClick={() => setActiveView('members')} className={`border-b-2 px-5 py-2.5 text-sm font-semibold transition-colors ${activeView === 'members' ? 'border-gray-950 text-gray-950' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>팀원</button>
        <button type="button" role="tab" aria-selected={activeView === 'peer'} onClick={() => setActiveView('peer')} className={`border-b-2 px-5 py-2.5 text-sm font-semibold transition-colors ${activeView === 'peer' ? 'border-gray-950 text-gray-950' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>피어리뷰</button>
      </div>

      {activeView === 'peer' ? <PeerReviewSection /> : <>

      <div className="ui-toolbar">
        <button
          onClick={downloadMemberTemplate}
          className="ui-button ui-button-secondary"
        >
          엑셀 양식 다운로드
        </button>
        <button
          type="button"
          aria-expanded={uploadOpen}
          onClick={() => setUploadOpen((open) => !open)}
          className="ui-button ui-button-secondary"
        >
          엑셀로 업로드
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleFileSelected}
        />
      </div>

      {uploadOpen && <FileDropZone
        title="팀원 Excel 파일을 여기에 드래그"
        description="이름·직책·직급·연차·역할·코멘트를 현재 평가의 팀원 정보에 반영합니다."
        onClick={() => fileInputRef.current?.click()}
        onDrop={(event) => { event.preventDefault(); void importMemberFile(event.dataTransfer.files[0]) }}
      />}

      {importResult && (
        <ImportFeedback
          addedCount={importResult.addedCount}
          updatedCount={importResult.updatedCount}
          errors={importResult.errors}
          onDismiss={() => {
            setImportResult(null)
            setRecentlyAddedIds(new Set())
          }}
        />
      )}

      {state.members.length === 0 ? (
        <p className="ui-empty">
          등록된 팀원이 없습니다.
          <br />
          '+ 팀원 추가' 버튼으로 직접 등록하거나,
          <br />
          위의 '엑셀로 업로드' 버튼으로 여러 팀원을 한 번에 등록할 수 있습니다.
        </p>
      ) : (
      <div className="ui-table-wrap">
        <table className="ui-table min-w-[900px]">
          <thead>
            <tr>
              <th className="px-4 py-3 font-semibold">이름</th>
              <th className="px-4 py-3 font-semibold">직책</th>
              <th className="px-4 py-3 font-semibold">직급</th>
              <th className="px-4 py-3 font-semibold">연차</th>
              <th className="px-4 py-3 font-semibold">역할</th>
              <th className="px-4 py-3 font-semibold">참여 과제 수</th>
              <th className="px-4 py-3 font-semibold">활성여부</th>
              <th className="px-4 py-3 font-semibold">관리</th>
            </tr>
          </thead>
          <tbody>
            {state.members.map((member) => {
              const { count } = calcMemberParticipation(member, state.tasks, state.contributions)
              return (
                <tr key={member.id} className="border-t border-gray-200 text-black">
                  <td className="px-4 py-3 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {member.name}
                      {recentlyAddedIds.has(member.id) && (
                        <Badge tone="accent">N</Badge>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3">{member.position || '-'}</td>
                  <td className="px-4 py-3">{member.level || '-'}</td>
                  <td className="px-4 py-3">{member.yearsOfService ?? '-'}</td>
                  <td className="px-4 py-3">{member.role || '-'}</td>
                  <td className="px-4 py-3">{count}건</td>
                  <td className="px-4 py-3">
                    <button type="button" role="switch" aria-checked={member.active} onClick={() => toggleMemberActive(member)} title="클릭해서 활성/비활성 전환" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${member.active ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}><span className={`h-1.5 w-1.5 rounded-full ${member.active ? 'bg-green-500' : 'bg-gray-400'}`} />{member.active ? '활성' : '비활성'}</button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditModal(member)}
                        className="ui-button ui-button-secondary ui-button-sm"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => setDeletingMember(member)}
                        className="ui-button ui-button-danger ui-button-sm"
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      )}

      {modalOpen && (
        <MemberModal
          initialMember={editingMember}
          knownMembers={activeTeam?.members ?? state.members}
          onSave={handleSave}
          onClose={() => {
            setModalOpen(false)
            setEditingMember(null)
          }}
        />
      )}

      <ConfirmDialog
        open={deletingMember !== null}
        title="팀원 삭제"
        message={`'${deletingMember?.name}' 팀원을 현재 평가 프로젝트에서 제외하시겠습니까? 현재 기간의 기여도는 삭제되지만 다른 평가기간 이력은 유지됩니다.`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletingMember(null)}
      />
      </>}
    </div>
    </CriteriaWorkspaceLayout>
  )
}
