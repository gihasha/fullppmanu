const { Boom } = require('@hapi/boom');
const { default: makeWASocket, useSingleFileAuthState, DisconnectReason } = require('baileys');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Temporary storage for uploads
const upload = multer({ dest: 'uploads/' });

// Store active pairing sessions
const pairingSessions = new Map();

// WhatsApp connection setup
const { state, saveState } = useSingleFileAuthState('./auth_info.json');
let sock = null;

const startWhatsAppClient = async () => {
  sock = makeWASocket({
    printQRInTerminal: false,
    auth: state,
    browser: ['WhatsApp DP Changer', 'Chrome', 'Linux']
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    
    if(connection === 'close') {
      const shouldReconnect = (new Boom(lastDisconnect?.error))?.output?.statusCode !== DisconnectReason.loggedOut;
      if(shouldReconnect) {
        startWhatsAppClient();
      }
    }
  });

  sock.ev.on('creds.update', saveState);
  
  return sock;
}

// Start WhatsApp client
startWhatsAppClient();

// Generate pairing code for a number
app.post('/api/generate-pair-code', async (req, res) => {
  const { phoneNumber } = req.body;
  
  if (!phoneNumber) {
    return res.status(400).json({ error: 'WhatsApp number required' });
  }

  // Generate 6-digit pairing code
  const pairCode = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Store the pairing session (valid for 15 minutes)
  pairingSessions.set(phoneNumber, {
    code: pairCode,
    expiresAt: Date.now() + 15 * 60 * 1000,
    verified: false
  });
  
  res.json({ 
    success: true,
    pairCode,
    deepLink: `https://wa.me/${phoneNumber}?text=Your%20DP%20Change%20Code:%20${pairCode}`
  });
});

// Verify pairing code and update DP
app.post('/api/verify-and-update', upload.single('image'), async (req, res) => {
  const { phoneNumber, pairCode } = req.body;
  
  if (!phoneNumber || !pairCode) {
    return res.status(400).json({ error: 'Phone number and pair code required' });
  }
  
  if (!req.file) {
    return res.status(400).json({ error: 'Image file required' });
  }

  const session = pairingSessions.get(phoneNumber);
  
  // Validate pairing code
  if (!session || session.code !== pairCode || session.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired pair code' });
  }

  try {
    // Process image
    const processedImage = await sharp(req.file.path)
      .resize(640, 640)
      .jpeg({ quality: 90 })
      .toBuffer();

    // Update profile picture
    await sock.updateProfilePicture(`${phoneNumber}@s.whatsapp.net`, processedImage);
    
    // Clean up
    fs.unlinkSync(req.file.path);
    pairingSessions.delete(phoneNumber);
    
    res.json({ 
      success: true,
      message: 'Profile picture updated successfully!'
    });
  } catch (error) {
    console.error('Error updating DP:', error);
    res.status(500).json({ error: 'Failed to update profile picture' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
