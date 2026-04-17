'use client'
import { useEffect, useRef } from 'react'

type HotelPin = {
  id: string
  name: string
  distance: number
  featured?: boolean
  availability?: string
}

type Props = {
  hotels: HotelPin[]
  maxDistance: number
  direction: string
  onPinClick?: (id: string) => void
}

export default function HighwayView({ hotels, maxDistance, direction, onPinClick }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const cap = Math.max(...hotels.map(h => h.distance), 10, Math.min(maxDistance, 120))

  // Scale factor: distance (mi) → px on highway
  const pxPerMile = 600 / cap

  const badgeColor = (b?: string) => {
    switch (b) {
      case 'limited': return '#f5a623'
      case 'full': return '#ff6b6b'
      default: return '#3ecf8e'
    }
  }

  return (
    <div style={{
      position: 'relative',
      background: 'var(--night2)',
      border: '1px solid var(--border)',
      borderRadius: '14px',
      padding: '20px 0 24px',
      marginBottom: '20px',
      overflow: 'hidden',
    }}>
      {/* Distance scale header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        padding: '0 20px 14px', fontSize: '10px', color: 'var(--fog)',
        fontFamily: 'Syne, sans-serif', letterSpacing: '1px',
      }}>
        <span>📍 YOU ARE HERE</span>
        <span>→ {direction}BOUND · {cap.toFixed(0)} MI AHEAD</span>
      </div>

      {/* Scrollable highway */}
      <div ref={trackRef} style={{
        overflowX: 'auto', overflowY: 'visible',
        paddingBottom: '8px',
        WebkitOverflowScrolling: 'touch',
      }}>
        <div style={{
          position: 'relative',
          width: `${600 + 80}px`,
          minWidth: '100%',
          height: '160px',
          padding: '0 40px',
        }}>
          {/* Road surface */}
          <div style={{
            position: 'absolute',
            left: '40px', right: '40px',
            top: '90px',
            height: '36px',
            background: 'linear-gradient(180deg, #3a3f4e 0%, #2a2e3a 100%)',
            borderRadius: '2px',
            boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.3)',
          }} />

          {/* Yellow center line (dashed, animated) */}
          <div style={{
            position: 'absolute',
            left: '40px', right: '40px',
            top: '106px',
            height: '3px',
            background: 'repeating-linear-gradient(90deg, #f5a623 0 20px, transparent 20px 40px)',
            opacity: 0.85,
            animation: 'roadmove 1.2s linear infinite',
            backgroundSize: '40px 100%',
          }} />

          {/* White edge lines */}
          <div style={{
            position: 'absolute', left: '40px', right: '40px',
            top: '92px', height: '1px', background: 'rgba(255,255,255,0.3)',
          }} />
          <div style={{
            position: 'absolute', left: '40px', right: '40px',
            top: '124px', height: '1px', background: 'rgba(255,255,255,0.3)',
          }} />

          {/* The car at "you are here" position */}
          <div style={{
            position: 'absolute',
            left: '20px',
            top: '82px',
            zIndex: 10,
          }}>
            <svg width="44" height="52" viewBox="0 0 44 52" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <radialGradient id="carGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#f5a623" stopOpacity="0.6"/>
                  <stop offset="100%" stopColor="#f5a623" stopOpacity="0"/>
                </radialGradient>
              </defs>
              {/* glow */}
              <ellipse cx="22" cy="26" rx="22" ry="12" fill="url(#carGlow)"/>
              {/* car body */}
              <rect x="8" y="14" width="28" height="24" rx="4" fill="#f5a623"/>
              <rect x="10" y="18" width="24" height="10" rx="2" fill="#0d0f14" opacity="0.4"/>
              {/* wheels */}
              <circle cx="14" cy="38" r="3.5" fill="#0d0f14"/>
              <circle cx="30" cy="38" r="3.5" fill="#0d0f14"/>
              <circle cx="14" cy="38" r="1.5" fill="#555"/>
              <circle cx="30" cy="38" r="1.5" fill="#555"/>
              {/* headlights pointing right */}
              <circle cx="36" cy="21" r="1.5" fill="#fff"/>
              <circle cx="36" cy="31" r="1.5" fill="#fff"/>
            </svg>
            <div style={{
              textAlign: 'center', fontSize: '9px', color: 'var(--amber)',
              fontFamily: 'Syne, sans-serif', letterSpacing: '0.5px', marginTop: '-4px',
            }}>YOU</div>
          </div>

          {/* Hotel pins */}
          {hotels.map((h, idx) => {
            const leftPx = 40 + (h.distance * pxPerMile)
            // Stagger pins vertically so they don't overlap when close together
            const row = idx % 2
            const pinTop = row === 0 ? 0 : 130
            const pinDirection = row === 0 ? 'down' : 'up'
            return (
              <div
                key={h.id}
                onClick={() => onPinClick?.(h.id)}
                style={{
                  position: 'absolute',
                  left: `${leftPx}px`,
                  top: `${pinTop}px`,
                  transform: 'translateX(-50%)',
                  cursor: 'pointer',
                  width: '90px',
                  zIndex: 5,
                }}>
                {/* Balloon */}
                {pinDirection === 'down' ? (
                  <>
                    <div style={{
                      background: h.featured ? 'linear-gradient(135deg, #f5a623, #e8941a)' : 'var(--night3)',
                      border: h.featured ? '1px solid #f5a623' : `1px solid ${badgeColor(h.availability)}`,
                      borderRadius: '10px',
                      padding: '6px 8px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                      fontFamily: 'Syne, sans-serif',
                    }}>
                      <div style={{
                        fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px',
                        color: h.featured ? '#0d0f14' : badgeColor(h.availability),
                      }}>
                        {h.distance.toFixed(1)} MI
                      </div>
                      <div style={{
                        fontSize: '10px', color: h.featured ? '#0d0f14' : 'var(--white)',
                        fontWeight: 500, fontFamily: 'DM Sans, sans-serif',
                        lineHeight: 1.2, marginTop: '1px',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {h.name}
                      </div>
                    </div>
                    {/* tail + pin line */}
                    <div style={{
                      width: '2px', height: '28px',
                      background: h.featured ? '#f5a623' : badgeColor(h.availability),
                      margin: '0 auto',
                    }} />
                    <div style={{
                      width: '10px', height: '10px', borderRadius: '50%',
                      background: h.featured ? '#f5a623' : badgeColor(h.availability),
                      margin: '-4px auto 0',
                      boxShadow: `0 0 8px ${h.featured ? '#f5a623' : badgeColor(h.availability)}`,
                    }} />
                  </>
                ) : (
                  <>
                    <div style={{
                      width: '10px', height: '10px', borderRadius: '50%',
                      background: h.featured ? '#f5a623' : badgeColor(h.availability),
                      margin: '0 auto',
                      boxShadow: `0 0 8px ${h.featured ? '#f5a623' : badgeColor(h.availability)}`,
                    }} />
                    <div style={{
                      width: '2px', height: '28px',
                      background: h.featured ? '#f5a623' : badgeColor(h.availability),
                      margin: '-4px auto 0',
                    }} />
                    <div style={{
                      background: h.featured ? 'linear-gradient(135deg, #f5a623, #e8941a)' : 'var(--night3)',
                      border: h.featured ? '1px solid #f5a623' : `1px solid ${badgeColor(h.availability)}`,
                      borderRadius: '10px',
                      padding: '6px 8px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                      fontFamily: 'Syne, sans-serif',
                    }}>
                      <div style={{
                        fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px',
                        color: h.featured ? '#0d0f14' : badgeColor(h.availability),
                      }}>
                        {h.distance.toFixed(1)} MI
                      </div>
                      <div style={{
                        fontSize: '10px', color: h.featured ? '#0d0f14' : 'var(--white)',
                        fontWeight: 500, fontFamily: 'DM Sans, sans-serif',
                        lineHeight: 1.2, marginTop: '1px',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {h.name}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div style={{
        textAlign: 'center', fontSize: '10px', color: 'var(--fog)',
        marginTop: '4px', letterSpacing: '0.5px',
      }}>
        ← scroll →
      </div>

      <style jsx>{`
        @keyframes roadmove {
          from { background-position: 0 0; }
          to { background-position: -40px 0; }
        }
      `}</style>
    </div>
  )
}
