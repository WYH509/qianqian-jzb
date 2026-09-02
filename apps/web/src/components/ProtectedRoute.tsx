import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../api/auth-context';

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
