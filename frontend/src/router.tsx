import { createBrowserRouter, Navigate } from 'react-router-dom'
import AppShell              from './layout/AppShell'
import ProtectedRoute        from './components/ProtectedRoute'
import Login                 from './pages/auth/Login'
import Home                  from './pages/Home'
import Overview              from './pages/sales/Overview'
import Performance           from './pages/sales/Performance'
import Products              from './pages/sales/Products'
import Transactions          from './pages/sales/Transactions'
import Journals               from './pages/sales/Journals'
import DataModelSettings     from './pages/settings/DataModelSettings'
import UsersManagement       from './pages/settings/UsersManagement'
import AuditLog              from './pages/settings/AuditLog'
import InventoryOverview     from './pages/inventory/Overview'
import InventoryMovement     from './pages/inventory/Movement'
import InventoryTransfers    from './pages/inventory/Transfers'
import InventoryAdjustments  from './pages/inventory/Adjustments'
import InventoryLedger       from './pages/inventory/Ledger'
import InventoryHistory      from './pages/inventory/History'
import InventoryStockAsOf    from './pages/inventory/StockAsOf'
import InventoryCoverage     from './pages/inventory/Coverage'
import Assistant             from './pages/assistant/Assistant'
import PurchasesOverview     from './pages/purchases/Overview'
import PurchasesTransactions from './pages/purchases/Transactions'
import DimStores             from './pages/dimensions/Stores'
import DimCustomers          from './pages/dimensions/Customers'
import DimEmployees          from './pages/dimensions/Employees'
import DimItems              from './pages/dimensions/Items'
import DimVendors            from './pages/dimensions/Vendors'

export const router = createBrowserRouter([
  // Public route
  { path: '/login', element: <Login /> },

  // All app routes are protected
  {
    path: '/',
    element: <ProtectedRoute><AppShell /></ProtectedRoute>,
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      { path: 'home',                    element: <Home />                  },
      { path: 'assistant',              element: <Assistant />             },
      { path: 'sales/overview',          element: <Overview />              },
      { path: 'sales/performance',       element: <Performance />           },
      { path: 'sales/products',          element: <Products />              },
      { path: 'sales/transactions',      element: <Transactions />          },
      { path: 'sales/journals',          element: <Journals />              },
      { path: 'inventory/overview',      element: <InventoryOverview />     },
      { path: 'inventory/movement',      element: <InventoryMovement />     },
      { path: 'inventory/transfers',     element: <InventoryTransfers />    },
      { path: 'inventory/adjustments',   element: <InventoryAdjustments />  },
      { path: 'inventory/ledger',        element: <InventoryLedger />       },
      { path: 'inventory/history',       element: <InventoryHistory />      },
      { path: 'inventory/stock-asof',    element: <InventoryStockAsOf />    },
      { path: 'inventory/coverage',      element: <InventoryCoverage />     },
      { path: 'purchases/overview',      element: <PurchasesOverview />     },
      { path: 'purchases/transactions',  element: <PurchasesTransactions /> },
      { path: 'dimensions/stores',       element: <DimStores />             },
      { path: 'dimensions/customers',    element: <DimCustomers />          },
      { path: 'dimensions/employees',    element: <DimEmployees />          },
      { path: 'dimensions/items',        element: <DimItems />              },
      { path: 'dimensions/vendors',      element: <DimVendors />            },
      { path: 'settings',               element: <ProtectedRoute adminOnly><DataModelSettings /></ProtectedRoute> },
      { path: 'settings/users',         element: <ProtectedRoute adminOnly><UsersManagement /></ProtectedRoute>   },
      { path: 'settings/audit',         element: <ProtectedRoute adminOnly><AuditLog /></ProtectedRoute>          },
    ],
  },
])
