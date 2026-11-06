import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/client/lib/api-client'
import { useSession } from '@/client/lib/auth'

export function LoginPage() {
  const navigate = useNavigate()
  const { data: sessionData, isPending } = useSession()
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isShaking, setIsShaking] = useState(false)
  const [loading, setLoading] = useState(false)
  const hiddenInputRef = useRef<HTMLInputElement>(null)

  // If already authenticated, redirect to home
  useEffect(() => {
    if (!isPending && sessionData?.user) {
      navigate('/', { replace: true })
    }
  }, [sessionData, isPending, navigate])

  // Keep hidden input focused for keyboard input
  useEffect(() => {
    hiddenInputRef.current?.focus()
  }, [])

  // Auto-login via direct link query parameter: ?key=576257 or ?passcode=576257
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const directKey = params.get('key') || params.get('passcode')
    if (directKey && directKey.trim() === '576257') {
      handleSubmit(directKey.trim())
    }
  }, [])

  const handleSubmit = async (codeToSubmit: string) => {
    if (loading) return
    if (!codeToSubmit || codeToSubmit.length < 6) {
      triggerError('请输入完整的 6 位密码')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await api.auth.verifyPasscode(codeToSubmit)
      if (res.success) {
        // Successful unlock: redirect to workspace
        window.location.href = '/flaredraw/'
      } else {
        triggerError('密码错误，请重新输入')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '验证失败'
      triggerError(msg.includes('401') || msg.includes('密码') ? '密码错误，请重新输入' : msg)
    } finally {
      setLoading(false)
    }
  }

  const triggerError = (msg: string) => {
    setError(msg)
    setIsShaking(true)
    setTimeout(() => {
      setIsShaking(false)
      setPasscode('')
      hiddenInputRef.current?.focus()
    }, 600)
  }

  const handleDigitPress = (digit: string) => {
    if (loading || passcode.length >= 6) return
    setError(null)
    const nextCode = passcode + digit
    setPasscode(nextCode)

    // Instant unlock when 6 digits are typed
    if (nextCode.length === 6) {
      handleSubmit(nextCode)
    }
  }

  const handleDelete = () => {
    if (loading) return
    setError(null)
    setPasscode((prev) => prev.slice(0, -1))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit(passcode)
    }
  }

  const keypadNumbers = [
    { num: '1', letters: '' },
    { num: '2', letters: 'A B C' },
    { num: '3', letters: 'D E F' },
    { num: '4', letters: 'G H I' },
    { num: '5', letters: 'J K L' },
    { num: '6', letters: 'M N O' },
    { num: '7', letters: 'P Q R S' },
    { num: '8', letters: 'T U V' },
    { num: '9', letters: 'W X Y Z' },
  ]

  return (
    <div
      onClick={() => hiddenInputRef.current?.focus()}
      className="relative flex min-h-screen w-full flex-col items-center justify-between select-none overflow-hidden bg-gradient-to-b from-zinc-900 via-zinc-950 to-black px-4 py-8 text-white sm:py-12"
    >
      {/* Hidden input to capture physical keyboard & mobile virtual keyboard */}
      <input
        ref={hiddenInputRef}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        value={passcode}
        onChange={(e) => {
          const val = e.target.value.replace(/\D/g, '')
          setPasscode(val)
          if (val.length === 6) {
            handleSubmit(val)
          }
        }}
        onKeyDown={handleKeyDown}
        className="sr-only opacity-0 pointer-events-none"
        autoFocus
      />

      {/* Top Lock Header */}
      <div className="flex flex-col items-center pt-6 sm:pt-10">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 shadow-inner">
          <svg
            className="h-7 w-7 text-white/90"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white/95">
          FlareDraw
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          请输入访问密码以解锁工作台 (180天免登)
        </p>
      </div>

      {/* Passcode Indicator Dots */}
      <div className="my-auto flex flex-col items-center py-6">
        <div
          className={`flex items-center gap-4 transition-transform duration-150 ${
            isShaking ? 'translate-x-[-12px] animate-pulse text-red-400' : ''
          }`}
          style={{
            animation: isShaking ? 'shake 0.5s cubic-bezier(.36,.07,.19,.97) both' : 'none',
          }}
        >
          {[0, 1, 2, 3, 4, 5].map((index) => {
            const isFilled = passcode.length > index
            return (
              <div
                key={index}
                className={`h-4 w-4 rounded-full transition-all duration-200 ${
                  isFilled
                    ? 'scale-110 bg-white shadow-[0_0_12px_rgba(255,255,255,0.7)]'
                    : 'border-2 border-white/40 bg-transparent'
                } ${isShaking ? 'border-red-400 bg-red-400' : ''}`}
              />
            )
          })}
        </div>

        {/* Error or Loading Feedback */}
        <div className="h-8 mt-4 flex items-center justify-center">
          {loading ? (
            <span className="text-xs tracking-wider text-blue-400 animate-pulse">
              正在解锁...
            </span>
          ) : error ? (
            <span className="text-xs font-medium text-rose-400 bg-rose-950/40 px-3 py-1 rounded-full border border-rose-800/40">
              {error}
            </span>
          ) : (
            <span className="text-xs text-zinc-500">
              支持键盘输入或点击拨号盘
            </span>
          )}
        </div>

        {/* iOS Dial Keypad */}
        <div className="grid grid-cols-3 gap-x-6 gap-y-4 pt-4 sm:gap-x-8 sm:gap-y-5">
          {keypadNumbers.map(({ num, letters }) => (
            <button
              key={num}
              type="button"
              onClick={() => handleDigitPress(num)}
              className="flex h-18 w-18 sm:h-20 sm:w-20 flex-col items-center justify-center rounded-full bg-white/10 border border-white/10 backdrop-blur-md transition-all active:scale-95 active:bg-white/30 hover:bg-white/15 cursor-pointer shadow-sm"
            >
              <span className="text-2xl sm:text-3xl font-light text-white">{num}</span>
              {letters ? (
                <span className="text-[9px] font-semibold tracking-widest text-zinc-400 -mt-0.5">
                  {letters}
                </span>
              ) : (
                <span className="h-3" />
              )}
            </button>
          ))}

          {/* Bottom row: Blank / Unlock Button / 0 / Delete */}
          <button
            type="button"
            onClick={() => handleSubmit(passcode)}
            disabled={passcode.length === 0 || loading}
            className="flex h-18 w-18 sm:h-20 sm:w-20 items-center justify-center rounded-full text-xs font-medium text-blue-400 hover:text-blue-300 disabled:opacity-0 transition-opacity"
          >
            解锁
          </button>

          <button
            type="button"
            onClick={() => handleDigitPress('0')}
            className="flex h-18 w-18 sm:h-20 sm:w-20 flex-col items-center justify-center rounded-full bg-white/10 border border-white/10 backdrop-blur-md transition-all active:scale-95 active:bg-white/30 hover:bg-white/15 cursor-pointer shadow-sm"
          >
            <span className="text-2xl sm:text-3xl font-light text-white">0</span>
          </button>

          <button
            type="button"
            onClick={handleDelete}
            className="flex h-18 w-18 sm:h-20 sm:w-20 items-center justify-center rounded-full text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414-6.414A2 2 0 0110.828 5H20a2 2 0 012 2v10a2 2 0 01-2 2h-9.172a2 2 0 01-1.414-.586L3 12z"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="pb-4 text-center">
        <p className="text-[11px] text-zinc-500">
          Cloudflare Workers & D1 & R2 • 端到端全栈协同
        </p>
      </div>

      <style>{`
        @keyframes shake {
          10%, 90% { transform: translate3d(-2px, 0, 0); }
          20%, 80% { transform: translate3d(4px, 0, 0); }
          30%, 50%, 70% { transform: translate3d(-6px, 0, 0); }
          40%, 60% { transform: translate3d(6px, 0, 0); }
        }
      `}</style>
    </div>
  )
}
