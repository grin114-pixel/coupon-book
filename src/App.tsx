import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  type Database,
  getSupabaseClient,
  isSupabaseConfigured,
  storageBucket,
} from './lib/supabase'
import { hashPin } from './lib/pin'

type CouponRecord = Database['public']['Tables']['coupons']['Row']

type CouponView = Omit<CouponRecord, 'amount'> & {
  amount: number
  effectiveDate: Date
  effectiveDateKey: string
}

type CouponFormState = {
  name: string
  amount: string
  expiresAt: string
  isRecurring: boolean
  imageFile: File | null
  imagePreview: string | null
  removeImage: boolean
}

const AUTH_STORAGE_KEY = 'coupon-book.remembered-auth'
const PIN_HASH_STORAGE_KEY = 'coupon-book.pin-hash'
const DEFAULT_PIN = '1234'
const SETTINGS_ROW_ID = 'global'

function getTodayInputValue() {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getEmptyForm(): CouponFormState {
  return {
    name: '',
    amount: '',
    expiresAt: getTodayInputValue(),
    isRecurring: false,
    imageFile: null,
    imagePreview: null,
    removeImage: false,
  }
}

function formatAmountInput(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits ? Number(digits).toLocaleString('ko-KR') : ''
}

function parseAmount(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function getDaysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate()
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateLabel(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}년${month}월${day}일`
}

function resolveEffectiveDate(expiresAt: string, isRecurring: boolean) {
  const originalDate = parseLocalDate(expiresAt)

  if (!isRecurring) {
    return originalDate
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const originalDay = originalDate.getDate()
  let candidate = originalDate

  while (candidate < today) {
    const nextMonth = candidate.getMonth() + 1
    const nextYear = candidate.getFullYear() + Math.floor(nextMonth / 12)
    const normalizedMonth = nextMonth % 12
    const maxDay = getDaysInMonth(nextYear, normalizedMonth)
    candidate = new Date(nextYear, normalizedMonth, Math.min(originalDay, maxDay))
  }

  return candidate
}

function normalizeCoupon(coupon: CouponRecord): CouponView {
  const effectiveDate = resolveEffectiveDate(coupon.expires_at, coupon.is_recurring)

  return {
    ...coupon,
    amount: Number(coupon.amount),
    effectiveDate,
    effectiveDateKey: toDateKey(effectiveDate),
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('이미지 미리보기를 만들 수 없어요.'))
    }

    reader.onerror = () => reject(new Error('이미지를 읽는 중 오류가 발생했어요.'))
    reader.readAsDataURL(file)
  })
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
}

function sortCoupons(coupons: CouponView[]) {
  return [...coupons].sort((left, right) => {
    return left.effectiveDate.getTime() - right.effectiveDate.getTime()
  })
}

function App() {
  const [isCheckingRememberedAuth, setIsCheckingRememberedAuth] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [rememberDevice, setRememberDevice] = useState(false)
  const [pin, setPin] = useState('')
  const [authError, setAuthError] = useState('')
  const [activePinHash, setActivePinHash] = useState<string | null>(null)
  const [isChangingPin, setIsChangingPin] = useState(false)
  const [currentPinInput, setCurrentPinInput] = useState('')
  const [newPinInput, setNewPinInput] = useState('')
  const [confirmPinInput, setConfirmPinInput] = useState('')
  const [pinChangeError, setPinChangeError] = useState('')
  const [pinChangeMessage, setPinChangeMessage] = useState('')
  const [coupons, setCoupons] = useState<CouponView[]>([])
  const [isLoadingCoupons, setIsLoadingCoupons] = useState(false)
  const [dataError, setDataError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedImage, setSelectedImage] = useState<{ url: string; name: string } | null>(null)
  const [editingCoupon, setEditingCoupon] = useState<CouponView | null>(null)
  const [form, setForm] = useState<CouponFormState>(() => getEmptyForm())
  const [isSaving, setIsSaving] = useState(false)

  const defaultPin = String(import.meta.env.VITE_APP_PIN ?? DEFAULT_PIN).trim()
  const supabaseReady = isSupabaseConfigured()

  const defaultPinHashPromise = useMemo(() => hashPin(defaultPin), [defaultPin])

  useEffect(() => {
    const savedPinHash = window.localStorage.getItem(PIN_HASH_STORAGE_KEY)
    setRememberDevice(false)
    setIsAuthenticated(true)
    setActivePinHash(savedPinHash)
    setIsCheckingRememberedAuth(false)
  }, [defaultPin])

  useEffect(() => {
    if (!statusMessage) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setStatusMessage('')
    }, 2500)

    return () => window.clearTimeout(timeoutId)
  }, [statusMessage])

  useEffect(() => {
    if (!pinChangeMessage) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setPinChangeMessage('')
    }, 2500)

    return () => window.clearTimeout(timeoutId)
  }, [pinChangeMessage])

  const loadCoupons = useCallback(async () => {
    if (!supabaseReady) {
      setDataError('Supabase 환경 변수가 설정되지 않았어요. `.env`를 먼저 채워 주세요.')
      setCoupons([])
      return
    }

    setIsLoadingCoupons(true)
    setDataError('')

    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('coupons')
        .select('id, name, amount, expires_at, is_recurring, image_url')
        .order('expires_at', { ascending: true })

      if (error) {
        throw error
      }

      const normalizedCoupons = sortCoupons(((data ?? []) as CouponRecord[]).map(normalizeCoupon))
      setCoupons(normalizedCoupons)
    } catch (error) {
      setDataError(getErrorMessage(error))
      setCoupons([])
    } finally {
      setIsLoadingCoupons(false)
    }
  }, [supabaseReady])

  const ensureRemotePinHash = useCallback(async () => {
    const fallbackHash = await defaultPinHashPromise

    if (!supabaseReady) {
      return fallbackHash
    }

    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('app_settings')
      .select('pin_hash')
      .eq('id', SETTINGS_ROW_ID)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (data?.pin_hash) {
      return data.pin_hash
    }

    const { error: upsertError } = await supabase.from('app_settings').upsert({
      id: SETTINGS_ROW_ID,
      pin_hash: fallbackHash,
    })

    if (upsertError) {
      throw upsertError
    }

    return fallbackHash
  }, [defaultPinHashPromise, supabaseReady])

  const resolveExpectedPinHash = useCallback(async () => {
    try {
      const remoteHash = await ensureRemotePinHash()
      window.localStorage.setItem(PIN_HASH_STORAGE_KEY, remoteHash)
      setActivePinHash(remoteHash)
      return remoteHash
    } catch {
      const saved = window.localStorage.getItem(PIN_HASH_STORAGE_KEY)
      if (saved) {
        setActivePinHash(saved)
        return saved
      }

      const fallback = await defaultPinHashPromise
      setActivePinHash(fallback)
      return fallback
    }
  }, [defaultPinHashPromise, ensureRemotePinHash])

  useEffect(() => {
    if (!isAuthenticated) {
      setCoupons([])
      setDataError('')
      return
    }

    void loadCoupons()
  }, [isAuthenticated, loadCoupons])

  const groupedCoupons = useMemo(() => {
    const groups = new Map<string, { label: string; coupons: CouponView[] }>()

    for (const coupon of coupons) {
      const existingGroup = groups.get(coupon.effectiveDateKey)

      if (existingGroup) {
        existingGroup.coupons.push(coupon)
        continue
      }

      groups.set(coupon.effectiveDateKey, {
        label: formatDateLabel(coupon.effectiveDate),
        coupons: [coupon],
      })
    }

    return Array.from(groups.values())
  }, [coupons])

  function resetForm() {
    setForm(getEmptyForm())
  }

  function closeModal() {
    setIsModalOpen(false)
    setEditingCoupon(null)
    resetForm()
  }

  function openCreateModal() {
    setEditingCoupon(null)
    resetForm()
    setIsModalOpen(true)
  }

  function openEditModal(coupon: CouponView) {
    setEditingCoupon(coupon)
    setForm({
      name: coupon.name,
      amount: formatAmountInput(String(coupon.amount)),
      expiresAt: coupon.expires_at,
      isRecurring: coupon.is_recurring,
      imageFile: null,
      imagePreview: coupon.image_url,
      removeImage: false,
    })
    setIsModalOpen(true)
  }

  async function handlePinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (pin.length !== 4) {
      setAuthError('PIN 4자리를 입력해 주세요.')
      return
    }

    try {
      const expectedHash = await resolveExpectedPinHash()
      const inputHash = await hashPin(pin)

      if (inputHash !== expectedHash) {
        setAuthError('PIN 번호가 일치하지 않습니다.')
        return
      }
    } catch {
      setAuthError('PIN 확인 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.')
      return
    }

    if (rememberDevice) {
      window.localStorage.setItem(AUTH_STORAGE_KEY, 'true')
    } else {
      window.localStorage.removeItem(AUTH_STORAGE_KEY)
    }

    setAuthError('')
    setPin('')
    setIsAuthenticated(true)
  }

  function handleLock() {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    setRememberDevice(false)
    setPin('')
    setIsAuthenticated(false)
    setStatusMessage('자동 로그인을 해제했어요.')
  }

  function handlePinChange(event: ChangeEvent<HTMLInputElement>) {
    setPin(event.target.value.replace(/\D/g, '').slice(0, 4))

    if (authError) {
      setAuthError('')
    }
  }

  function handlePinFormFieldChange(
    setter: (value: string) => void,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    setter(event.target.value.replace(/\D/g, '').slice(0, 4))

    if (pinChangeError) {
      setPinChangeError('')
    }

    if (pinChangeMessage) {
      setPinChangeMessage('')
    }
  }

  function resetPinChangeForm() {
    setCurrentPinInput('')
    setNewPinInput('')
    setConfirmPinInput('')
    setPinChangeError('')
    setPinChangeMessage('')
  }

  function togglePinChangeForm() {
    setIsChangingPin((current) => {
      const nextValue = !current

      if (!nextValue) {
        resetPinChangeForm()
      }

      return nextValue
    })
  }

  function handlePinUpdate() {
    void (async () => {
      try {
        const expectedHash = activePinHash ?? (await resolveExpectedPinHash())
        const currentHash = await hashPin(currentPinInput)

        if (currentHash !== expectedHash) {
          setPinChangeError('현재 PIN 번호가 일치하지 않습니다.')
          return
        }

        if (newPinInput.length !== 4) {
          setPinChangeError('새 PIN 4자리를 입력해 주세요.')
          return
        }

        if (newPinInput !== confirmPinInput) {
          setPinChangeError('새 PIN 확인 값이 일치하지 않습니다.')
          return
        }

        const nextHash = await hashPin(newPinInput)

        if (supabaseReady) {
          const supabase = getSupabaseClient()
          const { error } = await supabase.from('app_settings').upsert({
            id: SETTINGS_ROW_ID,
            pin_hash: nextHash,
          })

          if (error) {
            throw error
          }
        }

        window.localStorage.setItem(PIN_HASH_STORAGE_KEY, nextHash)
        setActivePinHash(nextHash)
        setPinChangeMessage('PIN 번호를 변경했어요.')
        setCurrentPinInput('')
        setNewPinInput('')
        setConfirmPinInput('')
        setPin('')
        setAuthError('')
      } catch (error) {
        setPinChangeError(getErrorMessage(error))
      }
    })()
  }

  function handleNameChange(event: ChangeEvent<HTMLInputElement>) {
    setForm((current) => ({ ...current, name: event.target.value }))
  }

  function handleAmountChange(event: ChangeEvent<HTMLInputElement>) {
    setForm((current) => ({
      ...current,
      amount: formatAmountInput(event.target.value),
    }))
  }

  function handleDateChange(event: ChangeEvent<HTMLInputElement>) {
    setForm((current) => ({ ...current, expiresAt: event.target.value }))
  }

  function handleRecurringChange(event: ChangeEvent<HTMLInputElement>) {
    setForm((current) => ({ ...current, isRecurring: event.target.checked }))
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    try {
      const preview = await readFileAsDataUrl(file)
      setForm((current) => ({
        ...current,
        imageFile: file,
        imagePreview: preview,
        removeImage: false,
      }))
    } catch (error) {
      setDataError(getErrorMessage(error))
    }
  }

  function handleImageRemove() {
    setForm((current) => ({
      ...current,
      imageFile: null,
      imagePreview: null,
      removeImage: true,
    }))
  }

  async function uploadCouponImage(file: File) {
    const supabase = getSupabaseClient()
    const fileName = `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`

    const { error } = await supabase.storage.from(storageBucket).upload(fileName, file, {
      cacheControl: '3600',
      contentType: file.type || 'image/*',
      upsert: false,
    })

    if (error) {
      throw error
    }

    return supabase.storage.from(storageBucket).getPublicUrl(fileName).data.publicUrl
  }

  async function handleSaveCoupon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!supabaseReady) {
      setDataError('Supabase 환경 변수가 설정되지 않아 저장할 수 없어요.')
      return
    }

    if (!form.name.trim()) {
      setDataError('쿠폰 이름을 입력해 주세요.')
      return
    }

    if (!form.expiresAt) {
      setDataError('사용 기한을 선택해 주세요.')
      return
    }

    setIsSaving(true)
    setDataError('')

    try {
      const supabase = getSupabaseClient()
      let imageUrl = editingCoupon?.image_url ?? null

      if (form.removeImage) {
        imageUrl = null
      }

      if (form.imageFile) {
        imageUrl = await uploadCouponImage(form.imageFile)
      }

      const payload = {
        name: form.name.trim(),
        amount: parseAmount(form.amount),
        expires_at: form.expiresAt,
        is_recurring: form.isRecurring,
        image_url: imageUrl,
      }

      if (editingCoupon) {
        const { error } = await supabase.from('coupons').update(payload).eq('id', editingCoupon.id)

        if (error) {
          throw error
        }

        setStatusMessage('쿠폰을 수정했어요.')
      } else {
        const { error } = await supabase.from('coupons').insert(payload)

        if (error) {
          throw error
        }

        setStatusMessage('쿠폰을 등록했어요.')
      }

      closeModal()
      await loadCoupons()
    } catch (error) {
      setDataError(getErrorMessage(error))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDeleteCoupon(coupon: CouponView, actionLabel: '사용 완료' | '삭제') {
    if (!supabaseReady) {
      setDataError('Supabase 환경 변수가 설정되지 않아 삭제할 수 없어요.')
      return
    }

    const confirmed = window.confirm(
      actionLabel === '사용 완료'
        ? '이 쿠폰을 사용 완료로 처리하고 삭제할까요?'
        : '이 쿠폰을 삭제할까요?',
    )

    if (!confirmed) {
      return
    }

    setDataError('')

    try {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('coupons').delete().eq('id', coupon.id)

      if (error) {
        throw error
      }

      setStatusMessage(actionLabel === '사용 완료' ? '쿠폰을 사용 완료 처리했어요.' : '쿠폰을 삭제했어요.')
      await loadCoupons()
    } catch (error) {
      setDataError(getErrorMessage(error))
    }
  }

  if (isCheckingRememberedAuth) {
    return (
      <div className="auth-shell">
        <div className="pin-card">
          <p className="pin-subtitle">쿠폰북을 준비하는 중...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="auth-shell">
        <form className="pin-card" onSubmit={handlePinSubmit}>
          <div className="app-badge">
            <BookIcon />
            <span>나의 쿠폰북</span>
          </div>
          <h1>4자리 PIN 입력</h1>
          <label className="field">
            <span className="field-label-row">
              <span>PIN 번호</span>
              <button type="button" className="inline-button" onClick={togglePinChangeForm}>
                {isChangingPin ? '닫기' : '변경하기'}
              </button>
            </span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              placeholder="0000"
              value={pin}
              onChange={handlePinChange}
            />
          </label>
          {isChangingPin ? (
            <div className="pin-change-panel">
              <label className="field">
                <span>현재 PIN</span>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="현재 PIN"
                  value={currentPinInput}
                  onChange={(event) => handlePinFormFieldChange(setCurrentPinInput, event)}
                />
              </label>
              <label className="field">
                <span>새 PIN</span>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="새 PIN"
                  value={newPinInput}
                  onChange={(event) => handlePinFormFieldChange(setNewPinInput, event)}
                />
              </label>
              <label className="field">
                <span>새 PIN 확인</span>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="새 PIN 다시 입력"
                  value={confirmPinInput}
                  onChange={(event) => handlePinFormFieldChange(setConfirmPinInput, event)}
                />
              </label>
              {pinChangeError ? <p className="error-text">{pinChangeError}</p> : null}
              {pinChangeMessage ? <p className="helper-text">{pinChangeMessage}</p> : null}
              <button type="button" className="secondary-button" onClick={handlePinUpdate}>
                PIN 변경 저장
              </button>
            </div>
          ) : null}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={(event) => setRememberDevice(event.target.checked)}
            />
            <span>이 기기 기억하기</span>
          </label>
          {authError ? <p className="error-text">{authError}</p> : null}
          <button type="submit" className="primary-button">
            입장하기
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <div className="app-icon">
            <BookIcon />
          </div>
          <h1>나의 쿠폰북</h1>
        </div>
        <button type="button" className="secondary-button lock-button" onClick={handleLock}>
          잠금
        </button>
      </header>

      {!supabaseReady ? (
        <section className="notice-card">
          <h2>Supabase 연결이 필요해요</h2>
          <p>`.env`에 URL, Anon Key, PIN 값을 넣은 뒤 다시 실행해 주세요.</p>
          <p>테이블과 스토리지 설정은 `supabase-schema.sql` 파일에 정리해 두었습니다.</p>
        </section>
      ) : null}

      {dataError ? (
        <section className="notice-card error-card">
          <h2>처리 중 문제가 생겼어요</h2>
          <p>{dataError}</p>
        </section>
      ) : null}

      {statusMessage ? <div className="toast-message">{statusMessage}</div> : null}

      <main className="content-area">
        {isLoadingCoupons ? (
          <section className="empty-state">
            <p>쿠폰 목록을 불러오는 중입니다...</p>
          </section>
        ) : null}

        {!isLoadingCoupons && groupedCoupons.length === 0 ? (
          <section className="empty-state">
            <div className="empty-illustration">
              <BookIcon />
            </div>
            <h2>아직 등록된 쿠폰이 없어요</h2>
            <p>하단의 + 버튼을 눌러 첫 번째 쿠폰을 추가해 보세요.</p>
          </section>
        ) : null}

        {!isLoadingCoupons &&
          groupedCoupons.map((group) => (
            <section key={group.label} className="coupon-section">
              <h2 className="section-heading">{group.label}</h2>
              <div className="coupon-list">
                {group.coupons.map((coupon) => (
                  <article key={coupon.id} className="coupon-card">
                    <div className="coupon-card-body">
                      <div className="coupon-copy">
                        <div className="coupon-meta">
                          {coupon.is_recurring ? <span className="chip">매달 반복</span> : null}
                        </div>
                        <h3>{coupon.name}</h3>
                        <p className="coupon-amount">
                          {coupon.amount > 0 ? `${coupon.amount.toLocaleString('ko-KR')}원` : '금액 없음'}
                        </p>
                      </div>

                      <div className="coupon-visual">
                        {coupon.image_url ? (
                          <button
                            type="button"
                            className="image-button"
                            aria-label={`${coupon.name} 원본 이미지 보기`}
                            onClick={() => setSelectedImage({ url: coupon.image_url!, name: coupon.name })}
                          >
                            <img src={coupon.image_url} alt={`${coupon.name} 썸네일`} />
                          </button>
                        ) : (
                          <div className="coupon-placeholder">
                            <ImageIcon />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="coupon-actions">
                      <div className="corner-actions">
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="쿠폰 수정"
                          onClick={() => openEditModal(coupon)}
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="쿠폰 삭제"
                          onClick={() => handleDeleteCoupon(coupon, '삭제')}
                        >
                          <DeleteIcon />
                        </button>
                      </div>

                      <button
                        type="button"
                        className="complete-button"
                        onClick={() => handleDeleteCoupon(coupon, '사용 완료')}
                      >
                        <CheckIcon />
                        <span>사용 완료</span>
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
      </main>

      <button
        type="button"
        className="fab-button"
        aria-label="쿠폰 등록"
        onClick={openCreateModal}
        disabled={!supabaseReady}
      >
        <PlusIcon />
      </button>

      {isModalOpen ? (
        <div className="modal-overlay" role="presentation" onClick={closeModal}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">{editingCoupon ? '쿠폰 수정' : '쿠폰 등록'}</p>
                <h2>{editingCoupon ? '쿠폰 정보를 바꿔보세요' : '새 쿠폰을 추가해 보세요'}</h2>
              </div>
              <button type="button" className="icon-button" aria-label="팝업 닫기" onClick={closeModal}>
                <CloseIcon />
              </button>
            </div>

            <form className="coupon-form" onSubmit={handleSaveCoupon}>
              <label className="field">
                <span>쿠폰 이름</span>
                <input
                  type="text"
                  placeholder="예: 카페 음료 쿠폰"
                  value={form.name}
                  onChange={handleNameChange}
                />
              </label>

              <label className="field">
                <span>금액</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="예: 10,000"
                  value={form.amount}
                  onChange={handleAmountChange}
                />
              </label>

              <label className="field">
                <span>사용 기한</span>
                <input type="date" value={form.expiresAt} onChange={handleDateChange} />
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.isRecurring}
                  onChange={handleRecurringChange}
                />
                <span>매달 반복</span>
              </label>
              <p className="helper-text">체크하면 같은 날짜의 월간 쿠폰이 자동으로 다음 회차로 이어집니다.</p>

              <label className="field">
                <span>이미지 첨부</span>
                <input type="file" accept="image/*" onChange={handleImageChange} />
              </label>

              {form.imagePreview ? (
                <div className="preview-panel">
                  <img src={form.imagePreview} alt="업로드 미리보기" />
                  <button type="button" className="text-button" onClick={handleImageRemove}>
                    이미지 제거
                  </button>
                </div>
              ) : null}

              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeModal}>
                  취소
                </button>
                <button type="submit" className="primary-button" disabled={isSaving}>
                  {isSaving ? '저장 중...' : editingCoupon ? '수정 저장' : '등록하기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {selectedImage ? (
        <div className="modal-overlay image-viewer-overlay" role="presentation" onClick={() => setSelectedImage(null)}>
          <div
            className="image-viewer-card"
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedImage.name} 원본 이미지`}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="icon-button image-viewer-close"
              aria-label="원본 이미지 닫기"
              onClick={() => setSelectedImage(null)}
            >
              <CloseIcon />
            </button>
            <img src={selectedImage.url} alt={`${selectedImage.name} 원본`} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.25 6.25h9.5a1.9 1.9 0 0 1 1.9 1.9v1.2a1.45 1.45 0 0 0 0 2.9v3.3a1.45 1.45 0 0 0 0 2.9v1.2a1.9 1.9 0 0 1-1.9 1.9h-9.5a1.9 1.9 0 0 1-1.9-1.9v-1.2a1.45 1.45 0 0 0 0-2.9v-3.3a1.45 1.45 0 0 0 0-2.9v-1.2a1.9 1.9 0 0 1 1.9-1.9Z"
        fill="currentColor"
        opacity="0.2"
      />
      <path
        d="M7.25 6.25h9.5a1.9 1.9 0 0 1 1.9 1.9v1.2a1.45 1.45 0 0 0 0 2.9v3.3a1.45 1.45 0 0 0 0 2.9v1.2a1.9 1.9 0 0 1-1.9 1.9h-9.5a1.9 1.9 0 0 1-1.9-1.9v-1.2a1.45 1.45 0 0 0 0-2.9v-3.3a1.45 1.45 0 0 0 0-2.9v-1.2a1.9 1.9 0 0 1 1.9-1.9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12 8.2v7.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="1.6 2.2"
      />
      <path
        d="M9.6 11h1.7M9.6 13h1.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="10" r="1.5" fill="currentColor" />
      <path
        d="m7 16 3.5-3.5L13 15l2-2 2 3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m5 16.75 9.8-9.8a1.8 1.8 0 0 1 2.55 0l.7.7a1.8 1.8 0 0 1 0 2.55L8.25 20H5v-3.25Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5.5 7.5h13M9.5 4.75h5l.75 2.75m-8 0 .55 9.2A2 2 0 0 0 9.8 18.6h4.4a2 2 0 0 0 1.99-1.9l.56-9.2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m6.5 12.5 3.25 3.25L17.5 8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m7 7 10 10M17 7 7 17"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

export default App
