import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config()

const app = express()

const PORT = Number(process.env.PORT || 8080)
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
  }),
)

app.use(express.json())

app.get('/api/health', (request, response) => {
  response.json({
    ok: true,
    service: 'CDSL Dashboard Backend',
    message: 'Backend is running successfully.',
    timestamp: new Date().toISOString(),
  })
})

app.listen(PORT, () => {
  console.log(`CDSL backend running on http://localhost:${PORT}`)
})