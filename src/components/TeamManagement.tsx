import { useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useAppState } from '../state/AppContext'
import type { Level, Position, TeamMember } from '../types'
import { LEVEL_OPTIONS, POSITION_OPTIONS } from '../types'
import { calcMemberParticipation } from '../utils/calculations'
import { downloadMemberTemplate, parseMemberWorkbook, type MemberImportResult } from '../utils/excel'
import ConfirmDialog from './ConfirmDialog'
import ImportFeedback from './ImportFeedback'
import Badge from './Badge'
import PeerReviewSection from './PeerReviewSection'
import CriteriaWorkspaceLayout from './CriteriaWorkspaceLayout'
import FileDropZone from './FileDropZone'
import TitleHelp from './TitleHelp'
import { useWorkspace } from '../state/WorkspaceContext'

interface MemberForm {
  name: string
  position: Position | ''
  level: Level | ''
  yearsOfService: string
  role: string
  comment: string
}

const EMPTY_MEMBER_FORM: MemberForm = { name: '', position: '', level: '', yearsOfService: '', role: '', comment: '' }

export default function TeamManagement() {
  const { state, dispatch } = useAppState()
  const { activeTeam } = useWorkspace()
  const [newForm, setNewForm] = useState<MemberForm>(EMPTY_MEMBER_FORM)
  const [newFormError, setNewFormError] = useState('')
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<MemberForm>(EMPTY_MEMBER_FORM)
  const [editFormError, setEditFormError] = useState('')
  const [deletingMember, setDeletingMember] = useState<TeamMember | null>(null)
  const [importResult, setImportResult] = useState<MemberImportResult | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [recentlyAddedIds, setRecentlyAddedIds] = useState<Set<string>>(new Set())
  const [activeView, setActiveView] = useState<'members' | 'peer'>('members')
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hasMembers = state.members.length > 0

  function normalizeName(value: string) { return value.trim().normalize('NFC') }

  function addMember() {
    const name = newForm.name.trim()
    if (!name) { setNewFormError('이름을 입력하세요.'); return }
    if (state.members.some((member) => normalizeName(member.name) === normalizeName(name))) { setNewFormError(`팀원명 '${name}'은(는) 이미 존재합니다.`); return }
    const knownMember = activeTeam?.members.find((member) => normalizeName(member.name) === normalizeName(name))
    const member: TeamMember = { id: knownMember?.id ?? uuidv4(), name, active: true, position: newForm.position, level: newForm.level, yearsOfService: newForm.yearsOfService.trim() === '' ? null : Math.max(0, Number(newForm.yearsOfService)), role: newForm.role.trim(), comment: newForm.comment.trim() }
    dispatch({ type: 'ADD_MEMBER', payload: member })
    setRecentlyAddedIds((current) => new Set(current).add(member.id))
    setNewForm(EMPTY_MEMBER_FORM)
    setNewFormError('')
  }

  function startEdit(member: TeamMember) {
    setEditingMemberId(member.id)
    setEditForm({ name: member.name, position: member.position, level: member.level, yearsOfService: member.yearsOfService === null ? '' : String(member.yearsOfService), role: member.role, comment: member.comment })
    setEditFormError('')
  }

  function saveEdit(member: TeamMember) {
    const name = editForm.name.trim()
    if (!name) { setEditFormError('이름을 입력하세요.'); return }
    if (state.members.some((item) => item.id !== member.id && normalizeName(item.name) === normalizeName(name))) { setEditFormError(`팀원명 '${name}'은(는) 이미 존재합니다.`); return }
    dispatch({ type: 'UPDATE_MEMBER', payload: { ...member, name, position: editForm.position, level: editForm.level, yearsOfService: editForm.yearsOfService.trim() === '' ? null : Math.max(0, Number(editForm.yearsOfService)), role: editForm.role.trim(), comment: editForm.comment.trim() } })
    setEditingMemberId(null)
    setEditFormError('')
  }

  function handleDeleteConfirm() {
    if (deletingMember) {
      dispatch({ type: 'DELETE_MEMBER', payload: { id: deletingMember.id } })
      setSelectedMemberIds((current) => new Set(Array.from(current).filter((id) => id !== deletingMember.id)))
      setDeletingMember(null)
    }
  }

  function toggleMemberSelection(id: string) {
    setSelectedMemberIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllMembers() {
    setSelectedMemberIds((current) => current.size === state.members.length ? new Set() : new Set(state.members.map((member) => member.id)))
  }

  function handleBulkDeleteConfirm() {
    dispatch({ type: 'DELETE_MEMBERS', payload: { ids: Array.from(selectedMemberIds) } })
    setRecentlyAddedIds((current) => new Set(Array.from(current).filter((id) => !selectedMemberIds.has(id))))
    setSelectedMemberIds(new Set())
    setBulkDeleteOpen(false)
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
    setSelectedMemberIds(new Set())
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
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200">
        <div className="flex" role="tablist" aria-label="팀원 관리 구분">
          <div className={`flex items-center gap-1.5 border-b-2 px-2 pb-3 pt-1 ${activeView === 'members' ? 'border-gray-950' : 'border-transparent'}`}>
            <button type="button" role="tab" aria-selected={activeView === 'members'} onClick={() => setActiveView('members')} className={`transition-colors ${activeView === 'members' ? 'text-lg font-semibold text-gray-950' : 'text-sm font-medium text-gray-500 hover:text-gray-800'}`}>팀원</button>
            {activeView === 'members' && <TitleHelp label="팀원을 추가하거나 제외하면 평가 매트릭스에 자동 반영되며, 다른 평가기간의 이력은 유지됩니다." />}
          </div>
          <button type="button" role="tab" aria-selected={activeView === 'peer'} onClick={() => setActiveView('peer')} className={`border-b-2 px-5 pb-3 pt-1 transition-colors ${activeView === 'peer' ? 'border-gray-950 text-lg font-semibold text-gray-950' : 'border-transparent text-sm font-medium text-gray-500 hover:text-gray-800'}`}>피어리뷰</button>
        </div>
        {activeView === 'members' && <div className="flex flex-wrap items-center gap-2"><button onClick={downloadMemberTemplate} className="ui-button ui-button-secondary">엑셀 양식 다운로드</button>{hasMembers && <button type="button" aria-expanded={uploadOpen} onClick={() => setUploadOpen((open) => !open)} className="ui-button ui-button-secondary">엑셀로 업로드</button>}<input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileSelected} /></div>}
      </div>

      {activeView === 'peer' ? <PeerReviewSection /> : <>

      {(!hasMembers || uploadOpen) && <FileDropZone
        title={hasMembers ? '팀원 Excel 파일을 여기에 드래그' : '등록된 팀원이 없습니다.'}
        description={hasMembers ? '팀원 양식 또는 종합 인사기록카드(.xls)를 올리면 기본정보와 발령·교육·경력·포상이력을 연결합니다.' : '아래 입력 영역에서 직접 등록할 수 있습니다.\n또는\n팀원 양식이나 종합 인사기록카드를 드래그하여 등록할 수 있습니다.'}
        onClick={() => fileInputRef.current?.click()}
        onDrop={(event) => { event.preventDefault(); void importMemberFile(event.dataTransfer.files[0]) }}
        className={!hasMembers ? 'cursor-pointer bg-gray-50 hover:border-orange-300 hover:bg-orange-50/30' : 'cursor-pointer'}
      />}

      {importResult && (
        <div>
          {importResult.sourceType === 'personnel-record' && <p className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">인사기록카드를 인식했습니다. 기본정보와 성장 이력 {importResult.importedHistoryCount ?? 0}건을 반영했으며, 주소·연락처·주민번호·가족정보는 가져오지 않았습니다.</p>}
          <ImportFeedback
            addedCount={importResult.addedCount}
            updatedCount={importResult.updatedCount}
            errors={importResult.errors}
            onDismiss={() => {
              setImportResult(null)
              setRecentlyAddedIds(new Set())
            }}
          />
        </div>
      )}

      {hasMembers ? (
      <div>
      {selectedMemberIds.size > 0 && <div className="mb-3 flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-4 py-3"><p className="text-sm font-medium text-orange-800">팀원 {selectedMemberIds.size}명 선택됨</p><button type="button" onClick={() => setBulkDeleteOpen(true)} className="ui-button ui-button-danger ui-button-sm">선택 팀원 삭제</button></div>}
      <div className="ui-table-wrap">
        <table className="ui-table min-w-[900px]">
          <thead>
            <tr>
              <th className="w-12 px-3 py-3 text-center"><input type="checkbox" aria-label="팀원 전체 선택" checked={selectedMemberIds.size === state.members.length} onChange={toggleAllMembers} /></th>
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
              return editingMemberId === member.id ? (
                <tr key={member.id} className="border-t border-gray-200 bg-orange-50/30 text-black">
                  <td className="px-3 py-2 text-center"><input type="checkbox" aria-label={`${member.name} 선택`} checked={selectedMemberIds.has(member.id)} onChange={() => toggleMemberSelection(member.id)} /></td>
                  <td className="px-3 py-2"><input value={editForm.name} onChange={(event) => setEditForm((form) => ({ ...form, name: event.target.value }))} className="ui-field ui-field-sm" />{editFormError && <p className="mt-1 text-xs text-danger">{editFormError}</p>}</td>
                  <td className="px-3 py-2"><select value={editForm.position} onChange={(event) => setEditForm((form) => ({ ...form, position: event.target.value as Position | '' }))} className="ui-field ui-field-sm"><option value="">-</option>{POSITION_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></td>
                  <td className="px-3 py-2"><select value={editForm.level} onChange={(event) => setEditForm((form) => ({ ...form, level: event.target.value as Level | '' }))} className="ui-field ui-field-sm"><option value="">-</option>{LEVEL_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></td>
                  <td className="px-3 py-2"><input type="number" min="0" value={editForm.yearsOfService} onChange={(event) => setEditForm((form) => ({ ...form, yearsOfService: event.target.value }))} className="ui-field ui-field-sm" /></td>
                  <td className="px-3 py-2"><div className="space-y-1"><input value={editForm.role} onChange={(event) => setEditForm((form) => ({ ...form, role: event.target.value }))} className="ui-field ui-field-sm" /><input value={editForm.comment} onChange={(event) => setEditForm((form) => ({ ...form, comment: event.target.value }))} placeholder="코멘트" className="ui-field ui-field-sm" /></div></td>
                  <td className="px-4 py-3">{count}건</td>
                  <td className="px-4 py-3"><button type="button" role="switch" aria-checked={member.active} onClick={() => toggleMemberActive(member)} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${member.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}><span className={`h-1.5 w-1.5 rounded-full ${member.active ? 'bg-green-500' : 'bg-gray-400'}`} />{member.active ? '활성' : '비활성'}</button></td>
                  <td className="px-3 py-2"><div className="flex gap-1"><button type="button" onClick={() => saveEdit(member)} className="ui-button ui-button-primary ui-button-sm">저장</button><button type="button" onClick={() => setEditingMemberId(null)} className="ui-button ui-button-ghost ui-button-sm">취소</button></div></td>
                </tr>
              ) : (
                <tr key={member.id} className="border-t border-gray-200 text-black">
                  <td className="px-3 py-3 text-center"><input type="checkbox" aria-label={`${member.name} 선택`} checked={selectedMemberIds.has(member.id)} onChange={() => toggleMemberSelection(member.id)} /></td>
                  <td className="px-4 py-3 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {member.name}
                      {recentlyAddedIds.has(member.id) && (
                        <Badge tone="accent">N</Badge>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3">{member.position || '-'}</td>
                  <td className="px-4 py-3">{member.level || member.personnelRecord?.employeeGrade || member.personnelRecord?.jobTitle || '-'}</td>
                  <td className="px-4 py-3">{member.yearsOfService ?? '-'}</td>
                  <td className="px-4 py-3">{member.role || '-'}</td>
                  <td className="px-4 py-3">{count}건</td>
                  <td className="px-4 py-3">
                    <button type="button" role="switch" aria-checked={member.active} onClick={() => toggleMemberActive(member)} title="클릭해서 활성/비활성 전환" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${member.active ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}><span className={`h-1.5 w-1.5 rounded-full ${member.active ? 'bg-green-500' : 'bg-gray-400'}`} />{member.active ? '활성' : '비활성'}</button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEdit(member)}
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
      </div>
      ) : null}

      <section className="rounded-lg border border-gray-200 bg-white p-4" aria-label="팀원 추가">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_2fr_2fr_auto]">
          <label className="text-sm font-medium text-black">이름 <span className="text-danger">*</span><input value={newForm.name} onChange={(event) => setNewForm((form) => ({ ...form, name: event.target.value }))} placeholder="예: 홍길동" className={`ui-field mt-1 ${newFormError ? 'border-danger' : ''}`} /></label>
          <label className="text-sm font-medium text-black">직책<select value={newForm.position} onChange={(event) => setNewForm((form) => ({ ...form, position: event.target.value as Position | '' }))} className="ui-field mt-1"><option value="">-</option>{POSITION_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-sm font-medium text-black">직급<select value={newForm.level} onChange={(event) => setNewForm((form) => ({ ...form, level: event.target.value as Level | '' }))} className="ui-field mt-1"><option value="">-</option>{LEVEL_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-sm font-medium text-black">연차<input type="number" min="0" value={newForm.yearsOfService} onChange={(event) => setNewForm((form) => ({ ...form, yearsOfService: event.target.value }))} placeholder="예: 3" className="ui-field mt-1" /></label>
          <label className="text-sm font-medium text-black">역할<input value={newForm.role} onChange={(event) => setNewForm((form) => ({ ...form, role: event.target.value }))} placeholder="예: 리드, 기획, 디자인" className="ui-field mt-1" /></label>
          <label className="text-sm font-medium text-black">코멘트<input value={newForm.comment} onChange={(event) => setNewForm((form) => ({ ...form, comment: event.target.value }))} placeholder="선택 입력" className="ui-field mt-1" /></label>
          <button type="button" onClick={addMember} className="ui-button ui-button-primary self-end whitespace-nowrap">+ 팀원 추가</button>
        </div>
        {newFormError && <p className="mt-2 text-xs text-danger">{newFormError}</p>}
      </section>

      <ConfirmDialog
        open={deletingMember !== null}
        title="팀원 삭제"
        message={`'${deletingMember?.name}' 팀원을 현재 평가 프로젝트에서 제외하시겠습니까? 현재 기간의 기여도는 삭제되지만 다른 평가기간 이력은 유지됩니다.`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletingMember(null)}
      />
      <ConfirmDialog
        open={bulkDeleteOpen}
        title="선택 팀원 삭제"
        message={`선택한 팀원 ${selectedMemberIds.size}명을 현재 평가 프로젝트에서 제외하시겠습니까? 현재 기간의 기여도·피어리뷰·면담 기록은 삭제되며 다른 평가기간 이력은 유지됩니다.`}
        onConfirm={handleBulkDeleteConfirm}
        onCancel={() => setBulkDeleteOpen(false)}
      />
      </>}
    </div>
    </CriteriaWorkspaceLayout>
  )
}
