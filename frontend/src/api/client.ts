import axios from 'axios'

const api = axios.create({ baseURL: 'http://localhost:8000' })

// Inject Bearer token on every request
api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('rt_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

// On 401 → clear session and redirect to login
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('rt_token')
      localStorage.removeItem('rt_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
