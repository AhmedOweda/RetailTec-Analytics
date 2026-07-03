/**
 * Users Management — admin-only page
 * List, add, edit, deactivate/delete users with role + store assignment.
 */
import { useState, useMemo } from 'react'
import {
  Box, Typography, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Select, MenuItem, FormControl, InputLabel,
  Chip, Switch, FormControlLabel, Alert, CircularProgress,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer,
  Paper, IconButton, Tooltip, Checkbox,
  Divider, Stack,
} from '@mui/material'
import AddIcon          from '@mui/icons-material/Add'
import EditIcon         from '@mui/icons-material/Edit'
import DeleteIcon       from '@mui/icons-material/Delete'
import StorefrontIcon   from '@mui/icons-material/Storefront'
import SecurityIcon     from '@mui/icons-material/Security'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import axios from 'axios'
import { PAGE_DOMAINS, ALL_PAGE_KEYS } from '../../utils/pages'

interface User {
  id:         number
  username:   string
  role:       string
  full_name:  string
  stores:     string | null
  is_active:  boolean
  created_at: string
  pages:      string | null
}

interface UserForm {
  username:  string
  password:  string
  role:      string
  full_name: string
  stores:    string
  is_active: boolean
  pages:     string   // CSV of page keys; '' = all pages
}

const emptyForm = (): UserForm => ({
  username: '', password: '', role: 'viewer',
  full_name: '', stores: '', is_active: true, pages: '',
})

const ROLE_COLORS: Record<string, string> = {
  admin:   '#6366f1',
  manager: '#f59e0b',
  viewer:  '#10b981',
}

const ROLE_PRIVILEGES: Record<string, { label: string; items: string[] }> = {
  admin: {
    label: 'Full Access',
    items: [
      'All Sales analytics (Overview, Performance, Products, Transactions)',
      'All Inventory analytics (Overview, Movement, History, Coverage, Ledger, Adjustments)',
      'All Purchases analytics (Overview, Transactions)',
      'All Dimension intelligence (Customers, Employees, Vendors, Items)',
      'Settings — app-wide configuration',
      'Users Management — create, edit, delete users',
      'All stores (no restriction)',
    ],
  },
  manager: {
    label: 'Analytics Access',
    items: [
      'All Sales analytics',
      'All Inventory analytics',
      'All Purchases analytics',
      'All Dimension intelligence',
      'Store scope: limited to assigned stores if set',
      'No access to Settings or Users Management',
    ],
  },
  viewer: {
    label: 'Read-Only Access',
    items: [
      'Sales Overview & Performance (read-only)',
      'Inventory Overview (read-only)',
      'Store scope: strictly limited to assigned stores',
      'No access to Purchases, Dimensions, Settings, or Users Management',
    ],
  },
}

// ── Store Picker Dialog ──────────────────────────────────────────────────────

function StorePickerDialog({
  open, onClose, allStores, selected, onApply,
}: {
  open: boolean
  onClose: () => void
  allStores: string[]
  selected: string[]
  onApply: (stores: string[]) => void
}) {
  const [local, setLocal] = useState<string[]>(selected)

  // sync when dialog opens with fresh selection
  const handleOpen = () => setLocal(selected)

  const toggle = (s: string) =>
    setLocal(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth
      TransitionProps={{ onEnter: handleOpen }}
      PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 700, pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        <StorefrontIcon sx={{ color: '#6366f1', fontSize: 20 }} />
        Store Access
      </DialogTitle>
      <DialogContent sx={{ pt: 0 }}>
        <Typography fontSize={12} color="#64748b" mb={1.5}>
          Select which stores this user can access. Leave all unchecked to grant access to all stores.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
          <Button size="small" variant="outlined" sx={{ fontSize: 11, textTransform: 'none', py: 0.3 }}
            onClick={() => setLocal([...allStores])}>Select All</Button>
          <Button size="small" variant="outlined" sx={{ fontSize: 11, textTransform: 'none', py: 0.3 }}
            onClick={() => setLocal([])}>Clear</Button>
        </Box>
        <Box sx={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 1.5, p: 1 }}>
          {allStores.length === 0 && (
            <Typography fontSize={12} color="#94a3b8" sx={{ p: 1 }}>No stores found</Typography>
          )}
          {allStores.map(s => (
            <Box key={s} onClick={() => toggle(s)}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5,
                    borderRadius: 1, cursor: 'pointer',
                    '&:hover': { bgcolor: '#f8fafc' },
                    bgcolor: local.includes(s) ? '#ede9fe' : 'transparent' }}>
              <Checkbox checked={local.includes(s)} size="small"
                sx={{ p: 0.3, color: '#6366f1', '&.Mui-checked': { color: '#6366f1' } }} />
              <Typography fontSize={13} fontWeight={local.includes(s) ? 600 : 400}>
                {s}
              </Typography>
            </Box>
          ))}
        </Box>
        {local.length > 0 && (
          <Typography fontSize={11} color="#6366f1" mt={1} fontWeight={600}>
            {local.length} store{local.length !== 1 ? 's' : ''} selected
          </Typography>
        )}
        {local.length === 0 && (
          <Typography fontSize={11} color="#10b981" mt={1} fontWeight={600}>
            Access to all stores (no restriction)
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', color: '#64748b' }}>Cancel</Button>
        <Button onClick={() => { onApply(local); onClose() }} variant="contained"
          sx={{ textTransform: 'none', fontWeight: 700, bgcolor: '#6366f1', '&:hover': { bgcolor: '#4f46e5' } }}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function UsersManagement() {
  const qc = useQueryClient()

  const { data: users = [], isLoading, error } = useQuery<User[]>({
    queryKey: ['auth-users'],
    queryFn:  () => api.get('/api/auth/users').then(r => r.data),
  })

  const { data: storeList = [] } = useQuery<string[]>({
    queryKey: ['stores-list'],
    queryFn:  () => axios.get('/api/sales/stores-list').then(r => r.data),
    staleTime: Infinity,
  })

  // ── Dialog state ───────────────────────────────────────────────────────────
  const [open,          setOpen]          = useState(false)
  const [editId,        setEditId]        = useState<number | null>(null)
  const [form,          setForm]          = useState<UserForm>(emptyForm())
  const [formErr,       setFormErr]       = useState<string | null>(null)
  const [storePickOpen, setStorePickOpen] = useState(false)
  const [privOpen,      setPrivOpen]      = useState(false)

  // Parse/serialize stores between string ↔ string[]
  const selectedStores = useMemo(
    () => form.stores ? form.stores.split(',').map(s => s.trim()).filter(Boolean) : [],
    [form.stores]
  )

  // ── Create ─────────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (f: UserForm) => api.post('/api/auth/users', {
      username:  f.username.trim(),
      password:  f.password,
      role:      f.role,
      full_name: f.full_name.trim(),
      stores:    f.stores.trim() || null,
      pages:     f.role === 'admin' ? null : (f.pages.trim() || null),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['auth-users'] }); closeDialog() },
    onError:   (e: any) => setFormErr(e?.response?.data?.detail ?? 'Error creating user'),
  })

  // ── Update ─────────────────────────────────────────────────────────────────
  const updateMut = useMutation({
    mutationFn: (f: UserForm) => api.put(`/api/auth/users/${editId}`, {
      ...(f.password ? { password: f.password } : {}),
      role:      f.role,
      full_name: f.full_name.trim(),
      stores:    f.stores.trim() || null,
      is_active: f.is_active,
      pages:     f.role === 'admin' ? '' : f.pages.trim(),   // '' = all pages
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['auth-users'] }); closeDialog() },
    onError:   (e: any) => setFormErr(e?.response?.data?.detail ?? 'Error updating user'),
  })

  // ── Delete ─────────────────────────────────────────────────────────────────
  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/auth/users/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['auth-users'] }),
    onError:    (e: any) => alert(e?.response?.data?.detail ?? 'Cannot delete user'),
  })

  function openCreate() {
    setEditId(null); setForm(emptyForm()); setFormErr(null); setOpen(true)
  }

  function openEdit(u: User) {
    setEditId(u.id)
    setForm({ username: u.username, password: '', role: u.role,
              full_name: u.full_name ?? '', stores: u.stores ?? '',
              is_active: u.is_active, pages: u.pages ?? '' })
    setFormErr(null); setOpen(true)
  }

  function closeDialog() { setOpen(false); setEditId(null) }

  function applyStores(stores: string[]) {
    setForm(f => ({ ...f, stores: stores.join(', ') }))
  }

  function submit() {
    setFormErr(null)
    if (!form.username.trim()) { setFormErr('Username is required'); return }
    if (!editId && !form.password) { setFormErr('Password is required for new users'); return }
    if (editId) updateMut.mutate(form)
    else        createMut.mutate(form)
  }

  const busy = createMut.isPending || updateMut.isPending

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ p: 3, maxWidth: 960, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={700} color="#0f172a">Users Management</Typography>
          <Typography variant="body2" color="#64748b" mt={0.5}>
            Manage who can access RetailTec Analytics and what they can see.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}
          sx={{ bgcolor: '#6366f1', '&:hover': { bgcolor: '#4f46e5' }, textTransform: 'none', fontWeight: 700 }}>
          Add User
        </Button>
      </Box>

      {isLoading && <CircularProgress />}
      {error    && <Alert severity="error">Failed to load users</Alert>}

      {!isLoading && (
        <TableContainer component={Paper} elevation={0}
          sx={{ border: '1px solid #e2e8f0', borderRadius: 2 }}>
          <Table size="small">
            <TableHead sx={{ bgcolor: '#f8fafc' }}>
              <TableRow>
                {['User', 'Role', 'Stores', 'Pages', 'Status', 'Created', 'Actions'].map(h => (
                  <TableCell key={h} sx={{ fontWeight: 700, color: '#475569', fontSize: 12 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map(u => (
                <TableRow key={u.id} sx={{ '&:hover': { bgcolor: '#f8fafc' } }}>
                  <TableCell>
                    <Typography fontWeight={600} fontSize={13}>{u.full_name || u.username}</Typography>
                    <Typography fontSize={11} color="#94a3b8">@{u.username}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={u.role} size="small"
                      sx={{ bgcolor: ROLE_COLORS[u.role] + '1a', color: ROLE_COLORS[u.role],
                            fontWeight: 700, fontSize: 11 }} />
                  </TableCell>
                  <TableCell>
                    {u.stores ? (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4 }}>
                        {u.stores.split(',').map(s => s.trim()).filter(Boolean).map(s => (
                          <Chip key={s} label={s} size="small"
                            sx={{ fontSize: 10, height: 18, bgcolor: '#ede9fe', color: '#6366f1', fontWeight: 600 }} />
                        ))}
                      </Box>
                    ) : (
                      <em style={{ color: '#94a3b8', fontSize: 12 }}>All stores</em>
                    )}
                  </TableCell>
                  <TableCell>
                    {u.role === 'admin' || !u.pages ? (
                      <em style={{ color: '#94a3b8', fontSize: 12 }}>All pages</em>
                    ) : (
                      <Chip size="small"
                        label={`${u.pages.split(',').filter(Boolean).length} of ${ALL_PAGE_KEYS.length}`}
                        sx={{ fontSize: 10, height: 18, bgcolor: '#ede9fe', color: '#6366f1', fontWeight: 700 }} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip label={u.is_active ? 'Active' : 'Inactive'} size="small"
                      sx={{ bgcolor: u.is_active ? '#d1fae5' : '#fee2e2',
                            color: u.is_active ? '#065f46' : '#991b1b', fontWeight: 600, fontSize: 11 }} />
                  </TableCell>
                  <TableCell sx={{ fontSize: 12, color: '#94a3b8' }}>
                    {u.created_at ? u.created_at.slice(0, 10) : '—'}
                  </TableCell>
                  <TableCell>
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => openEdit(u)}>
                        <EditIcon fontSize="small" sx={{ color: '#6366f1' }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" onClick={() => {
                        if (confirm(`Delete user "${u.username}"?`)) deleteMut.mutate(u.id)
                      }}>
                        <DeleteIcon fontSize="small" sx={{ color: '#ef4444' }} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ color: '#94a3b8', py: 4 }}>
                    No users yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Role legend */}
      <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
        {[
          { role: 'admin',   desc: 'Full access including settings & user management' },
          { role: 'manager', desc: 'All analytics pages, no settings' },
          { role: 'viewer',  desc: 'Read-only, store-scoped if stores are set' },
        ].map(({ role, desc }) => (
          <Box key={role} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip label={role} size="small"
              sx={{ bgcolor: ROLE_COLORS[role] + '1a', color: ROLE_COLORS[role],
                    fontWeight: 700, fontSize: 11 }} />
            <Typography fontSize={11} color="#94a3b8">{desc}</Typography>
          </Box>
        ))}
      </Box>

      {/* ── Add / Edit Dialog ─────────────────────────────────────────────── */}
      <Dialog open={open} onClose={closeDialog} maxWidth="sm" fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>
          {editId ? 'Edit User' : 'Add New User'}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 2 }}>

          {formErr && <Alert severity="error">{formErr}</Alert>}

          <TextField label="Full Name" value={form.full_name} size="small"
            onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />

          <TextField label="Username *" value={form.username} size="small"
            disabled={!!editId}
            onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />

          <TextField
            label={editId ? 'New Password (leave blank to keep)' : 'Password *'}
            type="password" value={form.password} size="small"
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />

          <FormControl size="small">
            <InputLabel>Role</InputLabel>
            <Select value={form.role} label="Role"
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="manager">Manager</MenuItem>
              <MenuItem value="viewer">Viewer</MenuItem>
            </Select>
          </FormControl>

          {/* ── Role privilege info ─────────────────────────────────── */}
          {form.role && (
            <Box sx={{ bgcolor: '#f8fafc', borderRadius: 1.5, border: '1px solid #e2e8f0', p: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                  <SecurityIcon sx={{ fontSize: 15, color: ROLE_COLORS[form.role] }} />
                  <Typography fontSize={12} fontWeight={700} color={ROLE_COLORS[form.role]}>
                    {ROLE_PRIVILEGES[form.role]?.label}
                  </Typography>
                </Box>
                <Button size="small" sx={{ fontSize: 10, textTransform: 'none', py: 0, minWidth: 0, color: '#6366f1' }}
                  onClick={() => setPrivOpen(true)}>
                  View details
                </Button>
              </Box>
              {ROLE_PRIVILEGES[form.role]?.items.slice(0, 2).map(item => (
                <Typography key={item} fontSize={11} color="#64748b" sx={{ pl: 1 }}>• {item}</Typography>
              ))}
              {(ROLE_PRIVILEGES[form.role]?.items.length ?? 0) > 2 && (
                <Typography fontSize={11} color="#94a3b8" sx={{ pl: 1 }}>
                  +{(ROLE_PRIVILEGES[form.role]?.items.length ?? 0) - 2} more…
                </Typography>
              )}
            </Box>
          )}

          {/* ── Store Access ─────────────────────────────────────────── */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.8 }}>
              <Typography fontSize={12} fontWeight={600} color="#475569"
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <StorefrontIcon sx={{ fontSize: 15 }} /> Store Access
              </Typography>
              <Button size="small" variant="outlined" startIcon={<StorefrontIcon sx={{ fontSize: 14 }} />}
                onClick={() => setStorePickOpen(true)}
                sx={{ fontSize: 11, textTransform: 'none', py: 0.3, borderColor: '#6366f1', color: '#6366f1' }}>
                {selectedStores.length > 0 ? 'Edit Stores' : 'Select Stores'}
              </Button>
            </Box>
            <Box sx={{ minHeight: 40, border: '1px solid #e2e8f0', borderRadius: 1.5, p: 1,
                        display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center', bgcolor: '#f8fafc' }}>
              {selectedStores.length === 0 ? (
                <Typography fontSize={12} color="#94a3b8" sx={{ fontStyle: 'italic' }}>
                  All stores (no restriction)
                </Typography>
              ) : selectedStores.map(s => (
                <Chip key={s} label={s} size="small" onDelete={() => applyStores(selectedStores.filter(x => x !== s))}
                  sx={{ bgcolor: '#ede9fe', color: '#6366f1', fontWeight: 600, fontSize: 11,
                        '& .MuiChip-deleteIcon': { color: '#6366f1' } }} />
              ))}
            </Box>
          </Box>

          {/* ── Page Access (per domain) — admins always see everything ── */}
          {form.role !== 'admin' && (() => {
            const sel = new Set(form.pages.split(',').map(p => p.trim()).filter(Boolean))
            const setSel = (next: Set<string>) => {
              // selecting every page = no restriction (store empty)
              const csv = next.size === 0 || next.size === ALL_PAGE_KEYS.length
                ? '' : [...next].join(',')
              setForm(f => ({ ...f, pages: csv }))
            }
            const togglePage = (k: string) => {
              const base = sel.size === 0 ? new Set(ALL_PAGE_KEYS) : new Set(sel)
              base.has(k) ? base.delete(k) : base.add(k)
              setSel(base)
            }
            const toggleDomain = (keys: string[], allOn: boolean) => {
              const base = sel.size === 0 ? new Set(ALL_PAGE_KEYS) : new Set(sel)
              keys.forEach(k => allOn ? base.delete(k) : base.add(k))
              setSel(base)
            }
            const isOn = (k: string) => sel.size === 0 || sel.has(k)
            return (
              <Box>
                <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between', mb:0.8 }}>
                  <Typography fontSize={12} fontWeight={600} color="#475569"
                    sx={{ display:'flex', alignItems:'center', gap:0.5 }}>
                    <SecurityIcon sx={{ fontSize:15 }} /> Page Access
                  </Typography>
                  <Typography fontSize={11} fontWeight={600}
                    color={sel.size === 0 ? '#10b981' : '#6366f1'}>
                    {sel.size === 0 ? 'All pages (no restriction)' : `${sel.size} of ${ALL_PAGE_KEYS.length} pages`}
                  </Typography>
                </Box>
                <Box sx={{ border:'1px solid #e2e8f0', borderRadius:1.5, p:1.5, bgcolor:'#f8fafc',
                           display:'grid', gridTemplateColumns:'1fr 1fr', gap:1.5 }}>
                  {PAGE_DOMAINS.map(dom => {
                    const keys = dom.pages.map(p => p.key)
                    const allOn = keys.every(isOn)
                    return (
                      <Box key={dom.domain}>
                        <FormControlLabel sx={{ mb:0.2, ml:-0.5 }}
                          control={
                            <Checkbox size="small" checked={allOn}
                              indeterminate={!allOn && keys.some(isOn)}
                              onChange={() => toggleDomain(keys, allOn)}
                              sx={{ p:0.4, color:'#6366f1', '&.Mui-checked':{ color:'#6366f1' },
                                    '&.MuiCheckbox-indeterminate':{ color:'#6366f1' } }} />
                          }
                          label={<Typography fontSize={12} fontWeight={700} color="#334155">{dom.domain}</Typography>}
                        />
                        {dom.pages.map(p => (
                          <FormControlLabel key={p.key} sx={{ display:'flex', ml:1, mb:-0.6 }}
                            control={
                              <Checkbox size="small" checked={isOn(p.key)}
                                onChange={() => togglePage(p.key)}
                                sx={{ p:0.4, color:'#94a3b8', '&.Mui-checked':{ color:'#6366f1' } }} />
                            }
                            label={<Typography fontSize={12} color="#475569">{p.label}</Typography>}
                          />
                        ))}
                      </Box>
                    )
                  })}
                </Box>
              </Box>
            )
          })()}

          {editId && (
            <FormControlLabel
              control={<Switch checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />}
              label="Account Active"
            />
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={closeDialog} sx={{ textTransform: 'none', color: '#64748b' }}>Cancel</Button>
          <Button onClick={submit} variant="contained" disabled={busy}
            sx={{ textTransform: 'none', fontWeight: 700, bgcolor: '#6366f1',
                  '&:hover': { bgcolor: '#4f46e5' } }}>
            {busy ? <CircularProgress size={18} /> : editId ? 'Save Changes' : 'Create User'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Store Picker sub-dialog ──────────────────────────────────────── */}
      <StorePickerDialog
        open={storePickOpen}
        onClose={() => setStorePickOpen(false)}
        allStores={storeList}
        selected={selectedStores}
        onApply={applyStores}
      />

      {/* ── Role Privileges detail dialog ────────────────────────────────── */}
      <Dialog open={privOpen} onClose={() => setPrivOpen(false)} maxWidth="sm" fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
          <SecurityIcon sx={{ color: '#6366f1' }} />
          Role Privileges
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5}>
            {Object.entries(ROLE_PRIVILEGES).map(([role, { label, items }]) => (
              <Box key={role}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.8 }}>
                  <Chip label={role} size="small"
                    sx={{ bgcolor: ROLE_COLORS[role] + '1a', color: ROLE_COLORS[role],
                          fontWeight: 700, fontSize: 11, textTransform: 'capitalize' }} />
                  <Typography fontSize={13} fontWeight={700} color={ROLE_COLORS[role]}>{label}</Typography>
                  {form.role === role && (
                    <Chip label="Current selection" size="small"
                      sx={{ fontSize: 10, bgcolor: '#f0fdf4', color: '#15803d', fontWeight: 600 }} />
                  )}
                </Box>
                {items.map(item => (
                  <Typography key={item} fontSize={12} color="#475569" sx={{ pl: 1.5, mb: 0.3 }}>
                    ✓ {item}
                  </Typography>
                ))}
                <Divider sx={{ mt: 1.5 }} />
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setPrivOpen(false)} variant="contained"
            sx={{ textTransform: 'none', fontWeight: 700, bgcolor: '#6366f1', '&:hover': { bgcolor: '#4f46e5' } }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
