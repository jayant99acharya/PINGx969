import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './Layout';
import { Loading, ToastProvider } from './ui';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { ResumesPage } from './pages/ResumesPage';
import { ResumeDetailPage } from './pages/ResumeDetailPage';
import { OptimizePage } from './pages/OptimizePage';
import { VersionPage } from './pages/VersionPage';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { ProfilePage } from './pages/ProfilePage';
import { AnswersPage } from './pages/AnswersPage';
import { SettingsPage } from './pages/SettingsPage';
import { ExtensionPage } from './pages/ExtensionPage';

function Guard({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/register" element={<AuthPage mode="register" />} />
            <Route
              element={
                <Guard>
                  <Layout />
                </Guard>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="resumes" element={<ResumesPage />} />
              <Route path="resumes/:id" element={<ResumeDetailPage />} />
              <Route path="optimize" element={<OptimizePage />} />
              <Route path="versions/:id" element={<VersionPage />} />
              <Route path="applications" element={<ApplicationsPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="answers" element={<AnswersPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="extension" element={<ExtensionPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
