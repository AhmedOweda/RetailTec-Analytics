import { createBrowserRouter, Navigate } from 'react-router-dom'
import AppShell              from './layout/AppShell'
import Overview              from './pages/sales/Overview'
import Performance           from './pages/sales/Performance'
import Products              from './pages/sales/Products'
import Transactions          from './pages/sales/Transactions'
import DataModelSettings     from './pages/settings/DataModelSettings'
import InventoryOverview     from './pages/inventory/Overview'
import InventoryMovement     from './pages/inventory/Movement'
import InventoryTransfers    from './pages/inventory/Transfers'
import InventoryAdjustments  from './pages/inventory/Adjustments'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/sales/overview" replace /> },
      { path: 'sales/overview',          element: <Overview />           },
      { path: 'sales/performance',       element: <Performance />        },
      { path: 'sales/products',          element: <Products />           },
      { path: 'sales/transactions',      element: <Transactions />       },
      { path: 'inventory/overview',      element: <InventoryOverview />  },
      { path: 'inventory/movement',      element: <InventoryMovement />  },
      { path: 'inventory/transfers',     element: <InventoryTransfers /> },
      { path: 'inventory/adjustments',   element: <InventoryAdjustments />},
      { path: 'settings',               element: <DataModelSettings />   },
    ],
  },
])
