import React from 'react'
import { Loader2, ArrowUpRight } from '../../icons'
import type { AuthState } from '../../../../shared/auth'
import { TitleBar } from '../TitleBar'
import appIcon from '../../../../../resources/icon.png'

interface AuthScreenProps {
  auth: AuthState
  busy: boolean
  onLogin: () => void
  onCancelLogin: () => void
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  auth,
  busy,
  onLogin,
  onCancelLogin
}) => {
  const isAuthorizing = auth.status === 'authorizing'

  return (
    <div className="flex flex-col h-screen w-screen bg-sidebar text-primary overflow-hidden select-none font-sans">
      <TitleBar isSidebarOpen={true} sidebarWidth={200} />

      <div className="flex-1 min-h-0 px-2 pb-2 flex">
        <main className="flex-1 min-w-0 flex flex-col items-center justify-center rounded-[18px] bg-canvas px-4 py-8">
          <div className="w-full max-w-[400px] rounded-[24px] bg-surface p-8 sm:p-9 flex flex-col items-center text-center border-none shadow-none">
            <img
              src={appIcon}
              alt="Zipply"
              className="mb-6 h-14 w-14 rounded-[16px] object-cover select-none pointer-events-none"
              draggable={false}
            />

            <h1 className="text-[24px] font-bold tracking-tight text-primary leading-[30px]">
              Добро пожаловать в Zipply
            </h1>
            <p className="mt-2.5 text-[15px] leading-[22px] text-secondary">
              {isAuthorizing
                ? 'Завершите вход в открывшемся окне браузера, чтобы продолжить.'
                : 'Войдите через аккаунт Zipply, чтобы открыть чаты, проекты и инструменты.'}
            </p>

            {auth.error && (
              <div
                role="alert"
                className="mt-5 w-full rounded-[16px] bg-control px-4 py-3 text-left text-[14px] leading-[20px] text-secondary border-none shadow-none"
              >
                {auth.error}
              </div>
            )}

            <div className="mt-7 w-full flex flex-col gap-2.5">
              {isAuthorizing ? (
                <>
                  <div className="flex h-12 w-full items-center justify-center gap-2.5 rounded-full bg-control px-5 text-[15px] font-medium text-primary">
                    <Loader2 size={17} className="animate-spin text-secondary" aria-hidden="true" />
                    <span>Ожидание входа…</span>
                  </div>
                  <button
                    type="button"
                    onClick={onCancelLogin}
                    className="h-11 w-full rounded-full bg-transparent hover:bg-hover text-[14.5px] font-medium text-secondary hover:text-primary active:scale-[0.985] transition-all border-none shadow-none cursor-pointer"
                  >
                    Отменить
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onLogin}
                  disabled={busy}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent hover:bg-accent-hover text-[15.5px] font-medium text-on-accent active:scale-[0.985] transition-all disabled:opacity-50 disabled:cursor-not-allowed border-none shadow-none cursor-pointer"
                >
                  <span>Войти через Zipply</span>
                  <ArrowUpRight size={17} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
