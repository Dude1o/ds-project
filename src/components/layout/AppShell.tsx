import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';

/** Application shell: persistent navbar + routed page content. */
export function AppShell() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-zinc-100">
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
