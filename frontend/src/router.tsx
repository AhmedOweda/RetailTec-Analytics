import { createBrowserRouter, Navigate } from 'react-router-dom'
import AppShell          from './layout/AppShell'
import Overview          from './pages/sales/Overview'
import Performance       from './pages/sales/Performance'
import Products          from './pages/sales/Products'
import Transactions      from './pages/sales/Transactions'
import DataModelSettings from './pages/settings/DataModelSettings'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/sales/overview" replace /> },
      { path: 'sales/overview',     element: <Overview />     },
      { path: 'sales/performance',  element: <Performance />  },
      { path: 'sales/products',     element: <Products />     },
      { path: 'sales/transactions', element: <Transactions /> },
      { path: 'settings',           element: <DataModelSettings /> },
    ],
  },
])
