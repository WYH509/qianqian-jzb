import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './api/auth-context';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Accounts from './pages/Accounts';
import AiImport from './pages/AiImport';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import Summary from './pages/Summary';
import Transactions from './pages/Transactions';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Navigate to="/accounts" replace />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/summary" element={<Summary />} />
            <Route path="/ai-import" element={<AiImport />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
