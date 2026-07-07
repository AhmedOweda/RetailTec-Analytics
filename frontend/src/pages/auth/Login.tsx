import React, { useState, useEffect } from 'react'
import { tr } from '../../i18n'
import { useNavigate }   from 'react-router-dom'
import { useAuth }       from '../../contexts/AuthContext'

/* ─────────────────────────────────────────────────────────────────────────────
   Pure-CSS / inline-style login — no MUI dependency, avoids any potential
   import tree that could block the build.
───────────────────────────────────────────────────────────────────────────── */

const S = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    background: 'radial-gradient(ellipse 80% 60% at 50% -10%, #3b1fa8 0%, #0f172a 65%)',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  } as React.CSSProperties,

  left: {
    flex: '0 0 45%',
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'space-between',
    padding: '48px 56px',
    color: '#fff',
  },

  right: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px',
  },

  card: {
    width: '100%',
    maxWidth: 420,
    background: 'rgba(40,30,80,0.72)',
    backdropFilter: 'blur(28px)',
    WebkitBackdropFilter: 'blur(28px)',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: 20,
    padding: '44px 40px',
    boxShadow: '0 32px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.12)',
  },

  logoIcon: {
    marginBottom: 28,
  } as React.CSSProperties,

  heading: {
    fontSize: 26, fontWeight: 700,
    color: '#f8fafc', marginBottom: 6, lineHeight: 1.2,
  },

  sub: { fontSize: 14, color: 'rgba(255,255,255,0.45)', marginBottom: 36 },

  label: {
    display: 'block', fontSize: 12, fontWeight: 600,
    color: 'rgba(255,255,255,0.55)', marginBottom: 7, letterSpacing: 0.4,
  },

  inputWrap: { position: 'relative' as const, marginBottom: 20 },

  input: {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: 'rgba(255,255,255,0.09)',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: 10,
    padding: '13px 44px 13px 16px',
    fontSize: 14, color: '#f1f5f9',
    outline: 'none',
    transition: 'border-color .2s, box-shadow .2s',
  } as React.CSSProperties,

  eye: {
    position: 'absolute' as const, right: 14, top: '50%',
    transform: 'translateY(-50%)',
    background: 'none', border: 'none',
    color: 'rgba(255,255,255,0.35)',
    cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1,
  },

  btn: {
    width: '100%',
    padding: '14px 0',
    borderRadius: 10,
    border: 'none',
    background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
    color: '#fff',
    fontSize: 15, fontWeight: 700,
    cursor: 'pointer',
    marginTop: 8,
    boxShadow: '0 4px 16px rgba(99,102,241,0.40)',
    transition: 'opacity .15s, transform .1s',
  } as React.CSSProperties,

  error: {
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid rgba(239,68,68,0.35)',
    borderRadius: 8, padding: '11px 14px',
    fontSize: 13, color: '#fca5a5',
    marginBottom: 20,
  },

  badgeRow: {
    display: 'flex', gap: 10, flexWrap: 'wrap' as const, marginTop: 'auto',
  },

  badge: {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 20,
    padding: '5px 14px',
    fontSize: 12, color: 'rgba(255,255,255,0.55)',
  },
}

/* ── Animated background: drifting gradient orbs + self-drawing sales line.
   Pure CSS/SVG, sits behind both panels, disabled for reduced-motion users. ── */
const AnimatedBg = () => (
  <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
    <style>{`
      @keyframes rtOrbA { 0%{transform:translate(0,0) scale(1)} 50%{transform:translate(120px,60px) scale(1.15)} 100%{transform:translate(0,0) scale(1)} }
      @keyframes rtOrbB { 0%{transform:translate(0,0) scale(1)} 50%{transform:translate(-100px,-70px) scale(1.1)} 100%{transform:translate(0,0) scale(1)} }
      @keyframes rtOrbC { 0%{transform:translate(0,0)} 50%{transform:translate(60px,-90px)} 100%{transform:translate(0,0)} }
      @keyframes rtDraw {
        0%   { stroke-dashoffset: 1; opacity: 0 }
        6%   { opacity: .9 }
        55%  { stroke-dashoffset: 0; opacity: .9 }
        82%  { opacity: .9 }
        100% { stroke-dashoffset: 0; opacity: 0 }
      }
      @keyframes rtDot {
        0%, 55% { opacity: 0; transform: scale(.4) }
        62%     { opacity: .9; transform: scale(1.25) }
        70%     { opacity: .7; transform: scale(1) }
        80%     { opacity: .7 }
        100%    { opacity: 0 }
      }
      .rt-orb { position: absolute; border-radius: 50%; filter: blur(90px); will-change: transform; }
      .rt-orb-a { width: 520px; height: 520px; left: -140px; top: -120px;
                  background: rgba(124,58,237,0.40); animation: rtOrbA 14s ease-in-out infinite; }
      .rt-orb-b { width: 460px; height: 460px; right: -120px; bottom: -140px;
                  background: rgba(99,102,241,0.32); animation: rtOrbB 18s ease-in-out infinite; }
      .rt-orb-c { width: 340px; height: 340px; left: 38%; top: 55%;
                  background: rgba(6,182,212,0.20); animation: rtOrbC 22s ease-in-out infinite; }
      .rt-line  { stroke-dasharray: 1; stroke-dashoffset: 1; animation: rtDraw 5.5s ease-in-out infinite; }
      .rt-area  { opacity: 0; animation: rtArea 5.5s ease-in-out infinite; }
      @keyframes rtArea { 0%,30%{opacity:0} 55%,84%{opacity:1} 100%{opacity:0} }
      .rt-dot   { opacity: 0; transform-origin: center; transform-box: fill-box; animation: rtDot 5.5s ease-in-out infinite; }
    `}</style>
    <div className="rt-orb rt-orb-a" />
    <div className="rt-orb rt-orb-b" />
    <div className="rt-orb rt-orb-c" />
    <svg viewBox="0 0 600 300" preserveAspectRatio="none"
         style={{ position: 'absolute', left: '3%', bottom: '22%', width: '44%', height: '30%' }}>
      <defs>
        <linearGradient id="rtStroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#a78bfa" stopOpacity=".15" />
          <stop offset="25%"  stopColor="#a78bfa" stopOpacity="1" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="1" />
        </linearGradient>
        <linearGradient id="rtFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#a78bfa" stopOpacity=".24" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="rt-area" pathLength={1}
        d="M 10 240 C 70 228, 110 232, 160 214 S 260 196, 320 172 S 440 128, 520 92 L 570 72 L 570 300 L 10 300 Z"
        fill="url(#rtFill)" stroke="none" />
      <path className="rt-line" pathLength={1}
        d="M 10 240 C 70 228, 110 232, 160 214 S 260 196, 320 172 S 440 128, 520 92 L 570 72"
        fill="none" stroke="url(#rtStroke)" strokeWidth="2.4"
        strokeLinecap="round" strokeLinejoin="round" />
      {[[160,214],[320,172],[520,92]].map(([x,y]) => (
        <circle key={`${x}-${y}`} className="rt-dot" cx={x} cy={y} r="3.5" fill="#c4b5fd" />
      ))}
    </svg>
  </div>
)

const GridBg = () => (
  <svg
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
             pointerEvents: 'none', opacity: 0.08 }}
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#fff" strokeWidth="0.5"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)" />
  </svg>
)

export default function Login() {
  const { login, user }        = useAuth()
  const nav                    = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [focused,  setFocused]  = useState<string | null>(null)

  // Navigate only after context actually has the user — avoids React 18 batching race
  useEffect(() => {
    if (user) nav('/', { replace: true })
  }, [user, nav])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setLoading(true)
    try {
      await login(username.trim(), password)
      // nav() is handled by the useEffect above once user state commits
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Incorrect username or password')
    } finally {
      setLoading(false)
    }
  }

  function inputStyle(name: string): React.CSSProperties {
    return {
      ...S.input,
      borderColor: focused === name
        ? 'rgba(139,92,246,0.7)'
        : error ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.12)',
      boxShadow: focused === name ? '0 0 0 3px rgba(139,92,246,0.18)' : 'none',
    }
  }

  return (
    <div style={{ ...S.page, position: 'relative', overflow: 'hidden' }}>
      <AnimatedBg />
      <GridBg />

      {/* ── Left panel — brand messaging ─────────────────────────────── */}
      <div style={{ ...S.left, position: 'relative', zIndex: 1 }}>
        {/* Logo */}
        <div>
          <div style={S.logoIcon}>
            <img src="/logo-white.png" alt="RetailTec"
              style={{ height: 52, objectFit: 'contain' }} />
          </div>
          <div style={{ fontSize: 42, fontWeight: 800, lineHeight: 1.15,
                        letterSpacing: -1, maxWidth: 340 }}>
            Retail Intelligence,{' '}
            <span style={{ color: '#a78bfa' }}>Redefined.</span>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 15,
                      marginTop: 20, maxWidth: 320, lineHeight: 1.65 }}>
            Real-time analytics across sales, inventory, and purchasing —
            all from a single platform built on your Retail Pro data.
          </p>
        </div>

        {/* Feature badges */}
        <div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)',
                      textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 14 }}>
            Powered by
          </p>
          <div style={S.badgeRow}>
            {['Retail Pro Prism', 'DuckDB', 'FastAPI', 'React'].map(b => (
              <span key={b} style={S.badge}>{b}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right panel — login card ──────────────────────────────────── */}
      <div style={{ ...S.right, position: 'relative', zIndex: 1 }}>
        <div style={S.card}>
          {/* Logo in card */}
          <img src="/logo-white.png" alt="RetailTec"
            style={{ height: 40, objectFit: 'contain', marginBottom: 28 }} />

          <div style={S.heading}>{tr('Welcome back')}</div>
          <div style={S.sub}>{tr('Sign in to your RetailTec workspace')}</div>

          {error && <div style={S.error}>⚠ {error}</div>}

          <form onSubmit={handleSubmit} autoComplete="on">
            <div style={S.inputWrap}>
              <label style={S.label} htmlFor="username">{tr('USERNAME')}</label>
              <input
                id="username"
                autoFocus
                autoComplete="username"
                style={inputStyle('username')}
                value={username}
                onChange={e => setUsername(e.target.value)}
                onFocus={() => setFocused('username')}
                onBlur={() => setFocused(null)}
                placeholder="Enter your username"
                required
              />
            </div>

            <div style={{ ...S.inputWrap, marginBottom: 28 }}>
              <label style={S.label} htmlFor="password">{tr('PASSWORD')}</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  style={inputStyle('password')}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onFocus={() => setFocused('password')}
                  onBlur={() => setFocused(null)}
                  placeholder="••••••••"
                  required
                />
                <button type="button" style={S.eye}
                  onClick={() => setShowPw(v => !v)}>
                  {showPw ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !username || !password}
              style={{
                ...S.btn,
                opacity: (loading || !username || !password) ? 0.55 : 1,
                cursor:  (loading || !username || !password) ? 'not-allowed' : 'pointer',
              }}
            >
              {loading
                ? '⏳  Signing in…'
                : tr('Sign In →')
              }
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 28, fontSize: 12,
                      color: 'rgba(255,255,255,0.2)' }}>
            RetailTec Analytics v3.0 · {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  )
}
