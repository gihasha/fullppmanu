const { Boom } = require('@hapi/boom')
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('baileys')
const qrcode = require('qrcode')
const express = require('express')
const multer = require('multer')
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')
const cors = require('cors')
const bodyParser = require('body-parser')

// App setup
const app = express()
app.use(cors())
app.use(bodyParser.json())
app.use(express.static('public'))

// Upload storage
const upload = multer({ dest: 'uploads/' })
const pairingSessions = new Map()

// WhatsApp auth state
const { state, saveState } = useMultiFileAuthState('./auth_info.json')
let sock = null

const startWhatsAppClient = async () => {
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state,
    browser: ['DP Changer Bot', 'Chrome', 'Linux']
  })

  sock.ev.on('creds.update', saveState)

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update
    if (connection === 'close') {
      const shouldReconnect =
        (new Boom(lastDisconnect?.error))?.output?.statusCode !== DisconnectReason.loggedOut
      if (shouldReconnect) {
        startWhatsAppClient()
      }
    }
    console.log('Connection update:', update)
  })

  return sock
}

startWhatsAppClient()

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

// Generate pairing code
app.post('/api/generate-pair-code', async (req, res) => {
  const { phoneNumber } = req.body

  if (!phoneNumber) {
    return res.status(400).json({ error: 'Phone number required' })
  }

  const pairCode = Math.floor(100000 + Math.random() * 900000).toString()

  pairingSessions.set(phoneNumber, {
    code: pairCode,
    expiresAt: Date.now() + 15 * 60 * 1000,
    verified: false
  })

  res.json({
    success: true,
    pairCode,
    deepLink: `https://wa.me/${phoneNumber}?text=Your%20DP%20Change%20Code:%20${pairCode}`
  })
})

// Verify and update profile picture
app.post('/api/verify-and-update', upload.single('image'), async (req, res) => {
  const { phoneNumber, pairCode } = req.body

  if (!phoneNumber || !pairCode) {
    return res.status(400).json({ error: 'Phone number and pair code required' })
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Image file required' })
  }

  const session = pairingSessions.get(phoneNumber)

  if (!session || session.code !== pairCode || session.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired code' })
  }

  try {
    const processedImage = await sharp(req.file.path)
      .resize(640, 640)
      .jpeg({ quality: 90 })
      .toBuffer()

    await sock.profilePictureUpdate(`${phoneNumber}@s.whatsapp.net`, processedImage)

    fs.unlinkSync(req.file.path)
    pairingSessions.delete(phoneNumber)

    res.json({ success: true, message: 'Profile picture updated successfully!' })
  } catch (error) {
    console.error('Error updating DP:', error)
    res.status(500).json({ error: 'Failed to update profile picture' })
  }
})

const portx = process.env.PORT || 3000
app.listen(portx, () => {
  console.log(`Server running on port ${portx}`)
})
