import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Level, Position, TeamMember } from '../types'
import { LEVEL_OPTIONS, POSITION_OPTIONS } from '../types'

interface MemberModalProps {
  initialMember: TeamMember | null
  knownMembers: TeamMember[]
  onSave: (member: TeamMember) => void
  onClose: () => void
}

export default function MemberModal({
  initialMember,
  knownMembers,
  onSave,
  onClose,
}: MemberModalProps) {
  const [name, setName] = useState(initialMember?.name ?? '')
  const [active, setActive] = useState(initialMember?.active ?? true)
  const [position, setPosition] = useState<Position | ''>(initialMember?.position ?? '')
  const [level, setLevel] = useState<Level | ''>(initialMember?.level ?? '')
  const [yearsOfService, setYearsOfService] = useState(
    initialMember?.yearsOfService != null ? String(initialMember.yearsOfService) : '',
  )
  const [role, setRole] = useState(initialMember?.role ?? '')
  const [comment, setComment] = useState(initialMember?.comment ?? '')
  const [error, setError] = useState('')
  const [duplicateCandidates, setDuplicateCandidates] = useState<TeamMember[]>([])

  function normalizedName(value: string) {
    return value.trim().normalize('NFC')
  }

  function createMember(id = initialMember?.id ?? uuidv4(), memberName = name.trim()): TeamMember {
    return {
      id,
      name: memberName,
      active,
      position,
      level,
      yearsOfService: yearsOfService.trim() === '' ? null : Number(yearsOfService),
      role: role.trim(),
      comment: comment.trim(),
    }
  }

  function nextDistinctName(baseName: string) {
    const usedNames = new Set(knownMembers.map((member) => normalizedName(member.name)))
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    return Array.from(letters).map((letter) => `${baseName} ${letter}`).find((candidate) => !usedNames.has(normalizedName(candidate))) ?? `${baseName} ${knownMembers.length + 1}`
  }

  function saveAsSeparateMember() {
    const separateName = nextDistinctName(name.trim())
    onSave(createMember(uuidv4(), separateName))
  }

  function handleSubmit() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('이름을 입력하세요.')
      return
    }
    const sameNameMembers = knownMembers.filter((member) => (
      normalizedName(member.name) === normalizedName(trimmedName) && member.id !== initialMember?.id
    ))
    if (!initialMember && sameNameMembers.length > 0) {
      setDuplicateCandidates(sameNameMembers)
      return
    }
    if (initialMember && sameNameMembers.length > 0) {
      setError(`팀원명 '${trimmedName}'은(는) 이미 존재합니다. 다른 이름으로 수정하세요.`)
      return
    }
    onSave(createMember())
  }

  return (
    <div className="ui-modal-backdrop">
      <div className="ui-modal-panel relative max-w-sm">
        <h3 className="ui-modal-title">{initialMember ? '팀원 수정' : '팀원 추가'}</h3>

        <div className="mt-4 max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div>
            <label className="ui-label">이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 홍길동"
              className={`ui-field ${
                error ? 'border-danger' : 'border-gray-300'
              }`}
            />
            {error && <p className="mt-1 text-xs text-danger">{error}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ui-label">직책</label>
              <select
                value={position}
                onChange={(e) => setPosition(e.target.value as Position | '')}
                className="ui-field"
              >
                <option value="">-</option>
                {POSITION_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="ui-label">직급</label>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as Level | '')}
                className="ui-field"
              >
                <option value="">-</option>
                {LEVEL_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ui-label">연차</label>
              <input
                type="number"
                min={0}
                value={yearsOfService}
                onChange={(e) => setYearsOfService(e.target.value)}
                placeholder="예: 3"
                className="ui-field"
              />
            </div>
            <div>
              <label className="ui-label">역할</label>
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="예: 기획, 디자인, 개발"
                className="ui-field"
              />
            </div>
          </div>

          <div>
            <label className="ui-label">코멘트</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="팀원에 대한 코멘트를 남겨보세요 (선택)"
              rows={2}
              className="ui-field"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="member-active"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="member-active" className="text-sm text-black">
              활성 (사용)
            </label>
          </div>
        </div>

        <div className="ui-modal-actions">
          <button
            onClick={onClose}
            className="ui-button ui-button-secondary"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            className="ui-button ui-button-primary"
          >
            저장
          </button>
        </div>

        {duplicateCandidates.length > 0 && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/95 p-5">
            <div className="w-full rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <h4 className="text-base font-semibold text-gray-950">같은 이름의 팀원이 있습니다</h4>
              <p className="mt-1 text-sm leading-5 text-gray-500">기존 팀원에 연결하면 이전 평가 이력과 면담 기록이 이어집니다.</p>
              <div className="mt-3 space-y-2">
                {duplicateCandidates.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => onSave(createMember(member.id, member.name))}
                    className="flex w-full items-center justify-between rounded-md border border-gray-200 px-3 py-2 text-left text-sm hover:border-gray-400 hover:bg-gray-50"
                  >
                    <span className="font-medium text-gray-950">{member.name}</span>
                    <span className="text-xs text-gray-500">기존 팀원에 연결</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={saveAsSeparateMember}
                className="ui-button ui-button-secondary mt-3 w-full"
              >
                별도 팀원으로 추가 · {nextDistinctName(name.trim())}
              </button>
              <button type="button" onClick={() => setDuplicateCandidates([])} className="mt-3 w-full text-sm font-medium text-gray-500 hover:text-gray-950">이름 다시 입력</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
