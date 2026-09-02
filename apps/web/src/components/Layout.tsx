import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../api/auth-context';

const NAV_ITEMS = [
  { to: '/accounts', label: '账户' },
  { to: '/transactions', label: '流水' },
  { to: '/summary', label: '汇总' },
  { to: '/ai-import', label: 'AI 导入' },
];

export default function Layout() {
  const { username, logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="bg-gray-900 text-white shadow">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-8">
            <span className="text-lg font-bold tracking-wide">钱钱家账本</span>
            <nav className="flex gap-1">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-1.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-gray-700 font-medium text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {username && <span className="text-sm text-gray-300">{username}</span>}
            <button
              type="button"
              onClick={() => {
                void logout();
              }}
              className="rounded-md border border-gray-600 px-3 py-1.5 text-sm text-gray-200 transition-colors hover:bg-gray-700"
            >
              登出
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
