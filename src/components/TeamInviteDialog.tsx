import { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx-js-style'
import { sendGoogleInvitationEmails } from '../utils/googleDrive'
import ModalCloseButton from './ModalCloseButton'

function normalizeEmail(value: string) {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ''
  const email = trimmed.includes('@') ? trimmed : `${trimmed}@gmail.com`
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function parseRecipientText(value: string) {
  return Array.from(new Set(value.split(/[\s,;]+/).map(normalizeEmail).filter(Boolean)))
}

export default function TeamInviteDialog({ adminEmail, onClose }: { adminEmail: string; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [input, setInput] = useState('')
  const [recipients, setRecipients] = useState<string[]>([])
  const [subject, setSubject] = useState('성과·성장관리 앱 초대')
  const defaultLink = `${window.location.origin}${import.meta.env.BASE_URL}`
  const [body, setBody] = useState(`안녕하세요, 팀 성과·성장관리 앱에 초대합니다.\n\n아래 링크에서 Google 계정으로 로그인하시면 바로 사용할 수 있습니다.\n${defaultLink}\n\n로그인이 안 되면 관리자에게 문의해주세요.`)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const parsedInput = useMemo(() => parseRecipientText(input), [input])

  function addRecipients(next: string[]) {
    setRecipients((current) => Array.from(new Set([...current, ...next])))
    setInput('')
    setMessage(next.length > 0 ? '' : '추가할 수 있는 이메일을 찾지 못했습니다.')
  }

  async function addExcel(file?: File) {
    if (!file) return
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const values = workbook.SheetNames.flatMap((name) => XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: '' }).flat())
      addRecipients(values.flatMap((value) => parseRecipientText(String(value ?? ''))))
    } catch { setMessage('Excel 파일에서 이메일을 읽지 못했습니다.') }
  }

  async function send() {
    if (recipients.length === 0 || !subject.trim() || !body.trim()) return
    setSending(true)
    setMessage('')
    const result = await sendGoogleInvitationEmails(recipients, subject.trim(), body.trim())
    setSending(false)
    if (result.failed.length === 0) setMessage(`${result.sent.length}명에게 초대 메일을 발송했습니다.`)
    else setMessage(`${result.sent.length}건 성공 · ${result.failed.length}건 실패. Gmail 전송 권한이 없다면 Google 계정을 다시 연결하세요.`)
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4"><div role="dialog" aria-modal="true" aria-labelledby="team-invite-title" className="flex max-h-[calc(100vh-32px)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
    <header className="flex items-start justify-between border-b border-gray-200 px-5 py-4"><div><h2 id="team-invite-title" className="text-lg font-semibold text-gray-950">팀원 초대</h2><p className="mt-1 text-sm text-gray-500">팀원이 사용할 Google 계정으로 앱 접속 링크를 보냅니다.</p></div><ModalCloseButton onClick={onClose} label="팀원 초대 닫기" /></header>
    <div className="flex items-center gap-2 bg-gray-50 px-5 py-3 text-sm text-gray-700"><span>{adminEmail}</span><span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">관리자 연결됨</span></div>
    <div className="grid min-h-0 flex-1 overflow-y-auto p-5 md:grid-cols-2 md:gap-6"><section><h3 className="text-sm font-semibold text-gray-950">받는 사람 추가</h3><p className="mt-1 text-xs leading-5 text-gray-500">Gmail은 아이디만 입력해도 됩니다. 줄바꿈이나 쉼표로 구분하거나 Excel에서 추가할 수 있습니다.</p><textarea value={input} onChange={(event) => setInput(event.target.value)} rows={4} placeholder={'hong.gildong\nkim.cheolsu'} className="ui-field mt-3 resize-y" /><div className="mt-2 flex gap-2"><button type="button" disabled={parsedInput.length === 0} onClick={() => addRecipients(parsedInput)} className="ui-button ui-button-secondary">목록에 추가</button><button type="button" onClick={() => fileRef.current?.click()} className="ui-button ui-button-secondary">Excel로 추가</button><input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => { void addExcel(event.target.files?.[0]); event.target.value = '' }} /></div><div className="mt-4 border-t border-gray-200 pt-4"><p className="text-sm font-semibold text-gray-950">받는 사람 목록 ({recipients.length}명)</p>{recipients.length === 0 ? <p className="mt-2 text-xs text-gray-400">아직 추가된 받는 사람이 없습니다.</p> : <ul className="mt-2 max-h-40 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">{recipients.map((email) => <li key={email} className="flex items-center justify-between gap-2 px-3 py-2 text-sm"><span className="truncate">{email}</span><button type="button" onClick={() => setRecipients((current) => current.filter((item) => item !== email))} aria-label={`${email} 삭제`} className="text-gray-400 hover:text-danger">×</button></li>)}</ul>}</div></section>
      <section className="mt-6 border-t border-gray-200 pt-5 md:mt-0 md:border-l md:border-t-0 md:pl-6 md:pt-0"><h3 className="text-sm font-semibold text-gray-950">초대 메일 내용</h3><input value={subject} onChange={(event) => setSubject(event.target.value)} className="ui-field mt-3" aria-label="초대 메일 제목" /><textarea value={body} onChange={(event) => setBody(event.target.value)} rows={10} className="ui-field mt-2 resize-y" aria-label="초대 메일 본문" /><button type="button" disabled={sending || recipients.length === 0 || !subject.trim() || !body.trim()} onClick={() => void send()} className="ui-button ui-button-primary mt-3 w-full justify-center">{sending ? '발송 중…' : `초대 메일 발송 (${recipients.length}명)`}</button>{message && <p className={`mt-3 text-xs leading-5 ${message.includes('발송했습니다') ? 'text-success' : 'text-danger'}`}>{message}</p>}</section></div>
  </div></div>
}
