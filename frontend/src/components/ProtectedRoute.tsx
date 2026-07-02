import React, { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute({
  children,
  adminOnly = false,
}: { children: ReactNode; adminOnly?: boolean }) {
  const { user }   = useAuth()
  const location   = useLocation()

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Role guard (EXPERT_REVIEW.md H6): admin-only screens are enforced here,
  // not just hidden from the sidebar. The backend enforces this too.
  if (adminOnly && user.role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
