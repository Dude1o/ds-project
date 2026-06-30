import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { HomePage } from '@/pages/HomePage';
import { ShopPage } from '@/pages/ShopPage';
import { OrdersPage } from '@/pages/OrdersPage';
import { MonitorPage } from '@/pages/MonitorPage';

/** App — router + shell wiring all four pages. */
export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/monitor" element={<MonitorPage />} />
        <Route path="*" element={<HomePage />} />
      </Route>
    </Routes>
  );
}
