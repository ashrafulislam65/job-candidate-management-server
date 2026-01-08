require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const admin = require('firebase-admin');
const ExcelJS = require('exceljs');
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// --- Firebase Admin Setup ---
try {
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    serviceAccount = require('./serviceAccountKey.json');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin Initialized');
} catch (error) {
  console.warn('WARNING: Firebase Auth verification may fail. (Missing serviceAccountKey.json or FIREBASE_SERVICE_ACCOUNT env var)');
}

// --- MongoDB Config ---
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let db; // Global DB reference

async function connectDB() {
  if (db) return db;
  try {
    if (!client.topology || !client.topology.isConnected()) {
      await client.connect();
    }
    db = client.db("job-candidate-db");
    return db;
  } catch (error) {
    console.error("MongoDB Connection Error:", error);
    throw error;
  }
}

// Middleware to ensure DB connection on every request (Vercel/Serverless friendly)
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    res.status(500).json({ error: "Database Connection Failed" });
  }
});

// Start Server (Only if running directly, not on Vercel)
if (require.main === module) {
  connectDB().then(() => {
    app.listen(port, () => {
      console.log(`Job Candidate Server is running on port: ${port}`);
    });
    // Send a ping to confirm a successful connection
    client.db("admin").command({ ping: 1 }).then(() => {
      console.log("Pinged your deployment. You successfully connected to MongoDB!");
    });
  }).catch(console.dir);
}


// --- Middlewares ---

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).send('Unauthorized: No token provided');
  }

  // --- DEV BYPASS FOR TESTING ---
  if (token === 'DEV_TOKEN') {
    req.user = { uid: 'test-uid-123', email: 'admin@test.com' }; // Matches your seed user
    return next();
  }
  // -----------------------------

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Auth Verify Error:', error.message);
    res.status(401).send('Unauthorized: Invalid token');
  }
};

const verifyRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.uid) return res.status(401).send('Unauthorized');

      const usersCollection = db.collection('users');
      const user = await usersCollection.findOne({ uid: req.user.uid });

      if (!user) {
        return res.status(404).send('User role not found in database');
      }

      if (user.role && allowedRoles.includes(user.role.toLowerCase())) {
        req.dbUser = user;
        next();
      } else {
        res.status(403).send('Forbidden: Insufficient Permissions');
      }
    } catch (error) {
      console.error('Role Check Error:', error);
      res.status(500).send('Internal Server Error');
    }
  };
};

// --- Routes ---

app.get('/', (req, res) => {
  res.send('Job Candidate Server is running');
});

// Test Auth Route
app.get('/api/test-auth', verifyToken, (req, res) => {
  res.json({ message: 'Authenticated', user: req.user });
});
// Get logged-in user's role
app.get('/api/users/me', verifyToken, async (req, res) => {
  try {
    const usersCollection = db.collection('users');
    // Searching for user...
    let user = await usersCollection.findOne({ uid: req.user.uid });

    if (!user && req.user.email) {
      // User not found by UID, searching by email...
      user = await usersCollection.findOne({ email: req.user.email });

      if (user) {
        console.log('User found by email. Updating record with UID:', req.user.uid);
        await usersCollection.updateOne(
          { _id: user._id },
          { $set: { uid: req.user.uid } }
        );
        // Refresh user object
        user.uid = req.user.uid;
      }
    }

    if (!user) {
      // User NOT found in DB
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Get User Error:', error);
    res.status(500).send('Error fetching user');
  }
});

// Helper to Create User with Role (For Testing)
// This enables you to insert a user with a specific role into the 'users' collection
// Helper to Create User with Role (For Testing)
// This enables you to insert a user with a specific role into the 'users' collection
app.post('/api/users/register-role', async (req, res) => {
  // Registration Sync Hit
  try {
    const {
      uid, email, role, name, phone, experience_years, previous_experience, age
    } = req.body;

    // Default role to 'candidate' if not provided
    const userRole = (role || 'candidate').toLowerCase();

    if (!uid) {
      console.log('Missing UID');
      return res.status(400).send('UID required');
    }

    const usersCollection = db.collection('users');
    const candidatesCollection = db.collection('candidates');

    const userData = {
      uid,
      email,
      role: userRole,
      name,
      phone,
      experience_years: parseInt(experience_years) || 0,
      previous_experience,
      age: parseInt(age) || 0,
      updatedAt: new Date()
    };

    // 1. Update/Insert in Users Collection
    // 1. Update/Insert in Users Collection
    const existingUser = await usersCollection.findOne({ uid });
    if (existingUser) {
      await usersCollection.updateOne({ uid }, { $set: userData });
      // User inserted
    }

    // 2. Synchronize with Candidates Collection if role is 'candidate'
    if (userRole === 'candidate') {
      // Candidate list synced
    }

    res.json({ message: 'User and Candidate profile synchronized', uid, role: userRole });
  } catch (error) {
    console.error('CRITICAL: Registration Sync Error:', error);
    res.status(500).send(error.message);
  }
});

// --- User Management Routes (Admin Only) ---
app.get('/api/users', verifyToken, verifyRole(['admin']), async (req, res) => {
  try {
    const usersCollection = db.collection('users');
    const users = await usersCollection.find({}).toArray();
    res.json(users);
  } catch (error) {
    console.error('Fetch Users Error:', error);
    res.status(500).send('Error fetching users');
  }
});

app.patch('/api/users/:uid/role', verifyToken, verifyRole(['admin']), async (req, res) => {
  try {
    const { uid } = req.params;
    const { role } = req.body;
    const targetRole = role?.toLowerCase();
    if (!['admin', 'staff', 'candidate'].includes(targetRole)) {
      return res.status(400).send('Invalid role');
    }

    const usersCollection = db.collection('users');
    const result = await usersCollection.updateOne({ uid }, { $set: { role: targetRole } });

    if (result.matchedCount === 0) {
      return res.status(404).send('User not found');
    }

    res.json({ message: 'Role updated successfully', uid, role });
  } catch (error) {
    console.error('Update Role Error:', error);
    res.status(500).send('Error updating role');
  }
});

// --- Profile Upload & Update (All Users) ---
// Use /tmp for uploads if in Vercel/Production to avoid Read-Only file system errors
const UPLOADS_DIR = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '/tmp/uploads' : 'uploads';

// Ensure base upload dir exists (Handle errors gracefully)
try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch (err) {
  console.warn(`WARNING: Could not create base uploads dir: ${err.message}`);
}

const PROFILE_DIR = path.join(UPLOADS_DIR, 'profiles');
try {
  if (!fs.existsSync(PROFILE_DIR)) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
  }
} catch (err) {
  console.warn(`WARNING: Could not create profile uploads dir: ${err.message}`);
}

const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Re-verify directory exists (for /tmp specific behavior)
    if (!fs.existsSync(PROFILE_DIR)) {
      try { fs.mkdirSync(PROFILE_DIR, { recursive: true }); } catch (e) { }
    }
    cb(null, PROFILE_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, `profile-${Date.now()}-${file.originalname}`);
  }
});
const profileUpload = multer({ storage: profileStorage });

app.patch('/api/users/update-profile', verifyToken, profileUpload.single('photo'), async (req, res) => {
  // Profile Update Hit
  try {
    const { name } = req.body;
    const uid = req.user.uid;
    const email = req.user.email;

    // Use absolute URL or relative path logic. For Vercel/Serverless, local files vanish.
    // We return the path assuming it MIGHT be served if immediate.
    // In real prod, this should be S3/Firebase Storage.
    let photoUrl = null;
    if (req.file) {
      // Construct web-accessible path (Note: /tmp is not served statically by Express usually without explicit config, 
      // but for now we prevent the crash. The image won't persist across restarts in Vercel.)
      photoUrl = `/uploads/profiles/${req.file.filename}`;
    }

    const usersCollection = db.collection('users');
    const candidatesCollection = db.collection('candidates');

    const updateData = {};
    if (name) updateData.name = name;
    if (photoUrl) updateData.photo = photoUrl;
    updateData.updatedAt = new Date();

    // 1. Update Users Collection
    const userResult = await usersCollection.updateOne({ uid }, { $set: updateData });

    // 2. If Candidate, Sync to Candidates Collection
    const user = await usersCollection.findOne({ uid });
    if (user && user.role === 'candidate') {
      await candidatesCollection.updateOne(
        { email },
        { $set: { ...updateData } }
      );
    }

    res.json({ message: 'Profile updated successfully', photo: photoUrl, name });
  } catch (error) {
    console.error('Profile Update Error:', error);
    res.status(500).send('Error updating profile');
  }
});

// --- File Upload Setup (Multer) ---

// Ensure root uploads dir (redundant but safe)
try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch (e) { }

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, `candidates-${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage: storage });


// --- Candidate Routes ---

// 1. Upload Candidates (Excel) - Admin/Staff Only
app.post('/api/candidates/upload', verifyToken, verifyRole(['admin', 'staff']), upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }

  try {
    const filePath = req.file.path;
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // --- Image Extraction Logic with ExcelJS ---
    const exWorkbook = new ExcelJS.Workbook();
    await exWorkbook.xlsx.readFile(filePath);
    const exSheet = exWorkbook.getWorksheet(1);
    const imageMap = {}; // Maps row index -> photo file path

    // Use logic matching global config
    const UPLOADS_DIR_LOCAL = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '/tmp/uploads' : 'uploads';
    const imagesDir = path.join(UPLOADS_DIR_LOCAL, 'candidates');

    // Ensure dir exists
    try {
      if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
    } catch (e) { console.warn('Warning creating Excel images dir:', e.message); }

    exSheet.getImages().forEach((image) => {
      const img = exWorkbook.model.media[image.imageId];
      const row = Math.floor(image.range.tl.row); // 0-indexed row in Excel
      let extension = img.extension;
      const buffer = img.buffer;

      // --- Buffer Signature Detection (Magic Numbers) ---
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        extension = 'png';
      } else if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        extension = 'jpg';
      } else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        extension = 'gif';
      }
      // Debug: Image detected
      // --------------------------------------------------

      // Skip non-browser formats if we can't convert them
      if (['emf', 'wmf'].includes(extension.toLowerCase())) {
        console.log(`Skipping non-browser format: ${extension} at row ${row}`);
        return;
      }

      const fileName = `photo-${Date.now()}-${row}.${extension}`;
      const imgPath = path.join(imagesDir, fileName);

      // If we already have an image for this row, keep the larger one (likely the actual photo vs icon)
      const existingPath = imageMap[row];
      if (existingPath) {
        const existingSize = fs.statSync(path.join(process.cwd(), existingPath)).size;
        if (buffer.length <= existingSize) return; // Keep existing larger one
        // Delete smaller one
        try { fs.unlinkSync(path.join(process.cwd(), existingPath)); } catch (e) { }
      }

      fs.writeFileSync(imgPath, buffer);
      imageMap[row] = `/uploads/candidates/${fileName}`;
    });
    // ---------------------------------------------

    // Get all rows as a 2D array to find the header
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    let headerRowIndex = -1;
    let headers = [];

    // Keywords to identify header row
    const keywords = ['name', 'email', 'phone', 'contact', 'mobile', 'experience', 'age'];

    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const row = rows[i];
      if (!row || !Array.isArray(row)) continue;

      const normalizedRow = row.map(cell => String(cell || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
      const matchCount = normalizedRow.filter(cell => keywords.some(k => cell.includes(k))).length;

      // If at least 2 keywords match, it's likely our header row
      if (matchCount >= 2) {
        headerRowIndex = i;
        headers = normalizedRow;
        break;
      }
    }

    if (headerRowIndex === -1) {
      console.error('Debug: Could not find header row in Excel');
      fs.unlinkSync(filePath);
      return res.status(400).send('Could not find candidate data headers (Name, Email, etc.) in the Excel file.');
    }

    const dataRows = rows.slice(headerRowIndex + 1);
    const candidatesCollection = db.collection('candidates');
    const processed = [];
    const errors = [];

    for (const rowData of dataRows) {
      if (!rowData || rowData.length === 0) continue;

      // Map row array to object using found headers
      const item = {};
      rowData.forEach((val, idx) => {
        if (headers[idx]) {
          const h = headers[idx];
          item[h] = val;
        }
      });

      // Map synonyms (headers are already normalized)
      let name = item.name || item.candidate || item.fullname || item.applicantname || item.candidatesname;
      let email = item.email || item.emailaddress || item.eaddress;
      let phone = item.phone || item.phonenumber || item.contact || item.mobile || item.cell;
      let exp = item.experienceyears || item.yearsofexperience || item.experience || item.totalexperience || item.yearsexperience;
      let age = item.age || item.candidateage || item.ageyrs;

      // --- DEEP PARSING FALLBACK (For Composite Strings like Bdjobs Summary) ---
      // Combine all columns to handle cases where images or formatting shifts data
      const compositeString = rowData.map(c => String(c || '').trim()).join(' ');

      if ((!email || !phone) && compositeString.includes(':')) {
        const emailMatch = compositeString.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch && !email) email = emailMatch[0];

        const phoneMatch = compositeString.match(/\+?[0-9][0-9\-\s]{8,15}/);
        if (phoneMatch && !phone) phone = phoneMatch[0].trim();

        const nameMatch = compositeString.match(/Name:\s*(.*?)\s*(?:Age|Location|University|Degree|$)/i);
        if (nameMatch && (!name || String(name).length > 50)) name = nameMatch[1].trim();

        const ageMatch = compositeString.match(/Age:\s*([\d.]+)/i);
        if (ageMatch && !age) age = ageMatch[1];
      }
      // -------------------------------------------------------------------------

      // Validation for critical fields
      if (!name || (!email && !phone)) {
        const rowStr = JSON.stringify(item).toLowerCase();
        if (rowStr.includes('bdjobs') || rowStr.includes('powered')) continue;
        if (processed.length > 0 && !name && !email) continue;

        errors.push(`Skipped: Missing Name/Email. Found: ${name || 'N/A'}, ${email || 'N/A'}`);
        continue;
      }

      // Check Duplicate Email
      const existing = email ? await candidatesCollection.findOne({ email }) : null;
      if (existing) {
        // Update photo if existing candidate doesn't have one
        const photo = imageMap[headerRowIndex + 1 + dataRows.indexOf(rowData)];
        if (photo && !existing.photo) {
          await candidatesCollection.updateOne({ email }, { $set: { photo } });
          processed.push({ ...existing, photo, updated: true }); // Just for logging/count if needed
          continue;
        }
        errors.push(`Skipped: Email ${email} already exists`);
        continue;
      }

      const candidate = {
        name,
        email,
        phone: String(phone),
        experience_years: Number(exp) || 0,
        previous_experience: item.previous_experience || [],
        age: Number(age) || 0,
        photo: imageMap[headerRowIndex + 1 + dataRows.indexOf(rowData)] || "", // Map by actual sheet row
        status: 'pending',
        createdBy: req.user.uid,
        createdAt: new Date()
      };

      processed.push(candidate);
    }

    if (processed.length > 0) {
      await candidatesCollection.insertMany(processed);
    }

    fs.unlinkSync(filePath);

    res.json({
      message: processed.length > 0 ? 'File processed successfully' : 'No valid candidates found in the file',
      added: processed.length,
      errors: errors
    });

  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).send('Error processing file');
  }
});

// 2. View All Candidates - Admin/Staff Only (With Filtering)
app.get('/api/candidates', verifyToken, verifyRole(['admin', 'staff']), async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status) query.status = status;

    const candidatesCollection = db.collection('candidates');
    // Sort by Newest First
    const candidates = await candidatesCollection.find(query).sort({ createdAt: -1 }).toArray();
    res.json(candidates);
  } catch (error) {
    console.error('Fetch Error:', error);
    res.status(500).send('Error fetching candidates');
  }
});

// 3. View My Profile - Candidate Only
app.get('/api/candidates/me', verifyToken, verifyRole(['candidate']), async (req, res) => {
  // /api/candidates/me Hit

  try {
    const email = req.user.email;
    // Looking for candidate

    if (!email) return res.status(400).send('User email not found in token');

    const candidatesCollection = db.collection('candidates');
    const candidate = await candidatesCollection.findOne({ email: email });

    // Found candidate

    if (!candidate) return res.status(404).json({ message: 'Profile not found' });
    res.json(candidate);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Error fetching profile');
  }
});

// 4. Edit Candidate - Admin Only
app.put('/api/candidates/:id', verifyToken, verifyRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const { ObjectId } = require('mongodb');

    // Prevent updating immutable fields if necessary (optional)
    delete updates._id;
    delete updates.email; // Usually bad to change email as it's identity

    const candidatesCollection = db.collection('candidates');
    const result = await candidatesCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).send('Candidate not found');
    res.json(result);

  } catch (error) {
    console.error('Update Error:', error);
    res.status(500).send('Error updating candidate');
  }
});

// 5. Delete Candidate - Admin Only
app.delete('/api/candidates/:id', verifyToken, verifyRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { ObjectId } = require('mongodb');

    const candidatesCollection = db.collection('candidates');
    const result = await candidatesCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) return res.status(404).send('Candidate not found');
    res.json({ message: 'Candidate deleted' });

  } catch (error) {
    console.error('Delete Error:', error);
    res.status(500).send('Error deleting candidate');
  }
});

// 6. Schedule Interview - Admin/Staff Only
app.post('/api/interviews', verifyToken, verifyRole(['admin', 'staff']), async (req, res) => {
  try {
    const { candidateId, date, time, type } = req.body; // type: Technical, HR, etc.
    const { ObjectId } = require('mongodb');

    if (!candidateId || !date || !time) {
      return res.status(400).send('Missing required fields');
    }

    const interview = {
      candidateId: new ObjectId(candidateId),
      date,
      time,
      type: type || 'General',
      status: 'Scheduled',
      scheduledBy: req.user.uid,
      createdAt: new Date()
    };

    const interviewsCollection = db.collection('interviews');
    const result = await interviewsCollection.insertOne(interview);

    // Optionally update candidate status
    await db.collection('candidates').updateOne(
      { _id: new ObjectId(candidateId) },
      { $set: { status: 'Interview Scheduled' } }
    );

    res.status(201).json({ message: 'Interview scheduled', id: result.insertedId });

  } catch (error) {
    console.error('Schedule Error:', error);
    res.status(500).send('Error scheduling interview');
  }
});

// 7. View Interviews - Admin/Staff Only
// Requirements: Automatically move candidates to "Completed Interview" list if the scheduled date has passed.
app.get('/api/interviews', verifyToken, verifyRole(['admin', 'staff']), async (req, res) => {
  try {
    const interviewsCollection = db.collection('interviews');

    // Auto-update logic: If status is 'Scheduled' and date has passed
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

    // We update status to 'Completed' for those where date < today and status is 'Scheduled'
    await interviewsCollection.updateMany(
      { status: 'Scheduled', date: { $lt: todayStr } },
      { $set: { status: 'Completed' } }
    );

    // Join with candidates to get candidate names
    const interviews = await interviewsCollection.aggregate([
      {
        $lookup: {
          from: 'candidates',
          localField: 'candidateId',
          foreignField: '_id',
          as: 'candidate'
        }
      },
      { $unwind: '$candidate' },
      { $sort: { date: 1, time: 1 } }
    ]).toArray();

    res.json(interviews);

  } catch (error) {
    console.error('Fetch Interviews Error:', error);
    res.status(500).send('Error fetching interviews');
  }
});

// 8. Update Interview Status - Admin/Staff Only
app.put('/api/interviews/:id/status', verifyToken, verifyRole(['admin', 'staff']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // e.g., 'Completed', 'Cancelled'
    const { ObjectId } = require('mongodb');

    const result = await db.collection('interviews').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );

    if (result.matchedCount === 0) return res.status(404).send('Interview not found');
    res.json({ message: 'Status updated' });

  } catch (error) {
    res.status(500).send('Error updating interview status');
  }
});

// 9. Download Candidate Phone Numbers - Admin/Staff Only
app.get('/api/candidates/download-phones', verifyToken, verifyRole(['admin', 'staff']), async (req, res) => {
  try {
    const candidatesCollection = db.collection('candidates');
    // Projection to only get phone numbers
    const candidates = await candidatesCollection.find({}, { projection: { phone: 1 } }).toArray();

    // Extract numbers and join with newline
    const phoneNumbers = candidates.map(c => c.phone).join('\n');

    // Set headers for file download
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="phones.txt"');

    res.send(phoneNumbers);

  } catch (error) {
    console.error('Download Error:', error);
    res.status(500).send('Error generating phone list');
  }
});

module.exports = app;